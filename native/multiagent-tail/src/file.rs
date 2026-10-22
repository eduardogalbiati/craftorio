// The plain log mode (#465): `multiagent-tail <runDir> --file <path in the run folder>` follows a machine
// step's log (a suite, check or screenshots command's output) and prints it as it is, like followFile
// in src/session-tail.js: what was appended since the last read, a UTF-8 character cut between two
// reads printed once complete (as Node's StringDecoder), a file that shrinks read again from its start.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

pub struct FileTail {
    file: String,
    offset: u64,
    pending: Vec<u8>,
}

impl FileTail {
    pub fn new(file: String) -> Self {
        Self {
            file,
            offset: 0,
            pending: Vec::new(),
        }
    }

    /// What was appended since the last read (a missing file: nothing yet).
    pub fn read_new(&mut self) -> String {
        let Ok(size) = std::fs::metadata(&self.file).map(|m| m.len()) else {
            return String::new();
        };
        if size < self.offset {
            self.offset = 0;
        }
        if size == self.offset {
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
        self.pending.extend_from_slice(&buf);
        self.decode()
    }

    /// The complete characters of `pending` (an invalid sequence: U+FFFD), the rest kept.
    fn decode(&mut self) -> String {
        let mut text = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(s) => {
                    text.push_str(s);
                    self.pending.clear();
                    return text;
                }
                Err(e) => {
                    let valid = e.valid_up_to();
                    text.push_str(&String::from_utf8_lossy(&self.pending[..valid]));
                    match e.error_len() {
                        None => {
                            self.pending.drain(..valid);
                            return text;
                        }
                        Some(n) => {
                            text.push('\u{FFFD}');
                            self.pending.drain(..valid + n);
                        }
                    }
                }
            }
        }
    }
}
