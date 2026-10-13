// The app's loopback bridge (src/supervisor-bridge.js): a POST with the bearer token, one request
// per connection. A minimal HTTP/1.1 client over std's TcpStream (plain http on 127.0.0.1 only), so
// the binary needs no HTTP library. Errors are the message the JS server would reply with.

use serde_json::Value;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

pub struct Bridge {
    pub url: String,
    pub token: String,
}

impl Bridge {
    pub fn from_env() -> Bridge {
        Bridge {
            url: std::env::var("SUPERVISOR_BRIDGE_URL").unwrap_or_default(),
            token: std::env::var("SUPERVISOR_BRIDGE_TOKEN").unwrap_or_default(),
        }
    }

    /// POSTs `body` to the bridge's `route`: its JSON reply, or the error message.
    pub fn post(&self, route: &str, body: &Value) -> Result<Value, String> {
        let target = Target::parse(&self.url)?;
        let data = body.to_string();
        let request = format!(
            "POST {}{} HTTP/1.1\r\nHost: {}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            target.path,
            route,
            target.authority,
            self.token,
            data.len(),
            data
        );
        let mut stream = connect(&target)?;
        stream
            .write_all(request.as_bytes())
            .map_err(|e| e.to_string())?;
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).map_err(|e| e.to_string())?;
        let (status, body) = parse_response(&raw)?;
        reply(status, &body)
    }
}

fn connect(target: &Target) -> Result<TcpStream, String> {
    let addrs = (target.host.as_str(), target.port)
        .to_socket_addrs()
        .map_err(|e| format!("{} ({})", e, target.authority))?;
    let mut last = format!("no address for {}", target.authority);
    for addr in addrs {
        match TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) {
            Ok(s) => return Ok(s),
            Err(e) => last = format!("connect {addr}: {e}"),
        }
    }
    Err(last)
}

/// The parts of SUPERVISOR_BRIDGE_URL (`http://host:port[/path]`).
#[derive(Debug, PartialEq)]
struct Target {
    authority: String,
    host: String,
    port: u16,
    path: String,
}

impl Target {
    fn parse(url: &str) -> Result<Target, String> {
        let invalid = || format!("Invalid URL: \"{url}\"");
        let scheme_end = url.find("://").ok_or_else(invalid)?;
        if !url[..scheme_end].eq_ignore_ascii_case("http") {
            return Err(format!("Unsupported protocol in {url}: only http"));
        }
        let rest = &url[scheme_end + 3..];
        let (authority, path) = match rest.find(['/', '?', '#']) {
            Some(i) => (&rest[..i], &rest[i..]),
            None => (rest, ""),
        };
        let (host, port) = match authority.rsplit_once(':') {
            Some((h, p)) if !p.contains(']') => (h, p.parse::<u16>().map_err(|_| invalid())?),
            _ => (authority, 80),
        };
        let host = host.trim_start_matches('[').trim_end_matches(']');
        if host.is_empty() {
            return Err(invalid());
        }
        Ok(Target {
            authority: authority.to_string(),
            host: host.to_string(),
            port,
            path: path.to_string(),
        })
    }
}

/// The status code and body of a whole HTTP/1.x response (Content-Length, chunked or until close).
fn parse_response(raw: &[u8]) -> Result<(u16, Vec<u8>), String> {
    let end = find(raw, b"\r\n\r\n").ok_or("The bridge closed the connection before its reply")?;
    let head = String::from_utf8_lossy(&raw[..end]);
    let mut lines = head.split("\r\n");
    let status = lines
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or("The bridge's reply has no status")?;
    let mut chunked = false;
    let mut length = None;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            let (name, value) = (name.trim(), value.trim());
            if name.eq_ignore_ascii_case("transfer-encoding")
                && value.eq_ignore_ascii_case("chunked")
            {
                chunked = true;
            } else if name.eq_ignore_ascii_case("content-length") {
                length = value.parse::<usize>().ok();
            }
        }
    }
    let body = &raw[end + 4..];
    let body = if chunked {
        dechunk(body)?
    } else if let Some(n) = length {
        body.get(..n)
            .ok_or("The bridge's reply is cut short")?
            .to_vec()
    } else {
        body.to_vec()
    };
    Ok((status, body))
}

fn dechunk(mut body: &[u8]) -> Result<Vec<u8>, String> {
    let bad = || "The bridge's chunked reply is malformed".to_string();
    let mut out = Vec::new();
    loop {
        let line_end = find(body, b"\r\n").ok_or_else(bad)?;
        let size_text = String::from_utf8_lossy(&body[..line_end]);
        let size_text = size_text.split(';').next().unwrap_or_default().trim();
        let size = usize::from_str_radix(size_text, 16).map_err(|_| bad())?;
        body = &body[line_end + 2..];
        if size == 0 {
            return Ok(out);
        }
        out.extend_from_slice(body.get(..size).ok_or_else(bad)?);
        body = body.get(size + 2..).ok_or_else(bad)?;
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// The bridge's JSON on 200, else its `error` (or the HTTP status), like the JS server.
fn reply(status: u16, body: &[u8]) -> Result<Value, String> {
    let out: Value = serde_json::from_slice(body).map_err(|e| e.to_string())?;
    if status == 200 {
        return Ok(out);
    }
    Err(match out.get("error") {
        Some(Value::String(s)) if !s.is_empty() => s.clone(),
        Some(v) if !v.is_null() && v != &Value::Bool(false) => v.to_string(),
        _ => format!("HTTP {status}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_loopback_url_parses_into_host_port_and_path() {
        let t = Target::parse("http://127.0.0.1:51234").unwrap();
        assert_eq!(
            t,
            Target {
                authority: "127.0.0.1:51234".into(),
                host: "127.0.0.1".into(),
                port: 51234,
                path: String::new()
            }
        );
        let t = Target::parse("HTTP://[::1]:8080/base").unwrap();
        assert_eq!(
            (t.host.as_str(), t.port, t.path.as_str()),
            ("::1", 8080, "/base")
        );
        assert_eq!(Target::parse("http://localhost").unwrap().port, 80);
    }

    #[test]
    fn an_empty_or_foreign_url_is_an_error() {
        assert!(Target::parse("").unwrap_err().contains("Invalid URL"));
        assert!(Target::parse("http://:80").is_err());
        assert!(Target::parse("http://h:99999").is_err());
        assert!(
            Target::parse("https://h:1")
                .unwrap_err()
                .contains("only http")
        );
    }

    #[test]
    fn a_response_with_content_length_or_until_close() {
        let (s, b) =
            parse_response(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\n{}extra").unwrap();
        assert_eq!((s, b.as_slice()), (200, b"{}".as_slice()));
        let (s, b) =
            parse_response(b"HTTP/1.0 403 Forbidden\r\n\r\n{\"error\":\"forbidden\"}").unwrap();
        assert_eq!(
            (s, b.as_slice()),
            (403, b"{\"error\":\"forbidden\"}".as_slice())
        );
        assert!(parse_response(b"HTTP/1.1 200 OK\r\ncontent-length: 9\r\n\r\n{}").is_err());
        assert!(parse_response(b"HTTP/1.1 200").is_err());
    }

    #[test]
    fn a_chunked_response_is_joined() {
        let raw = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\n{\"a\r\n4;x=y\r\n\":1}\r\n0\r\n\r\n";
        let (_, b) = parse_response(raw).unwrap();
        assert_eq!(b, b"{\"a\":1}");
        assert!(dechunk(b"zz\r\n").is_err());
        assert!(dechunk(b"5\r\nab").is_err());
    }

    #[test]
    fn a_non_200_reply_gives_its_error_or_the_status() {
        assert_eq!(
            reply(200, b"{\"tools\":[]}").unwrap(),
            json!({ "tools": [] })
        );
        assert_eq!(
            reply(403, b"{\"error\":\"forbidden\"}").unwrap_err(),
            "forbidden"
        );
        assert_eq!(reply(500, b"{}").unwrap_err(), "HTTP 500");
        assert!(reply(200, b"not json").is_err());
    }
}
