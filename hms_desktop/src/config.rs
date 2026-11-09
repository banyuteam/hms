//! Machine-wide workstation configuration (ADR-DSK-002 §3). It names exactly one hosted HMS origin; nothing in the
//! WebView, the command line or the user profile can change it in release builds, and the machine-wide file is used
//! only when administrators alone can have written it (ADR-DSK-003 §3, [`crate::protection`]).
//!
//! Format (the `[hms]` section lets the installer write it with the Windows INI API):
//! ```toml
//! [hms]
//! origin = "https://hms.example.internal"
//! ```

use std::fmt;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use url::{Host, Url};

use crate::origin::Origin;
use crate::protection;

/// Larger files are not configuration; refuse rather than parse.
const MAX_CONFIG_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone)]
pub struct Config {
    /// `scheme://host[:port]/`, what the WebView loads.
    pub hosted_url: Url,
    pub hosted_origin: Origin,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawConfig {
    hms: RawHms,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawHms {
    origin: String,
}

/// Where a configuration path came from; decides whether its file permissions are enforced.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// The machine-wide path: permissions enforced.
    Machine,
    /// `HMS_DESKTOP_CONFIG` in a debug build: developer's own file, permissions not enforced.
    DevOverride,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ConfigError {
    /// No configuration file at the expected path.
    Missing,
    /// The file exists but cannot be read, or is too large.
    Unreadable,
    /// The file or its folder could have been written by a non-administrator; the text is for logs only.
    Unprotected(String),
    /// The file was read but is not a valid configuration; the text is for logs only.
    Invalid(String),
}

impl ConfigError {
    /// Fixed state name shown by the startup page.
    pub fn startup_state(&self) -> &'static str {
        match self {
            Self::Missing => "config-missing",
            Self::Unreadable | Self::Unprotected(_) | Self::Invalid(_) => "config-invalid",
        }
    }
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing => f.write_str("configuration file not found"),
            Self::Unreadable => f.write_str("configuration file unreadable or too large"),
            Self::Unprotected(why) => write!(f, "configuration refused: {why}"),
            Self::Invalid(why) => write!(f, "invalid configuration: {why}"),
        }
    }
}

/// Plain `http` is only for the Vite dev server on this machine, and only in debug builds.
pub const ALLOW_LOOPBACK_HTTP: bool = cfg!(debug_assertions);

pub fn load(path: &Path, source: Source) -> Result<Config, ConfigError> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(ConfigError::Missing),
        Err(_) => return Err(ConfigError::Unreadable),
    }
    match source {
        Source::Machine => protection::verify(path).map_err(|p| ConfigError::Unprotected(p.to_string()))?,
        Source::DevOverride => log::warn!("configuration permissions not checked (HMS_DESKTOP_CONFIG, debug build)"),
    }
    let meta = std::fs::metadata(path).map_err(|_| ConfigError::Unreadable)?;
    if !meta.is_file() || meta.len() > MAX_CONFIG_BYTES {
        return Err(ConfigError::Unreadable);
    }
    let text = std::fs::read_to_string(path).map_err(|_| ConfigError::Unreadable)?;
    parse(&text, ALLOW_LOOPBACK_HTTP)
}

pub fn parse(text: &str, allow_loopback_http: bool) -> Result<Config, ConfigError> {
    let raw: RawConfig = toml::from_str(text).map_err(|e| ConfigError::Invalid(e.message().to_owned()))?;
    let hosted_url = validate_origin(raw.hms.origin.trim(), allow_loopback_http).map_err(ConfigError::Invalid)?;
    let hosted_origin = Origin::of_url(&hosted_url).ok_or_else(|| ConfigError::Invalid("origin has no host".into()))?;
    Ok(Config { hosted_url, hosted_origin })
}

fn validate_origin(text: &str, allow_loopback_http: bool) -> Result<Url, String> {
    let url = Url::parse(text).map_err(|e| format!("origin is not a URL ({e})"))?;
    match url.scheme() {
        "https" => {}
        "http" if allow_loopback_http && is_loopback(&url) => {}
        "http" => return Err("origin must use https (http is allowed only for localhost in debug builds)".into()),
        _ => return Err("origin must use https".into()),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("origin must not contain credentials".into());
    }
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err("origin must be scheme://host[:port] with no path, query or fragment".into());
    }
    if url.host().is_none() {
        return Err("origin has no host".into());
    }
    Ok(url)
}

fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(d)) => d.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(ip)) => ip.is_loopback(),
        Some(Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

/// Where the configuration is read from. Release builds use only the machine-wide path; debug builds may point
/// elsewhere with `HMS_DESKTOP_CONFIG`.
pub fn path() -> Option<(PathBuf, Source)> {
    #[cfg(debug_assertions)]
    if let Some(p) = std::env::var_os("HMS_DESKTOP_CONFIG") {
        return Some((PathBuf::from(p), Source::DevOverride));
    }
    crate::paths::machine_config_file().map(|p| (p, Source::Machine))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origin(text: &str, loopback: bool) -> Result<String, ConfigError> {
        parse(&format!("[hms]\norigin = \"{text}\""), loopback).map(|c| c.hosted_url.to_string())
    }

    #[test]
    fn accepts_what_the_installer_writes() {
        // WritePrivateProfileString output for HMS_ORIGIN (packaging/windows/hms-desktop.wxs).
        let c = parse("[hms]\r\norigin=\"https://hms.example.internal\"\r\n", false).unwrap();
        assert_eq!(c.hosted_url.as_str(), "https://hms.example.internal/");
    }

    #[test]
    fn accepts_https_origin_and_normalizes_it() {
        assert_eq!(origin("https://HMS.example", false), Ok("https://hms.example/".into()));
        assert_eq!(origin("https://hms.example:8443/", false), Ok("https://hms.example:8443/".into()));
        assert_eq!(origin("https://10.0.0.5", false), Ok("https://10.0.0.5/".into()));
    }

    #[test]
    fn http_only_for_loopback_when_allowed() {
        assert_eq!(origin("http://localhost:5173", true), Ok("http://localhost:5173/".into()));
        assert_eq!(origin("http://127.0.0.1:5173", true), Ok("http://127.0.0.1:5173/".into()));
        assert_eq!(origin("http://[::1]:5173", true), Ok("http://[::1]:5173/".into()));
        assert!(origin("http://localhost:5173", false).is_err());
        assert!(origin("http://hms.example", true).is_err());
        assert!(origin("http://localhost.evil.test", true).is_err());
    }

    #[test]
    fn rejects_anything_that_is_not_a_bare_origin() {
        for bad in [
            "",
            "hms.example",
            "ftp://hms.example",
            "file:///C:/hms/index.html",
            "javascript:alert(1)",
            "https://user:pass@hms.example",
            "https://user@hms.example",
            "https://hms.example/app",
            "https://hms.example/?x=1",
            "https://hms.example/#x",
            "hmsdesktop://localhost",
        ] {
            assert!(matches!(origin(bad, true), Err(ConfigError::Invalid(_))), "{bad:?}");
        }
    }

    #[test]
    fn rejects_unknown_and_missing_keys() {
        for bad in [
            "[hms]\norigin = \"https://a.example\"\nextra = 1",
            "[hms]\norigin = \"https://a.example\"\n[other]\nx = 1",
            "origin = \"https://a.example\"",
            "",
            "[hms]",
            "[hms]\norigin = 5",
        ] {
            assert!(matches!(parse(bad, false), Err(ConfigError::Invalid(_))), "{bad:?}");
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hms-desktop-config-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn load_reports_missing_and_oversized_files() {
        let dir = temp_dir("load");
        assert_eq!(load(&dir.join("absent.toml"), Source::DevOverride).unwrap_err(), ConfigError::Missing);
        assert_eq!(load(&dir.join("absent.toml"), Source::Machine).unwrap_err(), ConfigError::Missing);

        let big = dir.join("big.toml");
        std::fs::write(&big, vec![b'#'; (MAX_CONFIG_BYTES + 1) as usize]).unwrap();
        assert_eq!(load(&big, Source::DevOverride).unwrap_err(), ConfigError::Unreadable);

        assert_eq!(load(&dir, Source::DevOverride).unwrap_err(), ConfigError::Unreadable, "a directory is not a file");

        let ok = dir.join("ok.toml");
        std::fs::write(&ok, "[hms]\norigin = \"https://hms.example\"\n").unwrap();
        assert_eq!(load(&ok, Source::DevOverride).unwrap().hosted_origin.to_string(), "https://hms.example");

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn machine_source_refuses_a_user_written_file() {
        // A valid file a standard user created (as anyone could under C:\ProgramData): refused before parsing.
        let dir = temp_dir("planted");
        let planted = dir.join("config.toml");
        std::fs::write(&planted, "[hms]\norigin = \"https://evil.example\"\n").unwrap();
        assert!(matches!(load(&planted, Source::Machine), Err(ConfigError::Unprotected(_))));
        assert_eq!(load(&planted, Source::Machine).unwrap_err().startup_state(), "config-invalid");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
