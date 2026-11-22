// The control endpoint (packages/engine/control/index.js): one request per connection with the bearer token. A
// minimal HTTP/1.1 client over std's TcpStream (plain http on 127.0.0.1 only), like craftorio-mcp's
// bridge.rs, so the binary needs no HTTP library.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// The parts of the endpoint's url (`http://host:port[/path]`).
#[derive(Debug, PartialEq)]
pub struct Target {
    authority: String,
    host: String,
    port: u16,
    path: String,
}

impl Target {
    pub fn parse(url: &str) -> Result<Target, String> {
        let invalid = || format!("Invalid URL: \"{url}\"");
        let scheme_end = url.find("://").ok_or_else(invalid)?;
        if !url[..scheme_end].eq_ignore_ascii_case("http") {
            return Err(format!("Unsupported protocol in {url}: only http"));
        }
        let rest = &url[scheme_end + 3..];
        let (authority, path) = match rest.find(['/', '?', '#']) {
            Some(i) => (&rest[..i], rest[i..].trim_end_matches('/')),
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

    /// Sends one request to `route` (e.g. `/api/version`): the reply's status and body.
    pub fn request(
        &self,
        method: &str,
        route: &str,
        token: &str,
        body: Option<&str>,
    ) -> Result<(u16, Vec<u8>), String> {
        let mut request = format!(
            "{method} {}{route} HTTP/1.1\r\nHost: {}\r\nAuthorization: Bearer {token}\r\nAccept: application/json\r\nConnection: close\r\n",
            self.path, self.authority
        );
        if let Some(data) = body {
            request.push_str(&format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n",
                data.len()
            ));
        }
        request.push_str("\r\n");
        request.push_str(body.unwrap_or_default());
        let mut stream = self.connect()?;
        stream
            .write_all(request.as_bytes())
            .map_err(|e| e.to_string())?;
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).map_err(|e| e.to_string())?;
        parse_response(&raw)
    }

    fn connect(&self) -> Result<TcpStream, String> {
        let addrs = (self.host.as_str(), self.port)
            .to_socket_addrs()
            .map_err(|e| format!("{} ({})", e, self.authority))?;
        let mut last = format!("no address for {}", self.authority);
        for addr in addrs {
            match TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) {
                Ok(s) => return Ok(s),
                Err(e) => last = format!("connect {addr}: {e}"),
            }
        }
        Err(last)
    }
}

/// The status code and body of a whole HTTP/1.x response (Content-Length, chunked or until close).
fn parse_response(raw: &[u8]) -> Result<(u16, Vec<u8>), String> {
    let end = find(raw, b"\r\n\r\n").ok_or("The app closed the connection before its reply")?;
    let head = String::from_utf8_lossy(&raw[..end]);
    let mut lines = head.split("\r\n");
    let status = lines
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or("The app's reply has no status")?;
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
            .ok_or("The app's reply is cut short")?
            .to_vec()
    } else {
        body.to_vec()
    };
    Ok((status, body))
}

fn dechunk(mut body: &[u8]) -> Result<Vec<u8>, String> {
    let bad = || "The app's chunked reply is malformed".to_string();
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
        let next = size.checked_add(2).ok_or_else(bad)?;
        body = body.get(next..).ok_or_else(bad)?;
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// `encodeURIComponent(s)`: a channel name in the path (`settings:get` → `settings%3Aget`).
pub fn encode_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(char::from(b));
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_endpoint_url_parses() {
        let t = Target::parse("http://127.0.0.1:51234").unwrap();
        assert_eq!(
            (
                t.host.as_str(),
                t.port,
                t.path.as_str(),
                t.authority.as_str()
            ),
            ("127.0.0.1", 51234, "", "127.0.0.1:51234")
        );
        assert_eq!(Target::parse("http://127.0.0.1:1/").unwrap().path, "");
        assert!(
            Target::parse("https://h:1")
                .unwrap_err()
                .contains("only http")
        );
        assert!(Target::parse("").is_err());
    }

    #[test]
    fn responses_with_length_chunks_or_until_close() {
        assert_eq!(
            parse_response(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\n{}x").unwrap(),
            (200, b"{}".to_vec())
        );
        let raw = b"HTTP/1.1 403 Forbidden\r\nTransfer-Encoding: chunked\r\n\r\n3\r\n{\"a\r\n4\r\n\":1}\r\n0\r\n\r\n";
        assert_eq!(parse_response(raw).unwrap(), (403, b"{\"a\":1}".to_vec()));
        assert!(parse_response(b"HTTP/1.1 200").is_err());
    }

    #[test]
    fn a_channel_is_encoded_like_encode_uri_component() {
        assert_eq!(encode_component("settings:get"), "settings%3Aget");
        assert_eq!(encode_component("a b/é"), "a%20b%2F%C3%A9");
    }
}
