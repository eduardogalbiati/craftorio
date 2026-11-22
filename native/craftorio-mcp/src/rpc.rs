// The MCP side: one stdin line in, at most one JSON-RPC 2.0 reply out. Answers exactly like
// src/supervisor-mcp.js (the same replies, error codes and messages); the bridge is a function so
// this module never touches the network.

use serde_json::{Map, Value, json};

pub const PROTOCOL: &str = "2025-06-18";
const INSTRUCTIONS: &str = "Read-only tools over the Craftorio app: workflows, projects, runs, skills, agents, usage and analytics.";
const INTERNAL_ERROR: i64 = -32603;
const METHOD_NOT_FOUND: i64 = -32601;
const PARSE_ERROR: i64 = -32700;

/// What a stdin line asks for.
#[derive(Debug, PartialEq)]
pub enum Incoming {
    /// A blank line, a notification (no id) or a message that is not an object: no reply.
    Ignore,
    /// A reply that needs no handling (a parse error).
    Reply(Value),
    /// A request to answer with `respond`.
    Request { id: Value, msg: Value },
}

pub fn parse_line(line: &str) -> Incoming {
    let line = line.trim();
    if line.is_empty() {
        return Incoming::Ignore;
    }
    let msg: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return Incoming::Reply(error_reply(Value::Null, PARSE_ERROR, "Parse error")),
    };
    match msg.get("id") {
        None | Some(Value::Null) => Incoming::Ignore,
        Some(id) => Incoming::Request {
            id: id.clone(),
            msg,
        },
    }
}

/// The reply to a request. `bridge(route, body)` posts to the app's loopback bridge.
pub fn respond<F>(id: Value, msg: &Value, bridge: F) -> Value
where
    F: Fn(&str, &Value) -> Result<Value, String>,
{
    match handle(msg, bridge) {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => error_reply(id, code, &message),
    }
}

/// The reply to a request that could not be handled at all (no thread to answer it on).
pub fn internal_error(id: Value, message: &str) -> Value {
    error_reply(id, INTERNAL_ERROR, message)
}

fn error_reply(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn handle<F>(msg: &Value, bridge: F) -> Result<Value, (i64, String)>
where
    F: Fn(&str, &Value) -> Result<Value, String>,
{
    let params = msg.get("params");
    let param = |key: &str| params.and_then(|p| p.get(key));
    let internal = |e: String| (INTERNAL_ERROR, e);
    match msg.get("method") {
        Some(Value::String(m)) if m == "initialize" => {
            let protocol = param("protocolVersion")
                .filter(|v| truthy(v))
                .cloned()
                .unwrap_or_else(|| Value::from(PROTOCOL));
            Ok(json!({
                "protocolVersion": protocol,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "orchestrator", "version": "1.0.0" },
                "instructions": INSTRUCTIONS,
            }))
        }
        Some(Value::String(m)) if m == "ping" => Ok(json!({})),
        Some(Value::String(m)) if m == "tools/list" => {
            let out = bridge("/tools/list", &json!({})).map_err(internal)?;
            Ok(object(vec![("tools", out.get("tools").cloned())]))
        }
        Some(Value::String(m)) if m == "tools/call" => {
            let arguments = param("arguments")
                .filter(|v| truthy(v))
                .cloned()
                .unwrap_or_else(|| json!({}));
            let body = object(vec![
                ("name", param("name").cloned()),
                ("arguments", Some(arguments)),
            ]);
            let out = bridge("/tools/call", &body).map_err(internal)?;
            tool_result(&out).map_err(internal)
        }
        method => Err((
            METHOD_NOT_FOUND,
            format!("Method not found: {}", js_string(method)),
        )),
    }
}

// The bridge's { text, isError, images? } as MCP content: the text first, then each image.
fn tool_result(out: &Value) -> Result<Value, String> {
    let mut content = vec![object(vec![
        ("type", Some(json!("text"))),
        ("text", out.get("text").cloned()),
    ])];
    match out.get("images") {
        Some(Value::Array(images)) => {
            for i in images {
                content.push(object(vec![
                    ("type", Some(json!("image"))),
                    ("data", i.get("data").cloned()),
                    ("mimeType", i.get("mimeType").cloned()),
                ]));
            }
        }
        Some(v) if truthy(v) => return Err("The bridge's images are not a list".to_string()),
        _ => {}
    }
    let is_error = out.get("isError").is_some_and(truthy);
    Ok(json!({ "content": content, "isError": is_error }))
}

// An object without its absent fields (JSON.stringify drops undefined).
fn object(fields: Vec<(&str, Option<Value>)>) -> Value {
    let map: Map<String, Value> = fields
        .into_iter()
        .filter_map(|(k, v)| v.map(|v| (k.to_string(), v)))
        .collect();
    Value::Object(map)
}

// JavaScript truthiness, as the JS server's `||` and `!!` see it.
fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

// How a template literal prints a method: a string as is, undefined when absent.
fn js_string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(v) => v.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_bridge(_: &str, _: &Value) -> Result<Value, String> {
        panic!("the bridge is not called")
    }

    #[test]
    fn blank_lines_and_notifications_are_ignored() {
        assert_eq!(parse_line(""), Incoming::Ignore);
        assert_eq!(parse_line("  \r"), Incoming::Ignore);
        assert_eq!(
            parse_line(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#),
            Incoming::Ignore
        );
        assert_eq!(
            parse_line(r#"{"jsonrpc":"2.0","id":null,"method":"ping"}"#),
            Incoming::Ignore
        );
        assert_eq!(parse_line("42"), Incoming::Ignore);
    }

    #[test]
    fn an_unparsable_line_is_a_parse_error_with_a_null_id() {
        let Incoming::Reply(r) = parse_line("{not json") else {
            panic!("a reply")
        };
        assert_eq!(r["id"], Value::Null);
        assert_eq!(r["error"]["code"], -32700);
        assert_eq!(r["error"]["message"], "Parse error");
    }

    #[test]
    fn a_request_keeps_its_id_and_a_crlf_line_parses() {
        let Incoming::Request { id, .. } = parse_line("{\"id\":\"abc\",\"method\":\"ping\"}\r")
        else {
            panic!("a request")
        };
        assert_eq!(id, json!("abc"));
    }

    #[test]
    fn initialize_echoes_a_protocol_version_or_answers_the_default() {
        let r = respond(
            json!(1),
            &json!({ "method": "initialize", "params": { "protocolVersion": "2024-01-01" } }),
            no_bridge,
        );
        assert_eq!(r["result"]["protocolVersion"], "2024-01-01");
        assert_eq!(r["result"]["capabilities"], json!({ "tools": {} }));
        let r = respond(
            json!(1),
            &json!({ "method": "initialize", "params": { "protocolVersion": "" } }),
            no_bridge,
        );
        assert_eq!(r["result"]["protocolVersion"], PROTOCOL);
        let r = respond(json!(1), &json!({ "method": "initialize" }), no_bridge);
        assert_eq!(r["result"]["serverInfo"]["name"], "orchestrator");
    }

    #[test]
    fn an_unknown_or_missing_method_is_not_found() {
        let r = respond(json!(5), &json!({ "method": "nope/nothing" }), no_bridge);
        assert_eq!(r["error"]["code"], -32601);
        assert_eq!(r["error"]["message"], "Method not found: nope/nothing");
        let r = respond(json!(5), &json!({}), no_bridge);
        assert_eq!(r["error"]["message"], "Method not found: undefined");
    }

    #[test]
    fn tools_call_forwards_the_name_and_an_empty_object_without_arguments() {
        let r = respond(
            json!(3),
            &json!({ "method": "tools/call", "params": { "name": "keys" } }),
            |route, body| {
                assert_eq!(route, "/tools/call");
                assert_eq!(body, &json!({ "name": "keys", "arguments": {} }));
                Ok(json!({ "text": "ok", "isError": 0 }))
            },
        );
        assert_eq!(
            r["result"],
            json!({ "content": [{ "type": "text", "text": "ok" }], "isError": false })
        );
    }

    #[test]
    fn tools_call_puts_images_after_the_text() {
        let r = respond(
            json!(8),
            &json!({ "method": "tools/call", "params": { "name": "v" } }),
            |_, _| {
                Ok(
                    json!({ "text": "t", "isError": true, "images": [{ "data": "AA==", "mimeType": "image/png", "extra": 1 }] }),
                )
            },
        );
        assert_eq!(
            r["result"],
            json!({ "content": [{ "type": "text", "text": "t" }, { "type": "image", "data": "AA==", "mimeType": "image/png" }], "isError": true })
        );
    }

    #[test]
    fn a_bridge_error_is_an_internal_error_with_its_message() {
        let r = respond(json!(9), &json!({ "method": "tools/list" }), |_, _| {
            Err("forbidden".to_string())
        });
        assert_eq!(
            r["error"],
            json!({ "code": -32603, "message": "forbidden" })
        );
        assert!(r.get("result").is_none());
    }

    #[test]
    fn tools_list_passes_the_tools_through() {
        let tools = json!([{ "name": "echo", "description": "echoes", "inputSchema": { "type": "object" } }]);
        let t = tools.clone();
        let r = respond(
            json!(2),
            &json!({ "method": "tools/list" }),
            move |route, _| {
                assert_eq!(route, "/tools/list");
                Ok(json!({ "tools": t.clone() }))
            },
        );
        assert_eq!(r["result"]["tools"], tools);
    }
}
