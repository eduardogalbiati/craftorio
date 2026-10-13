// multiagent-tail (#342): the external live terminal's follower, the Rust twin of src/session-tail.js
// (the app starts this binary when it exists, else the script under node; see tailCommand in
// src/native-bin.js). `multiagent-tail <runDir> <sessionId>` follows <run>/sessions/<id>.jsonl, or with
// the id "orchestrator" the whole run (<run>/events.jsonl), and prints exactly what the script prints:
// the window title, the "Following" line, the colours, the clipping, local times. It waits for a file
// that does not exist yet, reads what was appended every 400 ms (a partial line once complete), and
// ends on Ctrl+C or when its window closes (stdout gone).

mod format;
mod js;

use format::Printer;
use jiff::tz::TimeZone;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::process::ExitCode;
use std::thread::sleep;
use std::time::Duration;

const POLL: Duration = Duration::from_millis(400);

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args_os()
        .skip(1)
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    let (run_dir, session_id) = match (args.first(), args.get(1)) {
        (Some(r), Some(s)) if !r.is_empty() && !s.is_empty() => (r.clone(), s.clone()),
        _ => {
            let _ = writeln!(io::stderr(), "usage: session-tail <runDir> <sessionId>");
            return ExitCode::from(1);
        }
    };
    #[cfg(windows)]
    let _ = anstyle_query::windows::enable_ansi_colors();

    let orchestrator = session_id == "orchestrator";
    let file = if orchestrator {
        js::join(&[&run_dir, "events.jsonl"])
    } else {
        js::join(&[&run_dir, "sessions", &format!("{session_id}.jsonl")])
    };
    let mut tail = Tail {
        file: file.clone(),
        offset: 0,
        partial: Vec::new(),
        printer: Printer {
            orchestrator,
            tz: TimeZone::system(),
        },
    };
    let mut out = io::stdout().lock();
    let head = format!(
        "\x1b]0;{session_id} · multiagent\x07{}\n",
        format::dim(&format!("Following {file}\n"))
    );
    if out
        .write_all(head.as_bytes())
        .and_then(|()| out.flush())
        .is_err()
    {
        return ExitCode::SUCCESS;
    }
    loop {
        let text = tail.read_new();
        if !text.is_empty()
            && out
                .write_all(text.as_bytes())
                .and_then(|()| out.flush())
                .is_err()
        {
            return ExitCode::SUCCESS;
        }
        sleep(POLL);
    }
}

struct Tail {
    file: String,
    offset: u64,
    partial: Vec<u8>,
    printer: Printer,
}

impl Tail {
    /// What the lines appended since the last read print (a missing file: nothing yet).
    fn read_new(&mut self) -> String {
        let Ok(size) = std::fs::metadata(&self.file).map(|m| m.len()) else {
            return String::new();
        };
        if size <= self.offset {
            return String::new();
        }
        let mut buf = Vec::new();
        let read = File::open(&self.file)
            .and_then(|mut f| f.seek(SeekFrom::Start(self.offset)).map(|_| f))
            .and_then(|f| f.take(size - self.offset).read_to_end(&mut buf));
        if read.is_err() {
            return String::new();
        }
        self.offset += buf.len() as u64;
        self.partial.extend_from_slice(&buf);
        let Some(end) = self.partial.iter().rposition(|b| *b == b'\n') else {
            return String::new();
        };
        let complete: Vec<u8> = self.partial.drain(..=end).collect();
        let mut text = String::new();
        for line in String::from_utf8_lossy(&complete).split('\n') {
            if js::trim(line).is_empty() {
                continue;
            }
            // a broken line is skipped
            let printed = serde_json::from_str(line)
                .ok()
                .and_then(|ev| self.printer.event(&ev));
            text.push_str(&printed.unwrap_or_default());
        }
        text
    }
}
