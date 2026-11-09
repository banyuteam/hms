//! Proof that the machine-wide configuration can only have been written by administrators (ADR-DSK-003 §3).
//!
//! By default any standard user can create folders and files under `C:\ProgramData` and owns what they create, so
//! the shell refuses a configuration file unless the file and its folder are owned by a trusted principal, grant no
//! write, delete or ownership rights to anyone else, and are not reparse points (symlinks, junctions).

use std::fmt;
use std::path::Path;

/// SYSTEM, BUILTIN\Administrators, NT SERVICE\TrustedInstaller.
#[cfg_attr(not(windows), allow(dead_code))]
const TRUSTED_SIDS: &[&str] =
    &["S-1-5-18", "S-1-5-32-544", "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464"];

/// Rights that let a principal change or replace a file: write/append data, delete, change permissions or owner,
/// and the generic write/all bits (present in ACEs that were not mapped).
#[cfg_attr(not(windows), allow(dead_code))]
const FILE_WRITE_RIGHTS: u32 =
    0x0000_0002 | 0x0000_0004 | 0x0001_0000 | 0x0004_0000 | 0x0008_0000 | 0x4000_0000 | 0x1000_0000;
/// On a folder the same bits mean "create file / create subfolder", plus FILE_DELETE_CHILD.
#[cfg_attr(not(windows), allow(dead_code))]
const FOLDER_WRITE_RIGHTS: u32 = FILE_WRITE_RIGHTS | 0x0000_0040;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    File,
    Folder,
}

impl fmt::Display for Target {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::File => "file",
            Self::Folder => "folder",
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Problem {
    Unreadable(Target, String),
    ReparsePoint(Target),
    UntrustedOwner(Target, String),
    /// No DACL at all: everyone has full access.
    NullDacl(Target),
    UntrustedWriter(Target, String),
    /// An ACE kind this check does not evaluate (object or callback ACEs); refused rather than guessed.
    UnsupportedAce(Target, u8),
}

impl fmt::Display for Problem {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unreadable(t, why) => write!(f, "configuration {t} security unreadable: {why}"),
            Self::ReparsePoint(t) => write!(f, "configuration {t} is a symlink or junction"),
            Self::UntrustedOwner(t, sid) => write!(f, "configuration {t} owned by untrusted principal {sid}"),
            Self::NullDacl(t) => write!(f, "configuration {t} has no access control list"),
            Self::UntrustedWriter(t, sid) => write!(f, "configuration {t} writable by untrusted principal {sid}"),
            Self::UnsupportedAce(t, kind) => write!(f, "configuration {t} has unsupported ACE type {kind}"),
        }
    }
}

/// One DACL entry, reduced to what the check needs.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(not(windows), allow(dead_code))]
pub enum Ace {
    Allowed {
        sid: String,
        mask: u32,
        inherit_only: bool,
    },
    /// Deny entries can only remove rights; ignoring them can only make the check stricter.
    Denied,
    Other(u8),
}

/// The decision, independent of the OS API: `aces = None` is a NULL DACL.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn evaluate(target: Target, owner: &str, aces: Option<&[Ace]>) -> Result<(), Problem> {
    if !TRUSTED_SIDS.contains(&owner) {
        return Err(Problem::UntrustedOwner(target, owner.to_owned()));
    }
    let aces = aces.ok_or(Problem::NullDacl(target))?;
    let dangerous = match target {
        Target::File => FILE_WRITE_RIGHTS,
        Target::Folder => FOLDER_WRITE_RIGHTS,
    };
    for ace in aces {
        match ace {
            // Inherit-only entries apply to future children, which are checked themselves when they matter.
            Ace::Allowed { inherit_only: true, .. } | Ace::Denied => {}
            Ace::Allowed { sid, mask, .. } => {
                if mask & dangerous != 0 && !TRUSTED_SIDS.contains(&sid.as_str()) {
                    return Err(Problem::UntrustedWriter(target, sid.clone()));
                }
            }
            Ace::Other(kind) => return Err(Problem::UnsupportedAce(target, *kind)),
        }
    }
    Ok(())
}

/// Checks the folder, then the file. Call only for a file that exists.
pub fn verify(file: &Path) -> Result<(), Problem> {
    let folder = file.parent().ok_or_else(|| Problem::Unreadable(Target::Folder, "no parent folder".into()))?;
    platform::check(Target::Folder, folder)?;
    platform::check(Target::File, file)
}

#[cfg(windows)]
mod platform {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::fs::MetadataExt;
    use std::path::Path;

    use windows_sys::Win32::Foundation::{ERROR_SUCCESS, LocalFree};
    use windows_sys::Win32::Security::Authorization::{ConvertSidToStringSidW, GetNamedSecurityInfoW, SE_FILE_OBJECT};
    use windows_sys::Win32::Security::{
        ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, DACL_SECURITY_INFORMATION, GetAce, INHERIT_ONLY_ACE,
        OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID,
    };
    use windows_sys::core::PWSTR;

    use super::{Ace, Problem, Target, evaluate};

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
    const ACCESS_DENIED_ACE_TYPE: u8 = 1;

    pub fn check(target: Target, path: &Path) -> Result<(), Problem> {
        let meta = std::fs::symlink_metadata(path).map_err(|e| Problem::Unreadable(target, e.to_string()))?;
        if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(Problem::ReparsePoint(target));
        }
        let (owner, aces) = read(path).map_err(|why| Problem::Unreadable(target, why))?;
        evaluate(target, &owner, aces.as_deref())
    }

    /// Owner SID string and DACL entries (`None` = NULL DACL) of a file or folder.
    pub fn read(path: &Path) -> Result<(String, Option<Vec<Ace>>), String> {
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut owner: PSID = std::ptr::null_mut();
        let mut dacl: *mut ACL = std::ptr::null_mut();
        let mut sd: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
        // SAFETY: valid NUL-terminated path; out-pointers are valid; `sd` owns the returned buffers and is freed below.
        let status = unsafe {
            GetNamedSecurityInfoW(
                wide.as_ptr(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                &mut owner,
                std::ptr::null_mut(),
                &mut dacl,
                std::ptr::null_mut(),
                &mut sd,
            )
        };
        if status != ERROR_SUCCESS {
            return Err(format!("GetNamedSecurityInfoW error {status}"));
        }
        let result = (|| {
            let owner = sid_string(owner)?;
            if dacl.is_null() {
                return Ok((owner, None));
            }
            // SAFETY: `dacl` points into `sd`, which is alive until LocalFree below.
            let count = unsafe { (*dacl).AceCount };
            let mut aces = Vec::with_capacity(count.into());
            for i in 0..u32::from(count) {
                let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
                // SAFETY: index < AceCount; GetAce returns a pointer into the ACL.
                if unsafe { GetAce(dacl, i, &mut ace) } == 0 {
                    return Err(format!("GetAce {i} failed"));
                }
                // SAFETY: every ACE starts with an ACE_HEADER.
                let header = unsafe { *(ace as *const ACE_HEADER) };
                aces.push(match header.AceType {
                    ACCESS_ALLOWED_ACE_TYPE => {
                        let allowed = ace as *const ACCESS_ALLOWED_ACE;
                        // SAFETY: type 0 is ACCESS_ALLOWED_ACE; its SID starts at `SidStart`.
                        let (mask, sid) = unsafe { ((*allowed).Mask, std::ptr::addr_of!((*allowed).SidStart) as PSID) };
                        Ace::Allowed {
                            sid: sid_string(sid)?,
                            mask,
                            inherit_only: u32::from(header.AceFlags) & INHERIT_ONLY_ACE != 0,
                        }
                    }
                    ACCESS_DENIED_ACE_TYPE => Ace::Denied,
                    other => Ace::Other(other),
                });
            }
            Ok((owner, Some(aces)))
        })();
        // SAFETY: `sd` was allocated by GetNamedSecurityInfoW with LocalAlloc.
        unsafe { LocalFree(sd) };
        result
    }

    fn sid_string(sid: PSID) -> Result<String, String> {
        let mut text: PWSTR = std::ptr::null_mut();
        // SAFETY: `sid` is a valid SID from the security descriptor; `text` is freed with LocalFree.
        if unsafe { ConvertSidToStringSidW(sid, &mut text) } == 0 {
            return Err("ConvertSidToStringSidW failed".into());
        }
        // SAFETY: `text` is a NUL-terminated wide string allocated by the call above.
        let s = unsafe {
            let len = (0..).take_while(|&i| *text.add(i) != 0).count();
            String::from_utf16_lossy(std::slice::from_raw_parts(text, len))
        };
        // SAFETY: allocated with LocalAlloc by ConvertSidToStringSidW.
        unsafe { LocalFree(text.cast()) };
        Ok(s)
    }
}

/// Provisional and untested (ADR-DSK-001 §5): root-owned, not group/other-writable, not a symlink.
#[cfg(unix)]
mod platform {
    use std::os::unix::fs::MetadataExt;
    use std::path::Path;

    use super::{Problem, Target};

    pub fn check(target: Target, path: &Path) -> Result<(), Problem> {
        let meta = std::fs::symlink_metadata(path).map_err(|e| Problem::Unreadable(target, e.to_string()))?;
        if meta.file_type().is_symlink() {
            return Err(Problem::ReparsePoint(target));
        }
        if meta.uid() != 0 {
            return Err(Problem::UntrustedOwner(target, format!("uid {}", meta.uid())));
        }
        if meta.mode() & 0o022 != 0 {
            return Err(Problem::UntrustedWriter(target, "group/other".into()));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SYSTEM: &str = "S-1-5-18";
    const ADMINS: &str = "S-1-5-32-544";
    const USERS: &str = "S-1-5-32-545";
    const CREATOR_OWNER: &str = "S-1-3-0";
    const READ_EXECUTE: u32 = 0x0012_00a9;
    const FULL: u32 = 0x001f_01ff;

    fn allow(sid: &str, mask: u32) -> Ace {
        Ace::Allowed { sid: sid.into(), mask, inherit_only: false }
    }

    /// The SDDL the installer applies: SYSTEM and Administrators full, Users read/execute.
    fn installer_dacl() -> Vec<Ace> {
        vec![allow(SYSTEM, FULL), allow(ADMINS, FULL), allow(USERS, READ_EXECUTE)]
    }

    #[test]
    fn installer_permissions_pass() {
        for owner in TRUSTED_SIDS {
            assert_eq!(evaluate(Target::Folder, owner, Some(&installer_dacl())), Ok(()));
            assert_eq!(evaluate(Target::File, owner, Some(&installer_dacl())), Ok(()));
        }
    }

    #[test]
    fn default_programdata_folder_fails() {
        // C:\ProgramData defaults: Users may create files/folders; CREATOR OWNER gets full control of what they create.
        let aces = vec![
            allow(SYSTEM, FULL),
            allow(ADMINS, FULL),
            Ace::Allowed { sid: CREATOR_OWNER.into(), mask: 0x1000_0000, inherit_only: true },
            allow(USERS, READ_EXECUTE),
            allow(USERS, 0x0000_0002 | 0x0000_0004 | 0x0000_0010 | 0x0000_0100),
        ];
        assert_eq!(
            evaluate(Target::Folder, SYSTEM, Some(&aces)),
            Err(Problem::UntrustedWriter(Target::Folder, USERS.into()))
        );
    }

    #[test]
    fn user_owned_file_fails_even_with_clean_dacl() {
        let user = "S-1-5-21-1-2-3-1001";
        assert_eq!(
            evaluate(Target::File, user, Some(&installer_dacl())),
            Err(Problem::UntrustedOwner(Target::File, user.into()))
        );
    }

    #[test]
    fn each_dangerous_right_alone_fails() {
        for (target, bit) in [
            (Target::File, 0x0000_0002),
            (Target::File, 0x0000_0004),
            (Target::File, 0x0001_0000),
            (Target::File, 0x0004_0000),
            (Target::File, 0x0008_0000),
            (Target::File, 0x4000_0000),
            (Target::File, 0x1000_0000),
            (Target::Folder, 0x0000_0040),
        ] {
            let aces = vec![allow(ADMINS, FULL), allow(USERS, bit)];
            assert!(evaluate(target, ADMINS, Some(&aces)).is_err(), "{target} {bit:#x}");
        }
    }

    #[test]
    fn harmless_rights_pass() {
        // FILE_EXECUTE on a file shares bit 0x40 with FILE_DELETE_CHILD on a folder; write-attributes/EA are not content.
        let aces = vec![allow(ADMINS, FULL), allow(USERS, READ_EXECUTE | 0x0000_0040 | 0x0000_0100 | 0x0000_0010)];
        assert_eq!(evaluate(Target::File, ADMINS, Some(&aces)), Ok(()));
    }

    #[test]
    fn inherit_only_and_deny_entries_are_ignored() {
        let aces = vec![
            allow(ADMINS, FULL),
            Ace::Allowed { sid: CREATOR_OWNER.into(), mask: 0x1000_0000, inherit_only: true },
            Ace::Denied,
        ];
        assert_eq!(evaluate(Target::Folder, SYSTEM, Some(&aces)), Ok(()));
    }

    #[test]
    fn null_dacl_and_unknown_ace_types_fail() {
        assert_eq!(evaluate(Target::File, SYSTEM, None), Err(Problem::NullDacl(Target::File)));
        let aces = vec![allow(ADMINS, FULL), Ace::Other(9)];
        assert_eq!(evaluate(Target::File, SYSTEM, Some(&aces)), Err(Problem::UnsupportedAce(Target::File, 9)));
    }

    #[cfg(windows)]
    mod windows_acls {
        use super::super::*;
        use std::path::PathBuf;

        fn temp_dir(name: &str) -> PathBuf {
            let dir = std::env::temp_dir().join(format!("hms-desktop-acl-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            dir
        }

        #[test]
        fn system_file_owned_by_trustedinstaller_passes() {
            let windir = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap();
            assert_eq!(verify(&windir.join("System32").join("kernel32.dll")), Ok(()));
        }

        #[test]
        fn file_in_user_profile_fails_and_shows_the_writer() {
            let dir = temp_dir("user");
            let file = dir.join("config.toml");
            std::fs::write(&file, "x").unwrap();
            let (_, aces) = platform::read(&file).unwrap();
            let aces = aces.expect("temp files have a DACL");
            assert!(
                aces.iter().any(|a| matches!(a, Ace::Allowed { sid, mask, inherit_only: false }
                    if mask & FILE_WRITE_RIGHTS != 0 && !TRUSTED_SIDS.contains(&sid.as_str()))),
                "the creating user can write its own temp file: {aces:?}"
            );
            assert!(matches!(verify(&file), Err(Problem::UntrustedOwner(..) | Problem::UntrustedWriter(..))));
            std::fs::remove_dir_all(&dir).unwrap();
        }

        /// Applies the DACL part of `sddl` to `path` (propagating to children), as the installer does.
        fn set_dacl(path: &std::path::Path, sddl: &str) {
            use std::os::windows::ffi::OsStrExt;
            use windows_sys::Win32::Foundation::{ERROR_SUCCESS, LocalFree};
            use windows_sys::Win32::Security::Authorization::{
                ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1, SE_FILE_OBJECT,
                SetNamedSecurityInfoW,
            };
            use windows_sys::Win32::Security::{
                ACL, DACL_SECURITY_INFORMATION, GetSecurityDescriptorDacl, PROTECTED_DACL_SECURITY_INFORMATION,
                PSECURITY_DESCRIPTOR,
            };

            let wide = |s: &std::ffi::OsStr| s.encode_wide().chain(Some(0)).collect::<Vec<u16>>();
            let sddl_w = wide(std::ffi::OsStr::new(sddl));
            let path_w = wide(path.as_os_str());
            let mut sd: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
            let mut present = 0;
            let mut defaulted = 0;
            let mut dacl: *mut ACL = std::ptr::null_mut();
            // SAFETY: test-only FFI with valid NUL-terminated strings and out-pointers; `sd` freed below.
            unsafe {
                assert_ne!(
                    ConvertStringSecurityDescriptorToSecurityDescriptorW(
                        sddl_w.as_ptr(),
                        SDDL_REVISION_1,
                        &mut sd,
                        std::ptr::null_mut()
                    ),
                    0,
                    "invalid SDDL {sddl}"
                );
                assert_ne!(GetSecurityDescriptorDacl(sd, &mut present, &mut dacl, &mut defaulted), 0);
                let status = SetNamedSecurityInfoW(
                    path_w.as_ptr(),
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    dacl,
                    std::ptr::null(),
                );
                LocalFree(sd);
                assert_eq!(status, ERROR_SUCCESS, "SetNamedSecurityInfoW");
            }
        }

        /// The installer's SDDL (read from the WiX source, so the two cannot drift) passes the shell's check for
        /// the folder and for a file that inherits from it. Owner is taken from the SDDL: setting it needs admin.
        #[test]
        fn installer_sddl_passes_the_check() {
            let wxs = include_str!("../packaging/windows/hms-desktop.wxs");
            let sddl = wxs.split("Sddl=\"").nth(1).and_then(|s| s.split('"').next()).expect("Sddl in wxs");
            let owner = match sddl.strip_prefix("O:").and_then(|s| s.get(..2)) {
                Some("SY") => "S-1-5-18",
                Some("BA") => "S-1-5-32-544",
                other => panic!("installer SDDL owner must be SYSTEM or Administrators, got {other:?}"),
            };
            let dacl_sddl = &sddl[sddl.find("D:").expect("SDDL has a DACL")..];

            let dir = temp_dir("installer-sddl");
            let file = dir.join("config.toml");
            std::fs::write(&file, "x").unwrap();
            set_dacl(&dir, dacl_sddl);

            let (_, folder_aces) = platform::read(&dir).unwrap();
            assert_eq!(evaluate(Target::Folder, owner, folder_aces.as_deref()), Ok(()), "{folder_aces:?}");
            let (_, file_aces) = platform::read(&file).unwrap();
            assert_eq!(evaluate(Target::File, owner, file_aces.as_deref()), Ok(()), "{file_aces:?}");

            // Owner (this test) keeps WRITE_DAC: restore access, then clean up.
            set_dacl(&dir, "D:(A;OICI;FA;;;OW)");
            std::fs::remove_dir_all(&dir).unwrap();
        }

        #[test]
        fn junction_folder_is_refused() {
            let real = temp_dir("real");
            std::fs::write(real.join("config.toml"), "x").unwrap();
            let link = std::env::temp_dir().join(format!("hms-desktop-acl-junction-{}", std::process::id()));
            let _ = std::fs::remove_dir(&link);
            let status = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(&link)
                .arg(&real)
                .output()
                .unwrap()
                .status;
            assert!(status.success(), "mklink /J failed");
            assert_eq!(verify(&link.join("config.toml")), Err(Problem::ReparsePoint(Target::Folder)));
            std::fs::remove_dir(&link).unwrap();
            std::fs::remove_dir_all(&real).unwrap();
        }
    }
}
