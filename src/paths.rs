//! Platform directories. All OS-specific path knowledge lives here (`hms-desktop-cross-platform`). Only Windows is a
//! supported target today (ADR-DSK-001 §5); the macOS and Linux locations are provisional and untested.

use std::path::PathBuf;

const APP_DIR: &str = "HMS Desktop";

/// Machine-wide configuration file, writable only by administrators.
pub fn machine_config_file() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("ProgramData").map(|d| PathBuf::from(d).join(APP_DIR).join("config.toml"))
    }
    #[cfg(target_os = "macos")]
    {
        Some(PathBuf::from("/Library/Application Support").join(APP_DIR).join("config.toml"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Some(PathBuf::from("/etc/hms-desktop/config.toml"))
    }
}

/// Per-user WebView data (cookies, cache). WebView2 would otherwise write next to the executable, which is not
/// writable under Program Files. `None` keeps the platform WebView's own default.
pub fn webview_data_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join(APP_DIR).join("WebView2"))
    }
    #[cfg(not(windows))]
    {
        None
    }
}
