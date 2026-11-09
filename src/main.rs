//! HMS Desktop: native shell hosting the HMS web workspace (ADR-DSK-001, ADR-DSK-002).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod bridge;
mod config;
mod connectivity;
mod navigation;
mod origin;
mod paths;
mod protection;
mod startup;

fn main() -> std::process::ExitCode {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("hms_desktop=info")).init();
    log::info!("HMS Desktop {} starting", env!("CARGO_PKG_VERSION"));
    match app::run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            log::error!("startup failed: {e}");
            std::process::ExitCode::FAILURE
        }
    }
}
