//! Which documents the privileged WebView may load (ADR-DSK-002 §4). Only the startup page and the one configured
//! hosted origin; every other top-level navigation, new window and download is denied.

use crate::origin::Origin;

/// Who a document (or bridge message) belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Caller {
    Startup,
    Hosted,
}

#[derive(Debug, Clone)]
pub struct NavigationPolicy {
    startup: Origin,
    hosted: Option<Origin>,
}

impl NavigationPolicy {
    /// `hosted` is `None` when there is no valid configuration: then only the startup page can load.
    pub fn new(hosted: Option<Origin>) -> Self {
        Self { startup: Origin::startup(), hosted }
    }

    /// Classifies a URL by its exact origin; `None` = not trusted.
    pub fn caller(&self, url: &str) -> Option<Caller> {
        let origin = Origin::of(url)?;
        if origin == self.startup {
            Some(Caller::Startup)
        } else if self.hosted.as_ref() == Some(&origin) {
            Some(Caller::Hosted)
        } else {
            None
        }
    }

    pub fn allows_navigation(&self, url: &str) -> bool {
        self.caller(url).is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::origin::startup_url;

    fn policy() -> NavigationPolicy {
        NavigationPolicy::new(Origin::of("https://hms.example/"))
    }

    /// What the WebView reports for the startup page on this platform (wry rewrites the custom scheme on Windows).
    fn observed_startup_url() -> String {
        #[cfg(windows)]
        return "https://hmsdesktop.localhost/index.html?state=connecting".into();
        #[cfg(not(windows))]
        return "hmsdesktop://localhost/index.html?state=connecting".into();
    }

    #[test]
    fn every_url_the_shell_loads_itself_is_allowed() {
        let p = policy();
        for state in ["connecting", "unreachable", "server-error", "config-missing", "config-invalid"] {
            assert_eq!(p.caller(&startup_url(state)), Some(Caller::Startup), "{state}");
        }
        assert_eq!(startup_url("connecting"), observed_startup_url());
    }

    #[test]
    fn allows_hosted_origin_any_path() {
        let p = policy();
        assert_eq!(p.caller("https://hms.example/"), Some(Caller::Hosted));
        assert_eq!(p.caller("https://hms.example/emr?x=1"), Some(Caller::Hosted));
        assert!(p.allows_navigation("https://hms.example/login"));
    }

    #[test]
    fn allows_startup_page() {
        assert_eq!(policy().caller(&observed_startup_url()), Some(Caller::Startup));
    }

    #[test]
    fn denies_everything_else() {
        let p = policy();
        for url in [
            "https://hms.example.evil.test/",
            "https://evil.test/?next=https://hms.example/",
            "http://hms.example/",
            "https://hms.example:444/",
            "https://other.localhost/",
            "about:blank",
            "data:text/html,x",
            "file:///C:/Windows/win.ini",
            "javascript:alert(1)",
            "",
        ] {
            assert!(!p.allows_navigation(url), "{url}");
        }
    }

    #[test]
    fn without_configuration_only_startup_loads() {
        let p = NavigationPolicy::new(None);
        assert!(!p.allows_navigation("https://hms.example/"));
        assert!(p.allows_navigation(&observed_startup_url()));
    }
}
