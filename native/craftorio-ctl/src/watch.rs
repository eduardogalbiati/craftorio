// `craftorio-ctl watch <projectId>` (#42): waits until a project's roadmap has something to report. Only reads
// (projects:list, roadmap:get, runs:active, runs:events). The twin of scripts/ctl.js's watch, the same reasons, texts
// and exit codes: both are tested on packages/engine/test/fixtures/ctl-watch-cases.json.

use crate::{Endpoint, Failure, fail};
use serde_json::{Value, json};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

pub const DEFAULT_STALL: &str = "900";
pub const DEFAULT_MAX: &str = "3600";
pub const TIMEOUT_CODE: u8 = 4;

const MAX_SECONDS: u64 = 604_800;
const POLL: Duration = Duration::from_millis(1500);
/// A run's whole event list is read to know whether it moved: at most this often.
const EVENTS: Duration = Duration::from_secs(30);

type Reason = (&'static str, String);

/// `--stall` and `--max`: a whole number of seconds, at most a week.
pub fn seconds(option: &str, text: &str) -> Result<u64, Failure> {
    let digits = (1..=6).contains(&text.len()) && text.bytes().all(|b| b.is_ascii_digit());
    match text.parse::<u64>() {
        Ok(n) if digits && (1..=MAX_SECONDS).contains(&n) => Ok(n),
        _ => fail(
            1,
            format!("{option} must be a whole number of seconds, from 1 to {MAX_SECONDS}."),
        ),
    }
}

/// The exit code and the line to print. The watch runs on its own thread: `max` holds also when the
/// app accepts a call and never answers it.
pub fn watch(
    endpoint: Endpoint,
    project_id: String,
    stall: u64,
    max: u64,
) -> Result<(u8, String), Failure> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || tx.send(watch_roadmap(&endpoint, &project_id, stall)));
    match rx.recv_timeout(Duration::from_secs(max)) {
        Ok(answer) => answer.map(|(reason, text)| (0, format!("{reason}: {text}\n"))),
        Err(mpsc::RecvTimeoutError::Timeout) => Ok((
            TIMEOUT_CODE,
            format!("timeout: nothing to report after {max} s\n"),
        )),
        Err(mpsc::RecvTimeoutError::Disconnected) => fail(1, "watch: stopped unexpectedly."),
    }
}

fn watch_roadmap(endpoint: &Endpoint, project_id: &str, stall: u64) -> Result<Reason, Failure> {
    endpoint.check_version()?;
    let projects = endpoint.call_channel("projects:list", None)?;
    if !elements(Some(&projects))
        .iter()
        .any(|p| text(p, "id") == project_id)
    {
        return fail(
            1,
            format!("watch: the app has no project \"{project_id}\" (projects:list names them)."),
        );
    }
    let stall_time = Duration::from_secs(stall);
    let project = json!({ "projectId": project_id });
    let mut first = None; // the stage in progress at the first reading
    let mut seen: Option<String> = None;
    let mut changed_at = Instant::now();
    let mut sampled_at = changed_at;
    loop {
        let roadmap = endpoint.call_channel("roadmap:get", Some(&project))?;
        let first = first.get_or_insert_with(|| current_stage(&roadmap));
        let runs = running_runs(&roadmap);
        let releases = elements(roadmap.get("stages"))
            .iter()
            .any(|s| is_release(s) && text(s, "status") == "running" && truthy(s, "runId"));
        let active = if releases {
            endpoint.call_channel("runs:active", None)?
        } else {
            Value::Null
        };
        if let Some(reason) = reason_of(&roadmap, first.as_ref(), &active) {
            return Ok(reason);
        }
        let now = Instant::now();
        let quiet = now.duration_since(changed_at);
        if seen.is_none()
            || now.duration_since(sampled_at) >= EVENTS.min(stall_time / 4)
            || quiet >= stall_time
        {
            let mark = event_mark(endpoint, &runs)?;
            let moved = seen.as_deref() != Some(mark.as_str());
            seen = Some(mark);
            sampled_at = now;
            if moved {
                changed_at = now;
            } else if quiet >= stall_time {
                let labels: Vec<&str> = runs.iter().map(|r| r.label.as_str()).collect();
                let running = if labels.is_empty() {
                    "nothing".to_string()
                } else {
                    labels.join(", ")
                };
                return Ok((
                    "stalled",
                    format!("no run event for {stall} s (running: {running})"),
                ));
            }
        }
        thread::sleep(POLL);
    }
}

/// How many events each run has and its last one: any other text means that a run moved.
fn event_mark(endpoint: &Endpoint, runs: &[Run]) -> Result<String, Failure> {
    let mut marks = Vec::new();
    for run in runs {
        let arg = json!({ "runId": run.id, "activity": true });
        let events = endpoint.call_channel("runs:events", Some(&arg))?;
        let events = elements(Some(&events));
        marks.push(json!([run.id, events.len(), events.last()]));
    }
    Ok(Value::Array(marks).to_string())
}

#[derive(Debug, PartialEq)]
struct Stage {
    id: String,
    label: String,
}

#[derive(Debug, PartialEq)]
struct Run {
    id: String,
    label: String,
}

fn elements(value: Option<&Value>) -> &[Value] {
    value
        .and_then(Value::as_array)
        .map_or(&[], |items| items.as_slice())
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or_default()
}

/// The key's text on one line.
fn line(value: &Value, key: &str) -> String {
    text(value, key)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// JavaScript's `!!value[key]`.
fn truthy(value: &Value, key: &str) -> bool {
    match value.get(key) {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => n.as_f64() != Some(0.0),
        Some(_) => true,
    }
}

fn is_release(entry: &Value) -> bool {
    text(entry, "kind") == "release"
}

// the rules of packages/shared/roadmap-model.js (isFinished, isOpen, currentStage, atGate)
fn is_finished(item: &Value) -> bool {
    match text(item, "status") {
        "done" | "parked" | "skipped" => true,
        "failed" => truthy(item, "parked"),
        _ => false,
    }
}

fn is_open(stage: &Value) -> bool {
    !is_release(stage)
        && !truthy(stage, "disabled")
        && elements(stage.get("items")).iter().any(|x| !is_finished(x))
}

// a finished item (parked, then failed) is never reported: the roadmap moved past it
fn at_gate(item: &Value) -> bool {
    let run_at_gate = item.get("run").is_some_and(|r| truthy(r, "atGate"));
    match text(item, "status") {
        "running" | "waiting_merge" => truthy(item, "waiting"),
        "failed" => !is_finished(item) && truthy(item, "runId") && run_at_gate,
        _ => false,
    }
}

/// How an item is named: its issues, else its workflow.
fn item_label(item: &Value) -> String {
    let numbers: Vec<String> = elements(item.get("issues"))
        .iter()
        .filter_map(|i| i.get("number").and_then(Value::as_i64))
        .map(|n| format!("#{n}"))
        .collect();
    if !numbers.is_empty() {
        return numbers.join(", ");
    }
    let workflow = line(item, "workflow");
    if workflow.is_empty() {
        "an item".to_string()
    } else {
        workflow
    }
}

/// The gate an item waits at: its step's id (the run's trail, its waiting step) and name ("review (Review)").
fn gate_step(item: &Value) -> String {
    let Some(run) = item.get("run") else {
        return String::new();
    };
    let id = elements(run.get("progress"))
        .iter()
        .rfind(|s| text(s, "status") == "waiting")
        .map(|s| line(s, "step"))
        .unwrap_or_default();
    let name = line(run, "atGate");
    if id.is_empty() || id == name {
        name
    } else if name.is_empty() {
        id
    } else {
        format!("{id} ({name})")
    }
}

fn release_label(entry: &Value) -> String {
    format!("release {}", line(entry, "name"))
}

/// The stage in progress; None: none is open.
fn current_stage(roadmap: &Value) -> Option<Stage> {
    let mut number = 0;
    for stage in elements(roadmap.get("stages")) {
        if !is_release(stage) {
            number += 1;
        }
        if is_open(stage) {
            let name = line(stage, "name");
            let label = if name.is_empty() || name == format!("Stage {number}") {
                format!("stage {number}")
            } else {
                format!("stage {number} ({name})")
            };
            let id = match text(stage, "id") {
                "" => number.to_string(),
                id => id.to_string(),
            };
            return Some(Stage { id, label });
        }
    }
    None
}

/// The release whose run waits at a gate and the gate's step (`active`: runs:active).
fn release_gate(roadmap: &Value, active: &Value) -> Option<(String, String)> {
    elements(roadmap.get("stages"))
        .iter()
        .filter(|s| is_release(s) && truthy(s, "runId"))
        .find_map(|entry| {
            let run = elements(Some(active))
                .iter()
                .find(|r| text(r, "runId") == text(entry, "runId"))?;
            let gate = elements(run.get("gates")).first()?;
            Some((release_label(entry), line(gate, "step_id")))
        })
}

fn with_error(text: String, error: String) -> String {
    if error.is_empty() {
        text
    } else {
        format!("{text}: {error}")
    }
}

/// Why a watch returns on this roadmap (roadmap:get), if it does. `first`: the stage in progress at the
/// first reading. A failed item first (it pauses the roadmap too); one interrupted at a gate, parked or in a
/// disabled stage is no failure.
fn reason_of(roadmap: &Value, first: Option<&Stage>, active: &Value) -> Option<Reason> {
    let stages = elements(roadmap.get("stages"));
    let failed = stages
        .iter()
        .filter(|s| !truthy(s, "disabled"))
        .flat_map(|s| elements(s.get("items")))
        .find(|x| text(x, "status") == "failed" && !is_finished(x) && !at_gate(x));
    if let Some(item) = failed {
        let own = line(item, "error");
        let error = match item.get("run") {
            Some(run) if own.is_empty() => line(run, "error"),
            _ => own,
        };
        let what = format!("{} failed", item_label(item));
        return Some(("failed", with_error(what, error)));
    }
    match text(roadmap, "state") {
        "done" => return Some(("finished", "the roadmap is done".to_string())),
        "paused" => {
            let what = "the roadmap is paused".to_string();
            return Some(("paused", with_error(what, line(roadmap, "error"))));
        }
        _ => {}
    }
    let waiting = stages
        .iter()
        .flat_map(|s| elements(s.get("items")))
        .find(|x| at_gate(x));
    let gate = match waiting {
        Some(item) => Some((item_label(item), gate_step(item))),
        None => release_gate(roadmap, active),
    };
    if let Some((label, step)) = gate {
        let step = if step.is_empty() { "its gate" } else { &step };
        return Some(("gate", format!("{label} waits at a human gate: {step}")));
    }
    let now = current_stage(roadmap);
    if first.map(|s| &s.id) != now.as_ref().map(|s| &s.id) {
        let label = |s: Option<&Stage>| s.map_or("no open stage", |s| s.label.as_str()).to_string();
        return Some((
            "stage",
            format!("from {} to {}", label(first), label(now.as_ref())),
        ));
    }
    None
}

/// The runs of a roadmap in progress, with how they are named.
fn running_runs(roadmap: &Value) -> Vec<Run> {
    let run = |x: &Value, label: String| Run {
        id: text(x, "runId").to_string(),
        label,
    };
    let running = |x: &Value| text(x, "status") == "running" && truthy(x, "runId");
    let mut runs = Vec::new();
    for stage in elements(roadmap.get("stages")) {
        if is_release(stage) {
            if running(stage) {
                runs.push(run(stage, release_label(stage)));
            }
            continue;
        }
        for item in elements(stage.get("items")).iter().filter(|x| running(x)) {
            runs.push(run(item, item_label(item)));
        }
    }
    runs
}

#[cfg(test)]
mod tests {
    use super::*;

    // the cases scripts/ctl.js passes too (packages/engine/test/ctl-watch-42.test.js)
    #[test]
    fn the_reasons_are_the_javascript_clients() {
        let cases: Value = serde_json::from_str(include_str!(
            "../../../packages/engine/test/fixtures/ctl-watch-cases.json"
        ))
        .unwrap();
        assert!(!elements(Some(&cases)).is_empty());
        for case in elements(Some(&cases)) {
            let first = current_stage(case.get("before").unwrap_or(&case["roadmap"]));
            let found = reason_of(&case["roadmap"], first.as_ref(), &case["active"]);
            let said = found.map_or(Value::Null, |(reason, text)| {
                Value::String(format!("{reason}: {text}"))
            });
            assert_eq!(said, case["expected"], "{}", case["name"]);
            let runs: Vec<Value> = running_runs(&case["roadmap"])
                .iter()
                .map(|r| json!([r.id, r.label]))
                .collect();
            assert_eq!(Value::Array(runs), case["runs"], "{}: runs", case["name"]);
        }
    }

    #[test]
    fn seconds_are_whole_and_bounded() {
        assert_eq!(seconds("--max", "604800").ok(), Some(604_800));
        for bad in ["", "0", "-1", "+5", "1.5", "604801", "99999999999999999999"] {
            assert_eq!(seconds("--max", bad).err().unwrap().code, 1, "{bad}");
        }
    }
}
