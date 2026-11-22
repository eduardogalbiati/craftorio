// What src/session-tail.js prints for each event, line for line: print (a session's log) and
// print_orchestrator (a run's events.jsonl). Each returns the text to write, or None where the JS
// throws (a missing `session`, a `cost_usd` that is not a number, a `command` that is not a string),
// so the line is skipped like the JS's caught error.

use crate::js::{self, get, or, string, truthy};
use jiff::Timestamp;
use jiff::civil::{Date, DateTime};
use jiff::tz::TimeZone;
use serde_json::Value;

fn c(code: &str, s: &str) -> String {
    format!("\x1b[{code}m{s}\x1b[0m")
}
pub fn dim(s: &str) -> String {
    c("2", s)
}
fn bold(s: &str) -> String {
    c("1", s)
}
fn cyan(s: &str) -> String {
    c("36", s)
}
fn yellow(s: &str) -> String {
    c("33", s)
}
fn green(s: &str) -> String {
    c("32", s)
}
fn red(s: &str) -> String {
    c("31", s)
}
fn magenta(s: &str) -> String {
    c("35", s)
}

/// The printer: the session it follows and the local time zone of `toLocaleTimeString`.
pub struct Printer {
    pub orchestrator: bool,
    pub tz: TimeZone,
}

const MAX_DATE_MS: f64 = 8.64e15;

impl Printer {
    /// `new Date(ts)`: its epoch milliseconds, None for an Invalid Date.
    fn date_ms(&self, ts: Option<&Value>) -> Option<i64> {
        let ms = match ts {
            None => return None,
            Some(Value::Null) => 0.0,
            Some(Value::Bool(b)) => f64::from(u8::from(*b)),
            Some(Value::Number(n)) => n.as_f64()?,
            Some(Value::String(s)) => return self.parse_date(js::trim(s)),
            Some(_) => return None,
        };
        if !ms.is_finite() || ms.abs() > MAX_DATE_MS {
            return None;
        }
        Some(ms.trunc() as i64)
    }

    // ISO forms: with an offset (or Z) an instant, a date-time without one local, a date alone UTC
    fn parse_date(&self, s: &str) -> Option<i64> {
        if let Ok(t) = s.parse::<Timestamp>() {
            return Some(t.as_millisecond());
        }
        if let Ok(dt) = s.parse::<DateTime>() {
            return dt
                .to_zoned(self.tz.clone())
                .ok()
                .map(|z| z.timestamp().as_millisecond());
        }
        if let Ok(d) = s.parse::<Date>() {
            return d
                .to_zoned(TimeZone::UTC)
                .ok()
                .map(|z| z.timestamp().as_millisecond());
        }
        None
    }

    /// session-tail.js's time(ts): `toLocaleTimeString('en-US', { hour12: false })`, dimmed.
    fn time(&self, ts: Option<&Value>) -> String {
        let shown = self
            .date_ms(ts)
            .and_then(|ms| Timestamp::from_millisecond(ms).ok())
            .map(|t| t.to_zoned(self.tz.clone()))
            .map_or_else(
                || "Invalid Date".to_string(),
                |z| format!("{:02}:{:02}:{:02}", z.hour(), z.minute(), z.second()),
            );
        dim(&shown)
    }

    /// The lines one event prints (each ending in "\n"), or None when the JS would throw.
    pub fn event(&self, ev: &Value) -> Option<String> {
        if self.orchestrator {
            self.print_orchestrator(ev)
        } else {
            self.print(ev)
        }
    }

    fn print(&self, ev: &Value) -> Option<String> {
        let e = Some(ev);
        let field = |k: &str| get(e, k);
        let mut out = Vec::new();
        match field("type").and_then(Value::as_str) {
            Some("session.opened") => {
                let s = session(e)?;
                out.push(format!(
                    "{}{}",
                    bold(&string(get(s, "agent"))),
                    dim(&format!(
                        " · {} · {} · {}",
                        string(get(s, "provider")),
                        string(get(s, "model")),
                        string(field("session_id"))
                    ))
                ));
            }
            Some("session.message_sent") => {
                out.push(format!(
                    "\n{} {} {}",
                    self.time(field("ts")),
                    bold(&cyan(&format!("── turn {}", string(field("turn"))))),
                    dim(&or(field("step_id"), ""))
                ));
                out.push(dim(&format!(
                    "    prompt: {}",
                    js::indent(&js::clip(field("prompt"), 1500))
                )));
            }
            Some("session.stream") => {
                let item = field("item");
                let it = if truthy(item) { item } else { None };
                let t = self.time(field("ts"));
                let kind = get(it, "kind").and_then(Value::as_str);
                match kind {
                    Some("thinking") => out.push(format!(
                        "{t} {}  {}",
                        magenta("thinking"),
                        dim(&js::indent(&js::clip(get(it, "text"), 2000)))
                    )),
                    Some("text") => out.push(format!(
                        "{t} {}      {}",
                        green("text"),
                        js::indent(&string(get(it, "text")))
                    )),
                    Some("tool_call") => {
                        let input = get(it, "input");
                        let command = get(input, "command");
                        // it.input?.command ?? JSON.stringify(it.input ?? '')
                        let shown = if js::nullish(command) {
                            let empty = Value::String(String::new());
                            js::clip_str(
                                &js::stringify(input.filter(|v| !v.is_null()).unwrap_or(&empty)),
                                400,
                            )
                        } else {
                            js::clip(command, 400)
                        };
                        out.push(format!(
                            "{t} {}      {} {}",
                            yellow("tool"),
                            bold(&or(get(it, "name"), "?")),
                            dim(&shown)
                        ));
                    }
                    Some("tool_result") => {
                        let label = if truthy(get(it, "is_error")) {
                            red("error")
                        } else {
                            dim("result")
                        };
                        out.push(format!(
                            "{t} {label}    {}",
                            dim(&js::indent(&js::clip(get(it, "output"), 800)))
                        ));
                    }
                    Some("stderr") => out.push(format!(
                        "{t} {}    {}",
                        red("stderr"),
                        dim(&js::clip(get(it, "text"), 600))
                    )),
                    Some("spawn") => {
                        let command = get(it, "command")?.as_str()?;
                        let args = match get(it, "args") {
                            a if !truthy(a) => String::new(),
                            Some(Value::Array(items)) => items
                                .iter()
                                .map(|x| {
                                    if js::nullish(Some(x)) {
                                        String::new()
                                    } else {
                                        string(Some(x))
                                    }
                                })
                                .collect::<Vec<_>>()
                                .join(" "),
                            _ => return None,
                        };
                        out.push(format!(
                            "{t} {}",
                            dim(&format!("$ {} {args}", js::basename(command)))
                        ));
                    }
                    Some("session") => out.push(format!(
                        "{t} {}",
                        dim(&format!(
                            "provider session {}",
                            string(get(it, "sessionId"))
                        ))
                    )),
                    _ => {}
                }
            }
            Some("session.message_received") => {
                let usage = field("usage");
                let u = if truthy(usage) { usage } else { None };
                let cost = cost(field("cost_usd"))?;
                out.push(format!(
                    "{} {}      {}",
                    self.time(field("ts")),
                    cyan("done"),
                    dim(&format!(
                        "{}s · in {} · cache {} · out {}{cost}",
                        seconds(field("duration_ms")),
                        or(get(u, "input"), "0"),
                        or(get(u, "cache_read"), "0"),
                        or(get(u, "output"), "0")
                    ))
                ));
            }
            Some("session.status") => {
                if let Some(status @ ("retrying" | "error")) =
                    field("status").and_then(Value::as_str)
                {
                    out.push(format!("{} {}", self.time(field("ts")), red(status)));
                }
            }
            Some("session.closed") => out.push(format!(
                "\n{} {}  {}",
                self.time(field("ts")),
                bold(&format!("session closed: {}", string(field("status")))),
                dim("(you can close this window)")
            )),
            _ => {}
        }
        Some(lines(out))
    }

    fn print_orchestrator(&self, ev: &Value) -> Option<String> {
        let e = Some(ev);
        let field = |k: &str| get(e, k);
        let t = self.time(field("ts"));
        let not_orchestrator =
            || field("session_id").and_then(Value::as_str) != Some("orchestrator");
        let mut out = Vec::new();
        match field("type").and_then(Value::as_str) {
            Some("workflow.started") => {
                let simulation = if truthy(field("mock")) {
                    yellow(" (simulation)")
                } else {
                    String::new()
                };
                out.push(format!(
                    "{t} {}{simulation}",
                    bold(&format!(
                        "▶ {} {}",
                        string(field("workflow")),
                        or(field("version"), "")
                    ))
                ));
                let inputs = field("inputs").filter(|v| truthy(Some(v)));
                for (k, v) in inputs.map(js::entries).unwrap_or_default() {
                    out.push(dim(&format!(
                        "    {k}: {}",
                        js::clip_str(&js::collapse_spaces(&string(Some(&v))), 160)
                    )));
                }
            }
            Some("step.started") => {
                let agent = if truthy(field("agent")) {
                    format!(" · {}", string(field("agent")))
                } else {
                    String::new()
                };
                out.push(format!(
                    "\n{t} {} {}",
                    bold(&cyan(&format!("▶ {}", string(field("step_id"))))),
                    dim(&format!("visit {}{agent}", string(field("visit"))))
                ));
            }
            Some("step.finished") => {
                let output = field("output").map(js::stringify).unwrap_or_default();
                out.push(format!(
                    "{t} {} {} {}",
                    green("✓"),
                    string(field("step_id")),
                    dim(&js::clip_str(&output, 300))
                ));
            }
            Some("step.transition") => out.push(format!(
                "{t} {}",
                dim(&format!(
                    "→ {}   [{}]",
                    string(field("to")),
                    string(field("when"))
                ))
            )),
            Some("step.waiting") => out.push(format!(
                "{t} {}",
                dim(&format!(
                    "⏳ /loop: next check in {}s",
                    seconds(field("interval_ms"))
                ))
            )),
            Some("step.goal") => {
                let label = if truthy(field("met")) {
                    green("🎯 goal met")
                } else {
                    yellow("🎯 goal pending")
                };
                out.push(format!("{t} {label} {}", dim(&or(field("goal"), ""))));
            }
            Some("session.opened") => {
                if not_orchestrator() {
                    let s = session(e)?;
                    out.push(format!(
                        "{t} {}",
                        dim(&format!(
                            "+ session {} {} ({}/{})",
                            string(field("session_id")),
                            string(get(s, "agent")),
                            string(get(s, "provider")),
                            string(get(s, "model"))
                        ))
                    ));
                }
            }
            Some("session.closed") => {
                if not_orchestrator() {
                    out.push(format!(
                        "{t} {}",
                        dim(&format!(
                            "- session {} {}",
                            string(field("session_id")),
                            string(field("status"))
                        ))
                    ));
                }
            }
            Some("session.message_received") => {
                let cost = cost(field("cost_usd"))?;
                out.push(format!(
                    "{t} {}",
                    dim(&format!(
                        "  {} answered in {}s{cost}",
                        string(field("session_id")),
                        seconds(field("duration_ms"))
                    ))
                ));
            }
            Some("approval.requested") => out.push(format!(
                "{t} {} {}",
                bold(&yellow("? approval needed")),
                js::indent(&or(field("message"), ""))
            )),
            Some("approval.resolved") => {
                let choice = if js::nullish(field("choice")) {
                    (if truthy(field("approved")) {
                        "approved"
                    } else {
                        "rejected"
                    })
                    .to_string()
                } else {
                    string(field("choice"))
                };
                out.push(format!(
                    "{t} {}",
                    yellow(&format!("  decision: {choice} ({})", string(field("by"))))
                ));
            }
            Some("action.executed") => {
                let what = if truthy(field("skipped")) {
                    "skipped (simulation)".to_string()
                } else {
                    format!("exit {}", string(field("exit_code")))
                };
                out.push(format!(
                    "{t} {}",
                    dim(&format!("$ {} → {what}", string(field("command"))))
                ));
            }
            Some("file.saved") => out.push(format!(
                "{t} {}",
                dim(&format!("💾 {}", string(field("path"))))
            )),
            Some("decision.logged") => out.push(format!(
                "{t} {}",
                dim(&format!(
                    "📝 {}: {} decision(s)",
                    string(field("agent")),
                    string(field("count"))
                ))
            )),
            Some("supervisor.started") => out.push(format!(
                "{t} {} called on {}: {}",
                bold(&magenta("◆ supervisor")),
                string(field("step_id")),
                dim(&js::clip(field("error"), 300))
            )),
            Some("supervisor.decision") => {
                let goto = if truthy(field("goto")) {
                    format!(" {}", string(field("goto")))
                } else {
                    String::new()
                };
                let instruction = if truthy(field("instruction")) {
                    format!(
                        "\n    {}",
                        dim(&format!(
                            "instruction: {}",
                            js::indent(&string(field("instruction")))
                        ))
                    )
                } else {
                    String::new()
                };
                out.push(format!(
                    "{t} {} {}{instruction}",
                    bold(&magenta(&format!(
                        "◆ supervisor → {}{goto}",
                        string(field("action"))
                    ))),
                    js::indent(&or(field("explanation"), ""))
                ));
            }
            Some("budget.exceeded") => out.push(format!(
                "{t} {}",
                red(&format!(
                    "💸 {} reached its monthly budget",
                    string(field("provider"))
                ))
            )),
            Some("limit.exceeded") => out.push(format!(
                "{t} {}",
                red(&format!("limit exceeded: {}", string(field("limit"))))
            )),
            Some("log") => {
                let message = string(field("message"));
                let shown = match field("level").and_then(Value::as_str) {
                    Some("error") => red(&message),
                    Some("warn") => yellow(&message),
                    _ => dim(&message),
                };
                out.push(format!("{t} {shown}"));
            }
            Some("workflow.finished") => {
                let status = field("status");
                let label = format!("■ {}", string(status));
                let label = if status.and_then(Value::as_str) == Some("success") {
                    green(&label)
                } else {
                    red(&label)
                };
                let error = if truthy(field("error")) {
                    format!(" {}", red(&string(field("error"))))
                } else {
                    String::new()
                };
                out.push(format!("\n{t} {}{error}", bold(&label)));
                let summary = field("summary");
                if truthy(summary) {
                    let secs = js::number(js::round(
                        js::to_number(get(summary, "duration_ms")) / 1000.0,
                    ));
                    out.push(dim(&format!(
                        "    {secs}s · ${}",
                        string(get(summary, "cost_usd"))
                    )));
                }
            }
            _ => {}
        }
        Some(lines(out))
    }
}

// `ev.session`, where reading `.agent` of undefined or null throws
fn session(e: Option<&Value>) -> Option<Option<&Value>> {
    let s = get(e, "session");
    if js::nullish(s) { None } else { Some(s) }
}

// ` · $0.5000` when cost_usd != null; None (a TypeError in JS) when it is not a number
fn cost(v: Option<&Value>) -> Option<String> {
    if js::nullish(v) {
        return Some(String::new());
    }
    let x = v?.as_f64()?;
    Some(format!(" · ${}", js::to_fixed(x, 4)))
}

// Math.round((x || 0) / 1000)
fn seconds(v: Option<&Value>) -> String {
    let ms = if truthy(v) { js::to_number(v) } else { 0.0 };
    js::number(js::round(ms / 1000.0))
}

fn lines(out: Vec<String>) -> String {
    out.into_iter().map(|l| format!("{l}\n")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn printer(orchestrator: bool) -> Printer {
        Printer {
            orchestrator,
            tz: TimeZone::UTC,
        }
    }

    #[test]
    fn a_missing_session_or_a_text_cost_skips_the_line() {
        let p = printer(false);
        assert_eq!(p.event(&json!({ "type": "session.opened" })), None);
        assert_eq!(
            p.event(&json!({ "type": "session.message_received", "cost_usd": "1" })),
            None
        );
        assert_eq!(
            p.event(
                &json!({ "type": "session.stream", "item": { "kind": "spawn", "command": 1 } })
            ),
            None
        );
        assert_eq!(p.event(&json!({ "type": "other" })), Some(String::new()));
    }

    #[test]
    fn times_are_local_and_an_invalid_date_says_so() {
        let p = printer(false);
        assert_eq!(
            p.time(Some(&json!("2026-10-13T12:00:05.000Z"))),
            dim("12:00:05")
        );
        assert_eq!(p.time(Some(&json!(0))), dim("00:00:00"));
        assert_eq!(p.time(None), dim("Invalid Date"));
        assert_eq!(p.time(Some(&json!("soon"))), dim("Invalid Date"));
    }

    #[test]
    fn the_run_summary_prints_seconds_and_cost() {
        let p = printer(true);
        let out = p.event(&json!({ "type": "workflow.finished", "ts": 0, "status": "success", "summary": { "duration_ms": 61000, "cost_usd": 1.25 } })).unwrap();
        assert!(
            out.ends_with(&format!("{}\n", dim("    61s · $1.25"))),
            "{out:?}"
        );
    }
}
