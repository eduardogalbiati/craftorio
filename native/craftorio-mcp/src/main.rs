// craftorio-mcp (#341): the supervisor's and the Oracle's stdio MCP server, the Rust twin of
// src/supervisor-mcp.js (the app starts this binary when it exists, else the JS script; see
// mcpCommand in src/supervisor-bridge.js). Newline-delimited JSON-RPC 2.0 on stdin/stdout;
// tools/list and tools/call go to the app's loopback bridge (SUPERVISOR_BRIDGE_URL,
// SUPERVISOR_BRIDGE_TOKEN). Each request is answered on its own thread, like the JS server's
// async handler, so a slow tool never holds up a ping. Exits 0 once stdin closes and every
// pending reply is written.

mod bridge;
mod rpc;

use serde_json::Value;
use std::io::{self, BufRead, Write};
use std::process::ExitCode;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

fn main() -> ExitCode {
    let bridge = Arc::new(bridge::Bridge::from_env());
    let out = Arc::new(Mutex::new(io::stdout()));
    let mut input = io::stdin().lock();
    let mut workers: Vec<JoinHandle<()>> = Vec::new();
    let mut line = Vec::new();
    loop {
        line.clear();
        match input.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        match rpc::parse_line(&String::from_utf8_lossy(&line)) {
            rpc::Incoming::Ignore => {}
            rpc::Incoming::Reply(reply) => write(&out, &reply),
            rpc::Incoming::Request { id, msg } => {
                let failed = id.clone();
                let (bridge, thread_out) = (Arc::clone(&bridge), Arc::clone(&out));
                let answer = move || {
                    let reply = rpc::respond(id, &msg, |route, body| bridge.post(route, body));
                    write(&thread_out, &reply);
                };
                match thread::Builder::new().spawn(answer) {
                    Ok(handle) => workers.push(handle),
                    Err(e) => write(&out, &rpc::internal_error(failed, &e.to_string())),
                }
            }
        }
        workers.retain(|w| !w.is_finished());
    }
    for w in workers {
        let _ = w.join();
    }
    ExitCode::SUCCESS
}

// One reply per line. A closed stdout (claude went away) is not an error worth crashing for.
fn write(out: &Mutex<io::Stdout>, reply: &Value) {
    let text = reply.to_string();
    let mut out = match out.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let _ = writeln!(out, "{text}");
    let _ = out.flush();
}
