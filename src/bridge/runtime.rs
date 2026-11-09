//! `runtime.*` and `startup.*` commands: shell facts and startup control. No PHI, no workstation identity.

use serde_json::{Value, json};

use super::{CommandResult, Context, Effect, ErrorCode, PROTOCOL_VERSION, no_args};

/// `runtime.get_info`: lets the web app detect the desktop shell and its protocol version.
pub(super) fn get_info(args: Value, _ctx: &Context) -> CommandResult {
    no_args(args)?;
    Ok((
        json!({
            "protocol": PROTOCOL_VERSION,
            "runtime_version": env!("CARGO_PKG_VERSION"),
            "os": std::env::consts::OS,
        }),
        None,
    ))
}

/// `startup.retry`: probe the hosted origin again (startup page only).
pub(super) fn retry(args: Value, ctx: &Context) -> CommandResult {
    no_args(args)?;
    if ctx.probe_in_flight {
        return Err(ErrorCode::Busy);
    }
    Ok((json!({}), Some(Effect::RetryConnection)))
}
