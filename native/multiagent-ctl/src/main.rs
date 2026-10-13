// multiagent-ctl (#342): the control channel's client (src/control/index.js), the Rust twin of
// scripts/ctl.js, shipped next to the app so an outside session needs neither Node nor a checkout.
//   multiagent-ctl <channel> [json-argument] [--workspace <dir>]   calls the channel, prints its result
//   multiagent-ctl --list [--workspace <dir>]                       the allowed channels, argument schemas
// The workspace is --workspace, else MULTIAGENT_WORKSPACE; the endpoint and its token come from
// <workspace>/control/endpoint.json (written while Settings › Execution › "Allow outside sessions to
// control this app" is on). It first checks the app's contract version (GET /api/version).
// Exit codes: 0 the result printed (pretty JSON); 1 a refused or failed call, or a usage error (the
// reason on stderr); 2 no endpoint (the switch is off); 3 the app speaks another contract version.

mod http;

use serde_json::Value;
use std::io::{self, Write};
use std::path::PathBuf;
use std::process::ExitCode;

/// The contract this client speaks: CONTROL_VERSION in src/control/index.js.
const CONTROL_VERSION: &str = "1";

const USAGE: &str = "Usage: multiagent-ctl <channel> [json-argument] [--workspace <dir>]\n       multiagent-ctl --list [--workspace <dir>]";

struct Failure {
    code: u8,
    message: String,
}

fn fail<T>(code: u8, message: impl Into<String>) -> Result<T, Failure> {
    Err(Failure {
        code,
        message: message.into(),
    })
}

struct Args {
    workspace: String,
    list: bool,
    channel: Option<String>,
    json: Option<String>,
}

fn parse_args(argv: Vec<String>) -> Result<Args, Failure> {
    let mut workspace = std::env::var("MULTIAGENT_WORKSPACE").unwrap_or_default();
    let mut list = false;
    let mut rest = Vec::new();
    let mut it = argv.into_iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--workspace" => workspace = it.next().unwrap_or_default(),
            "--list" => list = true,
            "--help" | "-h" => return fail(1, USAGE),
            _ => rest.push(a),
        }
    }
    let mut rest = rest.into_iter();
    let (channel, json) = (rest.next(), rest.next());
    if !list && channel.is_none() {
        return fail(1, USAGE);
    }
    if workspace.is_empty() {
        return fail(
            1,
            "No workspace: set MULTIAGENT_WORKSPACE or pass --workspace <dir>.",
        );
    }
    Ok(Args {
        workspace,
        list,
        channel,
        json,
    })
}

struct Endpoint {
    url: String,
    target: http::Target,
    token: String,
}

impl Endpoint {
    fn read(workspace: &str) -> Result<Endpoint, Failure> {
        let file: PathBuf = [workspace, "control", "endpoint.json"].iter().collect();
        let off = || {
            format!(
                "No control endpoint at {}: turn on Settings › Execution › \"Allow outside sessions to control this app\".",
                file.display()
            )
        };
        let Ok(text) = std::fs::read_to_string(&file) else {
            return fail(2, off());
        };
        let Ok(json) = serde_json::from_str::<Value>(&text) else {
            return fail(2, off());
        };
        let field = |k: &str| {
            json.get(k)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        let (url, token) = (field("url"), field("token"));
        let target = http::Target::parse(&url).or_else(|e| fail(2, format!("{}: {e}", off())))?;
        Ok(Endpoint { url, target, token })
    }

    /// The JSON the app answers on 200; else a failure with its `error` (exit 1).
    fn call(
        &self,
        what: &str,
        method: &str,
        route: &str,
        body: Option<&str>,
    ) -> Result<Value, Failure> {
        let (status, raw) = self
            .target
            .request(method, route, &self.token, body)
            .or_else(|e| {
                fail(
                    1,
                    format!("{what}: the app is not answering at {} ({e}).", self.url),
                )
            })?;
        let parsed = serde_json::from_slice::<Value>(&raw).ok();
        if status != 200 {
            let error = parsed
                .as_ref()
                .and_then(|p| p.get("error"))
                .and_then(Value::as_str)
                .map_or_else(
                    || String::from_utf8_lossy(&raw).into_owned(),
                    str::to_string,
                );
            return fail(1, format!("{what}: {status} {error}"));
        }
        Ok(parsed.unwrap_or(Value::Null))
    }

    /// The app's contract version must be this client's (exit 3 otherwise).
    fn check_version(&self) -> Result<(), Failure> {
        let mismatch = |found: &str| {
            fail(
                3,
                format!(
                    "The app's control channel speaks version {found}, this multiagent-ctl version {CONTROL_VERSION}: use the multiagent-ctl shipped with the app (Settings › Execution shows its path)."
                ),
            )
        };
        match self.call("version", "GET", "/api/version", None) {
            Ok(v) => match v.get("version").and_then(Value::as_str) {
                Some(found) if found == CONTROL_VERSION => Ok(()),
                Some(found) => mismatch(found),
                None => mismatch("(none)"),
            },
            // an app older than the version route answers 404/405: another contract
            Err(f)
                if f.message.starts_with("version: 404 ")
                    || f.message.starts_with("version: 405 ") =>
            {
                mismatch("(none: an older app)")
            }
            Err(f) => Err(f),
        }
    }
}

// `--list`: one channel per line with its argument schema (compact JSON)
fn list(endpoint: &Endpoint) -> Result<String, Failure> {
    let answer = endpoint.call("--list", "GET", "/api/channels", None)?;
    let mut out = String::new();
    for c in answer
        .get("channels")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let name = c.get("channel").and_then(Value::as_str).unwrap_or_default();
        let schema = match c.get("schema") {
            Some(s) if !s.is_null() => s.to_string(),
            _ => "(no argument)".to_string(),
        };
        out.push_str(&format!("{name}  {schema}\n"));
    }
    Ok(out)
}

fn run(argv: Vec<String>) -> Result<String, Failure> {
    let args = parse_args(argv)?;
    let endpoint = Endpoint::read(&args.workspace)?;
    endpoint.check_version()?;
    if args.list {
        return list(&endpoint);
    }
    let channel = args.channel.unwrap_or_default();
    let body = match &args.json {
        None => "{}".to_string(),
        Some(text) => match serde_json::from_str::<Value>(text) {
            Ok(arg) => serde_json::json!({ "arg": arg }).to_string(),
            Err(_) => return fail(1, format!("The argument is not valid JSON: {text}")),
        },
    };
    let route = format!("/api/{}", http::encode_component(&channel));
    let answer = endpoint.call(&channel, "POST", &route, Some(&body))?;
    let result = answer.get("result").cloned().unwrap_or(Value::Null);
    serde_json::to_string_pretty(&result)
        .map(|s| format!("{s}\n"))
        .or_else(|e| fail(1, format!("{channel}: {e}")))
}

fn main() -> ExitCode {
    let argv = std::env::args_os()
        .skip(1)
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    match run(argv) {
        Ok(text) => {
            let mut out = io::stdout().lock();
            let _ = out.write_all(text.as_bytes()).and_then(|()| out.flush());
            ExitCode::SUCCESS
        }
        Err(f) => {
            let _ = writeln!(io::stderr(), "{}", f.message);
            ExitCode::from(f.code)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Result<Args, Failure> {
        parse_args(list.iter().map(|s| s.to_string()).collect())
    }

    #[test]
    fn arguments_and_the_workspace_option() {
        let a = args(&[
            "roadmap:get",
            "{\"projectId\":\"x\"}",
            "--workspace",
            "C:/ws",
        ])
        .ok()
        .unwrap();
        assert_eq!(
            (
                a.channel.as_deref(),
                a.json.as_deref(),
                a.workspace.as_str(),
                a.list
            ),
            (
                Some("roadmap:get"),
                Some("{\"projectId\":\"x\"}"),
                "C:/ws",
                false
            )
        );
        assert!(args(&["--list", "--workspace", "w"]).ok().unwrap().list);
        assert_eq!(args(&["--workspace", "w"]).err().unwrap().code, 1);
    }

    #[test]
    fn no_endpoint_file_is_exit_2() {
        let dir = std::env::temp_dir().join(format!("ctl-none-{}", std::process::id()));
        let f = Endpoint::read(&dir.to_string_lossy()).err().unwrap();
        assert_eq!(f.code, 2);
        assert!(f.message.contains("endpoint.json"), "{}", f.message);
    }

    #[test]
    fn the_contract_version_matches_the_apps() {
        let js = include_str!("../../../src/control/index.js");
        assert!(
            js.contains(&format!("const CONTROL_VERSION = '{CONTROL_VERSION}';")),
            "CONTROL_VERSION differs from src/control/index.js"
        );
    }
}
