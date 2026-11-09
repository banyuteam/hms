//! The WebView → native bridge, protocol v1 (`contracts/bridge/desktop-bridge-v1.md`).
//!
//! Every message is untrusted: it is size-bounded, parsed into a fixed envelope, checked against a static command
//! table (command ID + the callers allowed to use it) and only then handed to a typed command. There is no dynamic
//! dispatch by name beyond that table, and the bridge grants nothing the backend would otherwise refuse.

mod runtime;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::navigation::Caller;

pub const PROTOCOL_VERSION: u32 = 1;
/// Raw message limit. Larger messages are dropped unanswered (their id is not parsed).
pub const MAX_MESSAGE_BYTES: usize = 16 * 1024;
const MAX_ID_LEN: usize = 64;

/// Script injected into every document before page scripts run; defines `window.hmsDesktop`.
pub const CLIENT_SCRIPT: &str = include_str!("client.js");

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    v: u32,
    id: String,
    cmd: String,
    /// Omitted = `{}`; an explicit `null` is not the same and is rejected by commands without arguments.
    #[serde(default = "empty_object")]
    args: Value,
}

fn empty_object() -> Value {
    Value::Object(Default::default())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    UnsupportedVersion,
    UnknownCommand,
    NotAllowed,
    InvalidArgs,
    Busy,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Reply {
    v: u32,
    id: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ErrorBody>,
}

#[derive(Debug, PartialEq, Serialize)]
struct ErrorBody {
    code: ErrorCode,
}

impl Reply {
    fn ok(id: String, result: Value) -> Self {
        Self { v: PROTOCOL_VERSION, id, ok: true, result: Some(result), error: None }
    }

    fn err(id: String, code: ErrorCode) -> Self {
        Self { v: PROTOCOL_VERSION, id, ok: false, result: None, error: Some(ErrorBody { code }) }
    }

    pub fn error_code(&self) -> Option<ErrorCode> {
        self.error.as_ref().map(|e| e.code)
    }

    /// JavaScript that hands this reply to the page's bridge client. `serde_json` output is a valid JS expression.
    pub fn to_delivery_script(&self) -> String {
        let json = serde_json::to_string(self).expect("reply serializes");
        format!("window.__hmsDesktopDeliver&&window.__hmsDesktopDeliver({json});")
    }
}

/// A side effect the shell must perform after a command; commands themselves never touch the window or WebView.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Effect {
    RetryConnection,
}

#[derive(Debug, PartialEq)]
pub struct Outcome {
    /// `None` when the message is too broken to answer (no usable id).
    pub reply: Option<Reply>,
    pub effect: Option<Effect>,
}

/// Shell facts commands may read. Kept small and free of PHI and workstation identity.
#[derive(Debug, Clone, Copy)]
pub struct Context {
    pub probe_in_flight: bool,
}

/// A command's typed result and the shell effect it asks for.
type CommandResult = Result<(Value, Option<Effect>), ErrorCode>;

struct Command {
    id: &'static str,
    allowed: &'static [Caller],
    run: fn(Value, &Context) -> CommandResult,
}

/// The complete allowlist. Adding a command requires a contract change and a threat model.
const COMMANDS: &[Command] = &[
    Command { id: "runtime.get_info", allowed: &[Caller::Startup, Caller::Hosted], run: runtime::get_info },
    Command { id: "startup.retry", allowed: &[Caller::Startup], run: runtime::retry },
];

pub fn handle(raw: &str, caller: Caller, ctx: &Context) -> Outcome {
    let none = Outcome { reply: None, effect: None };
    if raw.len() > MAX_MESSAGE_BYTES {
        return none;
    }
    let Ok(env) = serde_json::from_str::<Envelope>(raw) else {
        return none;
    };
    if !valid_id(&env.id) {
        return none;
    }
    let answer = |code| Outcome { reply: Some(Reply::err(env.id.clone(), code)), effect: None };
    if env.v != PROTOCOL_VERSION {
        return answer(ErrorCode::UnsupportedVersion);
    }
    let Some(command) = COMMANDS.iter().find(|c| c.id == env.cmd) else {
        return answer(ErrorCode::UnknownCommand);
    };
    if !command.allowed.contains(&caller) {
        return answer(ErrorCode::NotAllowed);
    }
    match (command.run)(env.args, ctx) {
        Ok((result, effect)) => Outcome { reply: Some(Reply::ok(env.id, result)), effect },
        Err(code) => answer(code),
    }
}

fn valid_id(id: &str) -> bool {
    (1..=MAX_ID_LEN).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Commands that take no arguments accept only `{}` (or an omitted `args`). Checked explicitly: serde would also
/// accept `[]` for an empty struct.
fn no_args(args: Value) -> Result<(), ErrorCode> {
    match args {
        Value::Object(m) if m.is_empty() => Ok(()),
        _ => Err(ErrorCode::InvalidArgs),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const IDLE: Context = Context { probe_in_flight: false };

    fn call(msg: Value, caller: Caller) -> Outcome {
        handle(&msg.to_string(), caller, &IDLE)
    }

    fn code(o: &Outcome) -> Option<ErrorCode> {
        o.reply.as_ref().and_then(Reply::error_code)
    }

    #[test]
    fn get_info_answers_both_callers() {
        for caller in [Caller::Startup, Caller::Hosted] {
            let o = call(json!({"v":1,"id":"a1","cmd":"runtime.get_info","args":{}}), caller);
            let r = o.reply.unwrap();
            assert!(r.ok);
            let result = r.result.unwrap();
            assert_eq!(result["protocol"], 1);
            assert_eq!(result["runtime_version"], env!("CARGO_PKG_VERSION"));
            assert_eq!(o.effect, None);
        }
    }

    #[test]
    fn args_may_be_omitted_for_no_arg_commands() {
        let o = call(json!({"v":1,"id":"a1","cmd":"runtime.get_info"}), Caller::Hosted);
        assert!(o.reply.unwrap().ok);
    }

    #[test]
    fn retry_is_startup_only() {
        let o = call(json!({"v":1,"id":"r","cmd":"startup.retry","args":{}}), Caller::Startup);
        assert_eq!(o.effect, Some(Effect::RetryConnection));
        assert!(o.reply.unwrap().ok);

        let o = call(json!({"v":1,"id":"r","cmd":"startup.retry","args":{}}), Caller::Hosted);
        assert_eq!(code(&o), Some(ErrorCode::NotAllowed));
        assert_eq!(o.effect, None);
    }

    #[test]
    fn retry_while_probing_is_busy_and_has_no_effect() {
        let msg = json!({"v":1,"id":"r","cmd":"startup.retry"}).to_string();
        let o = handle(&msg, Caller::Startup, &Context { probe_in_flight: true });
        assert_eq!(code(&o), Some(ErrorCode::Busy));
        assert_eq!(o.effect, None);
    }

    #[test]
    fn unknown_commands_are_refused_not_dispatched() {
        for cmd in ["", "shell.exec", "runtime.get_info ", "RUNTIME.GET_INFO", "runtime", "fs.read", "__proto__"] {
            let o = call(json!({"v":1,"id":"x","cmd":cmd,"args":{}}), Caller::Hosted);
            assert_eq!(code(&o), Some(ErrorCode::UnknownCommand), "{cmd:?}");
            assert_eq!(o.effect, None);
        }
    }

    #[test]
    fn unexpected_args_are_invalid() {
        for args in [json!({"path":"C:\\"}), json!([]), json!("x"), json!(1), json!(null)] {
            let o = call(json!({"v":1,"id":"x","cmd":"runtime.get_info","args":args}), Caller::Hosted);
            assert_eq!(code(&o), Some(ErrorCode::InvalidArgs), "{args}");
        }
    }

    #[test]
    fn other_protocol_versions_are_refused() {
        for v in [0, 2, 999] {
            let o = call(json!({"v":v,"id":"x","cmd":"runtime.get_info"}), Caller::Hosted);
            assert_eq!(code(&o), Some(ErrorCode::UnsupportedVersion));
        }
    }

    #[test]
    fn malformed_messages_get_no_reply() {
        let long_id = "a".repeat(MAX_ID_LEN + 1);
        for raw in [
            String::new(),
            "not json".into(),
            "[]".into(),
            "null".into(),
            json!({"id":"x","cmd":"runtime.get_info"}).to_string(),
            json!({"v":1,"cmd":"runtime.get_info"}).to_string(),
            json!({"v":1,"id":"x"}).to_string(),
            json!({"v":"1","id":"x","cmd":"runtime.get_info"}).to_string(),
            json!({"v":1,"id":"x","cmd":"runtime.get_info","extra":true}).to_string(),
            json!({"v":1,"id":"","cmd":"runtime.get_info"}).to_string(),
            json!({"v":1,"id":long_id,"cmd":"runtime.get_info"}).to_string(),
            json!({"v":1,"id":"a\");alert(1);//","cmd":"runtime.get_info"}).to_string(),
            json!({"v":1,"id":"\u{2028}","cmd":"runtime.get_info"}).to_string(),
        ] {
            assert_eq!(handle(&raw, Caller::Hosted, &IDLE), Outcome { reply: None, effect: None }, "{raw}");
        }
    }

    #[test]
    fn oversized_messages_are_dropped_before_parsing() {
        let pad = "x".repeat(MAX_MESSAGE_BYTES);
        let raw = json!({"v":1,"id":"x","cmd":"runtime.get_info","args":{},"pad":pad}).to_string();
        assert_eq!(handle(&raw, Caller::Hosted, &IDLE).reply, None);

        let base = json!({"v":1,"id":"x","cmd":"runtime.get_info"}).to_string();
        let just_fits = format!("{base}{}", " ".repeat(MAX_MESSAGE_BYTES - base.len()));
        assert_eq!(just_fits.len(), MAX_MESSAGE_BYTES);
        assert!(handle(&just_fits, Caller::Hosted, &IDLE).reply.unwrap().ok);
    }

    #[test]
    fn delivery_script_is_a_single_inert_call() {
        let o = call(json!({"v":1,"id":"a_1-B","cmd":"nope"}), Caller::Hosted);
        let script = o.reply.unwrap().to_delivery_script();
        assert_eq!(
            script,
            r#"window.__hmsDesktopDeliver&&window.__hmsDesktopDeliver({"v":1,"id":"a_1-B","ok":false,"error":{"code":"unknown_command"}});"#
        );
    }

    #[test]
    fn every_command_is_unique_and_namespaced() {
        let mut ids: Vec<_> = COMMANDS.iter().map(|c| c.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), COMMANDS.len());
        for c in COMMANDS {
            assert!(c.id.contains('.') && !c.allowed.is_empty(), "{}", c.id);
        }
    }
}
