//! Exact web origins (scheme, host, port). The shell trusts origins, never URL prefixes: `https://hms.example` and
//! `https://hms.example.evil.test` are different origins and are compared as such.

use url::Url;

/// Scheme of the packaged startup page (ADR-DSK-002), served by [`crate::startup`].
pub const STARTUP_SCHEME: &str = "hmsdesktop";

/// The origin the WebView reports for startup-page documents. wry serves custom protocols on Windows as
/// `https://<scheme>.localhost` (with `with_https_scheme(true)`) and as `<scheme>://localhost` elsewhere.
#[cfg(windows)]
const STARTUP_BASE: &str = "https://hmsdesktop.localhost/";
#[cfg(not(windows))]
const STARTUP_BASE: &str = "hmsdesktop://localhost/";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Origin {
    scheme: String,
    host: String,
    port: Option<u16>,
}

impl Origin {
    /// The origin of an absolute URL, or `None` for URLs without a host (`about:`, `data:`, `blob:`, `file:` …),
    /// which are never trusted.
    pub fn of(url: &str) -> Option<Self> {
        Self::of_url(&Url::parse(url).ok()?)
    }

    pub fn of_url(url: &Url) -> Option<Self> {
        let host = url.host_str()?;
        if host.is_empty() {
            return None;
        }
        Some(Self { scheme: url.scheme().to_owned(), host: host.to_owned(), port: url.port_or_known_default() })
    }

    pub fn startup() -> Self {
        Self::of(STARTUP_BASE).expect("startup base is a valid URL")
    }
}

impl std::fmt::Display for Origin {
    /// `scheme://host[:port]`: the only part of a URL the shell writes to logs, since paths and queries can carry
    /// patient or visit identifiers.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let default = Url::parse(&format!("{}://x/", self.scheme)).ok().and_then(|u| u.port_or_known_default());
        match self.port {
            Some(p) if Some(p) != default => write!(f, "{}://{}:{}", self.scheme, self.host, p),
            _ => write!(f, "{}://{}", self.scheme, self.host),
        }
    }
}

/// Origin of a URL for logging; never the full URL.
pub fn redact(url: &str) -> String {
    Origin::of(url).map_or_else(|| "<no origin>".to_owned(), |o| o.to_string())
}

/// URL of a startup-page document; `state` is one of the fixed states the page knows (see `startup/startup.js`).
/// Always the platform form: on Windows `WebView::load_url` does not rewrite `hmsdesktop://` the way the initial
/// URL is rewritten, so the raw scheme would reach the navigation policy and be denied.
pub fn startup_url(state: &str) -> String {
    format!("{STARTUP_BASE}index.html?state={state}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_origin_ignores_path_query_and_default_port() {
        let a = Origin::of("https://hms.example/").unwrap();
        assert_eq!(Origin::of("https://hms.example:443/emr/123?x=1#y"), Some(a.clone()));
        assert_eq!(Origin::of("HTTPS://HMS.EXAMPLE/"), Some(a));
    }

    #[test]
    fn lookalike_origins_differ() {
        let a = Origin::of("https://hms.example/").unwrap();
        for other in [
            "https://hms.example.evil.test/",
            "https://evil.test/hms.example/",
            "https://hms.example:8443/",
            "http://hms.example/",
            "https://user@evil.test/",
            "https://xn--hms-example.test/",
        ] {
            assert_ne!(Origin::of(other).as_ref(), Some(&a), "{other}");
        }
    }

    #[test]
    fn hostless_urls_have_no_origin() {
        for url in [
            "about:blank",
            "data:text/html,<p>x</p>",
            "blob:https://hms.example/1",
            "file:///C:/x.html",
            "javascript:alert(1)",
            "not a url",
        ] {
            assert_eq!(Origin::of(url), None, "{url}");
        }
    }

    #[test]
    fn display_and_redact_never_include_path_or_query() {
        assert_eq!(redact("https://hms.example/emr/2026%2F10%2F26%2F000123?q=name"), "https://hms.example");
        assert_eq!(redact("http://localhost:5173/x"), "http://localhost:5173");
        assert_eq!(redact("about:blank"), "<no origin>");
    }

    #[test]
    fn startup_origin_matches_platform_form() {
        let o = Origin::startup();
        #[cfg(windows)]
        assert_eq!(o.to_string(), "https://hmsdesktop.localhost");
        #[cfg(not(windows))]
        assert_eq!(o.to_string(), "hmsdesktop://localhost");
    }
}
