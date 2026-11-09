//! tao/wry wiring: window, WebView and event loop. Policy lives in `config`, `navigation`, `bridge`, `startup` and
//! `connectivity`; this file only connects them to the platform.

use std::cell::Cell;
use std::rc::Rc;

use tao::dpi::LogicalSize;
use tao::event::{Event, StartCause, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::window::WindowBuilder;
use wry::http::Request;
use wry::{NewWindowResponse, PageLoadEvent, PermissionResponse, WebContext, WebViewBuilder};

use crate::bridge::{self, Effect};
use crate::config::{self, Config, ConfigError};
use crate::connectivity::{self, Probe};
use crate::navigation::NavigationPolicy;
use crate::origin::{STARTUP_SCHEME, redact, startup_url};
use crate::{paths, startup};

#[derive(Debug)]
enum UserEvent {
    ProbeFinished(Probe),
    /// A bridge reply for the document generation that sent the request.
    BridgeReply {
        generation: u64,
        script: String,
    },
    Retry,
}

pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let config = load_config();
    let policy = NavigationPolicy::new(config.as_ref().ok().map(|c| c.hosted_origin.clone()));
    let initial_state = match &config {
        Ok(_) => "connecting",
        Err(e) => e.startup_state(),
    };
    let config = config.ok();

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let window = WindowBuilder::new()
        .with_title("HMS")
        .with_inner_size(LogicalSize::new(1366.0, 768.0))
        .with_min_inner_size(LogicalSize::new(1024.0, 640.0))
        .build(&event_loop)?;

    // Incremented when a new document starts loading; replies for older documents are dropped.
    let generation = Rc::new(Cell::new(0u64));
    let probing = Rc::new(Cell::new(false));

    let mut web_context = WebContext::new(paths::webview_data_dir());
    let builder = WebViewBuilder::new_with_web_context(&mut web_context)
        .with_url(startup_url(initial_state))
        .with_initialization_script(bridge::CLIENT_SCRIPT)
        .with_custom_protocol(STARTUP_SCHEME.into(), |_id, request| startup::respond(&request))
        .with_navigation_handler({
            let policy = policy.clone();
            move |url| {
                let allowed = policy.allows_navigation(&url);
                if !allowed {
                    log::warn!("navigation denied: {}", redact(&url));
                }
                allowed
            }
        })
        .with_new_window_req_handler(|url, _features| {
            log::warn!("new window denied: {}", redact(&url));
            NewWindowResponse::Deny
        })
        .with_download_started_handler(|url, _path| {
            log::warn!("download denied: {}", redact(&url));
            false
        })
        .with_permission_handler(|kind| {
            log::info!("web permission denied: {kind:?}");
            PermissionResponse::Deny
        })
        .with_on_page_load_handler({
            let generation = generation.clone();
            move |event, _url| {
                if matches!(event, PageLoadEvent::Started) {
                    generation.set(generation.get() + 1);
                }
            }
        })
        .with_ipc_handler({
            let generation = generation.clone();
            let probing = probing.clone();
            let proxy = proxy.clone();
            move |request: Request<String>| {
                on_bridge_message(&request, &policy, generation.get(), probing.get(), &proxy)
            }
        })
        .with_devtools(cfg!(debug_assertions));
    #[cfg(windows)]
    let builder = {
        use wry::WebViewBuilderExtWindows;
        builder.with_https_scheme(true)
    };
    let webview = builder.build(&window)?;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::NewEvents(StartCause::Init) => {
                if let Some(config) = &config {
                    start_probe(config, &probing, &proxy);
                }
            }
            Event::UserEvent(UserEvent::ProbeFinished(outcome)) => {
                probing.set(false);
                let next = match (outcome, &config) {
                    (Probe::Reachable, Some(config)) => config.hosted_url.to_string(),
                    (Probe::BadStatus(_), _) => startup_url("server-error"),
                    _ => startup_url("unreachable"),
                };
                if let Err(e) = webview.load_url(&next) {
                    log::error!("loading {} failed: {e}", redact(&next));
                }
            }
            Event::UserEvent(UserEvent::Retry) => {
                if let Some(config) = &config
                    && !probing.get()
                {
                    let _ = webview.load_url(&startup_url("connecting"));
                    start_probe(config, &probing, &proxy);
                }
            }
            Event::UserEvent(UserEvent::BridgeReply { generation: sent_for, script }) => {
                if sent_for == generation.get() {
                    if let Err(e) = webview.evaluate_script(&script) {
                        log::warn!("bridge reply not delivered: {e}");
                    }
                } else {
                    log::debug!("bridge reply dropped: document changed");
                }
            }
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => *control_flow = ControlFlow::Exit,
            _ => {}
        }
    })
}

fn load_config() -> Result<Config, ConfigError> {
    let Some((path, source)) = config::path() else {
        log::error!("no configuration path on this platform");
        return Err(ConfigError::Missing);
    };
    let result = config::load(&path, source);
    match &result {
        Ok(c) => log::info!("hosted origin {} (from {})", c.hosted_origin, path.display()),
        Err(e) => log::error!("{e} ({})", path.display()),
    }
    result
}

fn start_probe(config: &Config, probing: &Cell<bool>, proxy: &EventLoopProxy<UserEvent>) {
    probing.set(true);
    let url = config.hosted_url.clone();
    let proxy = proxy.clone();
    std::thread::spawn(move || {
        let outcome = connectivity::probe(&url);
        log::info!("health probe {}: {outcome:?}", redact(url.as_str()));
        let _ = proxy.send_event(UserEvent::ProbeFinished(outcome));
    });
}

fn on_bridge_message(
    request: &Request<String>,
    policy: &NavigationPolicy,
    generation: u64,
    probe_in_flight: bool,
    proxy: &EventLoopProxy<UserEvent>,
) {
    let source = request.uri().to_string();
    log::debug!("bridge message from {}", redact(&source));
    let Some(caller) = policy.caller(&source) else {
        log::warn!("bridge message from untrusted origin {} dropped", redact(&source));
        return;
    };
    let outcome = bridge::handle(request.body(), caller, &bridge::Context { probe_in_flight });
    match outcome.reply {
        Some(reply) => {
            if let Some(code) = reply.error_code() {
                log::info!("bridge command refused for {caller:?}: {code:?}");
            }
            let _ = proxy.send_event(UserEvent::BridgeReply { generation, script: reply.to_delivery_script() });
        }
        None => log::warn!("malformed bridge message from {caller:?} dropped"),
    }
    if outcome.effect == Some(Effect::RetryConnection) {
        let _ = proxy.send_event(UserEvent::Retry);
    }
}
