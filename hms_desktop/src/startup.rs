//! The packaged startup page (ADR-DSK-002 §1), served from memory through the `hmsdesktop` custom protocol. A fixed
//! set of embedded files; no filesystem access, no network, strict CSP.

use std::borrow::Cow;

use wry::http::{Method, Request, Response, StatusCode, header};

const CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; \
                   base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

struct Asset {
    path: &'static str,
    mime: &'static str,
    body: &'static [u8],
}

const ASSETS: &[Asset] = &[
    Asset { path: "/index.html", mime: "text/html; charset=utf-8", body: include_bytes!("../startup/index.html") },
    Asset { path: "/startup.css", mime: "text/css; charset=utf-8", body: include_bytes!("../startup/startup.css") },
    Asset {
        path: "/startup.js",
        mime: "text/javascript; charset=utf-8",
        body: include_bytes!("../startup/startup.js"),
    },
    Asset {
        path: "/tokens.css",
        mime: "text/css; charset=utf-8",
        body: include_bytes!(concat!(env!("OUT_DIR"), "/tokens.css")),
    },
];

pub fn respond(request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let asset = (request.method() == Method::GET)
        .then(|| request.uri().path())
        .and_then(|p| ASSETS.iter().find(|a| a.path == p));
    let builder = Response::builder()
        .header(header::CONTENT_SECURITY_POLICY, CSP)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::REFERRER_POLICY, "no-referrer");
    match asset {
        Some(a) => builder.header(header::CONTENT_TYPE, a.mime).body(Cow::Borrowed(a.body)),
        None => builder.status(StatusCode::NOT_FOUND).body(Cow::Borrowed(&b""[..])),
    }
    .expect("static response headers are valid")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(uri: &str) -> Response<Cow<'static, [u8]>> {
        respond(&Request::builder().uri(uri).body(Vec::new()).unwrap())
    }

    #[test]
    fn serves_known_assets_with_csp() {
        for path in ["/index.html", "/startup.css", "/startup.js", "/tokens.css"] {
            let r = get(&format!("hmsdesktop://localhost{path}?state=connecting"));
            assert_eq!(r.status(), StatusCode::OK, "{path}");
            assert!(!r.body().is_empty());
            assert_eq!(r.headers()[header::CONTENT_SECURITY_POLICY], CSP);
            assert_eq!(r.headers()[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        }
    }

    #[test]
    fn everything_else_is_404() {
        for uri in [
            "hmsdesktop://localhost/",
            "hmsdesktop://localhost/../Cargo.toml",
            "hmsdesktop://localhost/%2e%2e/Cargo.toml",
            "hmsdesktop://localhost/index.html/",
            "hmsdesktop://localhost/INDEX.HTML",
            "hmsdesktop://localhost/C:/Windows/win.ini",
        ] {
            assert_eq!(get(uri).status(), StatusCode::NOT_FOUND, "{uri}");
        }
    }

    #[test]
    fn only_get() {
        let r =
            respond(&Request::builder().method("POST").uri("hmsdesktop://localhost/index.html").body(vec![]).unwrap());
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn tokens_are_generated_from_the_canonical_file() {
        let css = std::str::from_utf8(ASSETS[3].body).unwrap();
        assert!(css.contains("--color-semantic-action-primary: #"));
        assert!(css.contains("--font-family-base: "));
        assert!(css.contains("--font-style-body-font-size: "));
    }

    #[test]
    fn page_has_no_inline_script_or_remote_resources() {
        let html = std::str::from_utf8(ASSETS[0].body).unwrap();
        assert!(!html.contains("<script>"), "inline script would violate the CSP");
        assert!(!html.contains("http://") && !html.contains("https://"));
        assert!(!html.contains("style=\""));
    }
}
