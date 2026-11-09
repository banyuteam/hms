//! Reachability of the hosted HMS origin (ADR-DSK-002 §2): one fixed `GET <origin>/healthz`, no redirects, short
//! timeout, OS certificate store (the same trust WebView2 uses, so an internal hospital CA works for both).

use std::time::Duration;

use ureq::tls::{RootCerts, TlsConfig};
use url::Url;

const HEALTH_PATH: &str = "healthz";
const TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Probe {
    Reachable,
    /// The server answered, but not with 2xx.
    BadStatus(u16),
    /// No answer: DNS, connection, TLS or timeout. Details are logged, not shown.
    Unreachable,
}

pub fn health_url(origin: &Url) -> Url {
    origin.join(HEALTH_PATH).expect("origin URL is a valid base")
}

/// Blocking; call off the UI thread.
pub fn probe(origin: &Url) -> Probe {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .max_redirects(0)
        .http_status_as_error(false)
        .https_only(origin.scheme() == "https")
        .tls_config(TlsConfig::builder().root_certs(RootCerts::PlatformVerifier).build())
        .build()
        .into();
    match agent.get(health_url(origin).as_str()).call() {
        Ok(res) => classify(res.status().as_u16()),
        Err(e) => {
            log::warn!("health probe failed: {e}");
            Probe::Unreachable
        }
    }
}

fn classify(status: u16) -> Probe {
    if (200..300).contains(&status) { Probe::Reachable } else { Probe::BadStatus(status) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn health_url_is_fixed_under_the_origin() {
        let o = Url::parse("https://hms.example/").unwrap();
        assert_eq!(health_url(&o).as_str(), "https://hms.example/healthz");
        let o = Url::parse("http://localhost:5173/").unwrap();
        assert_eq!(health_url(&o).as_str(), "http://localhost:5173/healthz");
    }

    #[test]
    fn only_2xx_is_reachable() {
        assert_eq!(classify(200), Probe::Reachable);
        assert_eq!(classify(204), Probe::Reachable);
        assert_eq!(classify(302), Probe::BadStatus(302));
        assert_eq!(classify(503), Probe::BadStatus(503));
    }

    /// Serves one canned HTTP answer on loopback and returns its origin URL.
    fn one_shot_server(answer: &'static str) -> Url {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut s, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = s.read(&mut buf);
                let _ = s.write_all(answer.as_bytes());
            }
        });
        Url::parse(&format!("http://127.0.0.1:{port}/")).unwrap()
    }

    #[test]
    fn probes_a_live_server() {
        let ok = one_shot_server("HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nok\n");
        assert_eq!(probe(&ok), Probe::Reachable);
        let down =
            one_shot_server("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        assert_eq!(probe(&down), Probe::BadStatus(503));
    }

    #[test]
    fn does_not_follow_redirects() {
        let moved = one_shot_server(
            "HTTP/1.1 302 Found\r\nLocation: http://evil.test/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
        assert_eq!(probe(&moved), Probe::BadStatus(302));
    }

    #[test]
    fn closed_port_is_unreachable() {
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let url = Url::parse(&format!("http://127.0.0.1:{port}/")).unwrap();
        assert_eq!(probe(&url), Probe::Unreachable);
    }
}
