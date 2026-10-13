// The JavaScript conversions src/session-tail.js relies on, so the binary prints the same bytes:
// String(v) and template literals, truthiness, Number#toString, Number#toFixed, Math.round,
// JSON.stringify (array-index keys first, like a JS object), the /\s/ class, the UTF-16 lengths and
// slices of clip(), path.join and path.basename of this platform. `None` is `undefined`.

use serde_json::{Map, Value};

/// A property of an object; `undefined` for anything else (a primitive has none we read).
pub fn get<'a>(v: Option<&'a Value>, key: &str) -> Option<&'a Value> {
    match v {
        Some(Value::Object(m)) => m.get(key),
        _ => None,
    }
}

/// `undefined` and `null` (`x ?? y`, `x != null`).
pub fn nullish(v: Option<&Value>) -> bool {
    matches!(v, None | Some(Value::Null))
}

pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|x| x != 0.0 && !x.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(_) | Value::Object(_)) => true,
    }
}

/// `String(v)`, `${v}`.
pub fn string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => number(n.as_f64().unwrap_or(f64::NAN)),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|x| {
                if nullish(Some(x)) {
                    String::new()
                } else {
                    string(Some(x))
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}

/// `x || fallback` as a string.
pub fn or(v: Option<&Value>, fallback: &str) -> String {
    if truthy(v) {
        string(v)
    } else {
        fallback.into()
    }
}

/// `Number(v)`.
pub fn to_number(v: Option<&Value>) -> f64 {
    match v {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => string_to_number(s),
        Some(Value::Array(_)) => string_to_number(&string(v)),
        Some(Value::Object(_)) => f64::NAN,
    }
}

fn string_to_number(s: &str) -> f64 {
    let t = trim(s);
    if t.is_empty() {
        return 0.0;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    let radix = |p: &str, r: u32| {
        t.strip_prefix(p)
            .and_then(|d| u64::from_str_radix(d, r).ok())
            .map(|n| n as f64)
    };
    if let Some(n) = radix("0x", 16)
        .or_else(|| radix("0X", 16))
        .or_else(|| radix("0o", 8))
        .or_else(|| radix("0O", 8))
        .or_else(|| radix("0b", 2))
        .or_else(|| radix("0B", 2))
    {
        return n;
    }
    // Rust accepts "inf", "nan" and "1e5" alike; JS only the decimal forms
    if t.chars()
        .all(|c| c.is_ascii_digit() || matches!(c, '.' | 'e' | 'E' | '+' | '-'))
    {
        return t.parse::<f64>().unwrap_or(f64::NAN);
    }
    f64::NAN
}

/// `Math.round(x)`: halves toward +Infinity.
pub fn round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let r = x.floor();
    if x - r >= 0.5 { r + 1.0 } else { r }
}

/// `Number#toString()`: the shortest digits that read back, in JS's notation.
pub fn number(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x.is_infinite() {
        return if x > 0.0 {
            "Infinity".into()
        } else {
            "-Infinity".into()
        };
    }
    if x == 0.0 {
        return "0".into();
    }
    let sign = if x < 0.0 { "-" } else { "" };
    // "d.ddde-7": Rust's shortest round-trip digits
    let sci = format!("{:e}", x.abs());
    let (mantissa, exp) = sci.split_once('e').unwrap_or((sci.as_str(), "0"));
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let k = i64::try_from(digits.len()).unwrap_or(1);
    let n = exp.parse::<i64>().unwrap_or(0) + 1;
    let body = if k <= n && n <= 21 {
        format!(
            "{digits}{}",
            "0".repeat(usize::try_from(n - k).unwrap_or(0))
        )
    } else if 0 < n && n <= 21 {
        let (a, b) = digits.split_at(usize::try_from(n).unwrap_or(0));
        format!("{a}.{b}")
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat(usize::try_from(-n).unwrap_or(0)))
    } else {
        let (a, b) = digits.split_at(1);
        let e = n - 1;
        let frac = if b.is_empty() {
            String::new()
        } else {
            format!(".{b}")
        };
        format!("{a}{frac}e{}{}", if e >= 0 { "+" } else { "-" }, e.abs())
    };
    format!("{sign}{body}")
}

/// `Number#toFixed(digits)`: the exact value rounded half up (JS picks the larger n on a tie).
pub fn to_fixed(x: f64, digits: usize) -> String {
    if !x.is_finite() || x.abs() >= 1e21 {
        return number(x);
    }
    if x < 0.0 {
        let s = to_fixed(-x, digits);
        // (-0.00001).toFixed(4) is "-0.0000" in JS too
        return format!("-{s}");
    }
    // every digit of the double (at most 1074 after the point)
    let exact = format!("{x:.1074}");
    let (int, frac) = exact.split_once('.').unwrap_or((exact.as_str(), ""));
    let mut kept: Vec<u8> = int.bytes().chain(frac.bytes().take(digits)).collect();
    if frac.as_bytes().get(digits).is_some_and(|d| *d >= b'5') {
        let mut i = kept.len();
        loop {
            if i == 0 {
                kept.insert(0, b'1');
                break;
            }
            i -= 1;
            if kept[i] == b'9' {
                kept[i] = b'0';
            } else {
                kept[i] += 1;
                break;
            }
        }
    }
    let split = kept.len() - digits;
    let (a, b) = kept.split_at(split);
    let (a, b) = (String::from_utf8_lossy(a), String::from_utf8_lossy(b));
    if digits == 0 {
        a.into_owned()
    } else {
        format!("{a}.{b}")
    }
}

/// The keys of an object in JS's order: array indexes ascending, then the others as written.
fn keys(m: &Map<String, Value>) -> Vec<(&String, &Value)> {
    let index = |k: &str| {
        if k == "0" || (!k.starts_with('0') && k.bytes().all(|b| b.is_ascii_digit())) {
            k.parse::<u32>().ok().filter(|n| *n != u32::MAX)
        } else {
            None
        }
    };
    let mut indexed: Vec<_> = m
        .iter()
        .filter_map(|(k, v)| index(k).map(|n| (n, k, v)))
        .collect();
    indexed.sort_by_key(|(n, _, _)| *n);
    indexed
        .into_iter()
        .map(|(_, k, v)| (k, v))
        .chain(m.iter().filter(|(k, _)| index(k).is_none()))
        .collect()
}

/// `JSON.stringify(v)`.
pub fn stringify(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => {
            let x = n.as_f64().unwrap_or(f64::NAN);
            if x.is_finite() {
                number(x)
            } else {
                "null".into()
            }
        }
        Value::String(s) => quote(s),
        Value::Array(items) => format!(
            "[{}]",
            items.iter().map(stringify).collect::<Vec<_>>().join(",")
        ),
        Value::Object(m) => format!(
            "{{{}}}",
            keys(m)
                .into_iter()
                .map(|(k, v)| format!("{}:{}", quote(k), stringify(v)))
                .collect::<Vec<_>>()
                .join(",")
        ),
    }
}

// serde_json escapes a string as JSON.stringify does (", \, \b \f \n \r \t, other controls as \u00xx)
fn quote(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| format!("\"{s}\""))
}

/// `Object.entries(v)` of a value read from JSON: an object's or an array's, a string's characters.
pub fn entries(v: &Value) -> Vec<(String, Value)> {
    match v {
        Value::Object(m) => keys(m)
            .into_iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
        Value::Array(items) => items
            .iter()
            .enumerate()
            .map(|(i, x)| (i.to_string(), x.clone()))
            .collect(),
        Value::String(s) => utf16_units(s)
            .enumerate()
            .map(|(i, u)| (i.to_string(), Value::String(String::from_utf16_lossy(&[u]))))
            .collect(),
        _ => Vec::new(),
    }
}

fn utf16_units(s: &str) -> impl Iterator<Item = u16> + '_ {
    s.encode_utf16()
}

/// JS's /\s/: the Unicode spaces and line terminators (U+0085 is not one, U+FEFF is).
pub fn is_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

pub fn trim(s: &str) -> &str {
    s.trim_matches(is_space)
}

/// `s.replace(/\s+/g, ' ')`.
pub fn collapse_spaces(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_space = false;
    for c in s.chars() {
        if is_space(c) {
            if !in_space {
                out.push(' ');
            }
            in_space = true;
        } else {
            out.push(c);
            in_space = false;
        }
    }
    out
}

/// session-tail.js's clip(s, n): `String(s ?? '')` cut at n UTF-16 units.
pub fn clip(v: Option<&Value>, n: usize) -> String {
    let s = if nullish(v) { String::new() } else { string(v) };
    clip_str(&s, n)
}

pub fn clip_str(s: &str, n: usize) -> String {
    let units: Vec<u16> = s.encode_utf16().collect();
    if units.len() <= n {
        return s.into();
    }
    format!(
        "{}… ({} more chars)",
        String::from_utf16_lossy(&units[..n]),
        units.len() - n
    )
}

/// session-tail.js's indent(s).
pub fn indent(s: &str) -> String {
    s.replace('\n', "\n    ")
}

fn is_sep(c: char) -> bool {
    c == '/' || (cfg!(windows) && c == '\\')
}

/// `path.basename(p)` of this platform.
pub fn basename(p: &str) -> String {
    let mut p = p;
    if cfg!(windows) {
        let b = p.as_bytes();
        if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
            p = &p[2..];
        }
    }
    let trimmed = p.trim_end_matches(is_sep);
    match trimmed.rfind(is_sep) {
        Some(i) => trimmed[i + 1..].into(),
        None => trimmed.into(),
    }
}

/// `path.join(...parts)` of this platform: joined, `.` and `..` resolved, Windows' `/` turned to `\`.
pub fn join(parts: &[&str]) -> String {
    let sep = if cfg!(windows) { '\\' } else { '/' };
    let joined = parts
        .iter()
        .filter(|p| !p.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join(&sep.to_string());
    if joined.is_empty() {
        return ".".into();
    }
    // the root: "/", "C:\", "C:", "\\server\share\" (UNC, kept as written)
    let mut rest = joined.as_str();
    let mut root = String::new();
    if cfg!(windows) {
        let b = rest.as_bytes();
        if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
            root.push_str(&rest[..2]);
            rest = &rest[2..];
        } else if b.len() >= 2 && is_sep(b[0] as char) && is_sep(b[1] as char) {
            root.push_str("\\\\");
            rest = &rest[2..];
        }
    }
    let absolute = rest.starts_with(is_sep);
    if absolute {
        root.push(sep);
    }
    let mut segments: Vec<&str> = Vec::new();
    for seg in rest.split(is_sep) {
        match seg {
            "" | "." => {}
            ".." => {
                if segments.last().is_some_and(|s| *s != "..") {
                    segments.pop();
                } else if !absolute {
                    segments.push("..");
                }
            }
            s => segments.push(s),
        }
    }
    let trailing = joined.ends_with(is_sep) && !segments.is_empty();
    let mut out = format!("{root}{}", segments.join(&sep.to_string()));
    if trailing {
        out.push(sep);
    }
    if out.is_empty() { ".".into() } else { out }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn numbers_print_as_in_js() {
        for (x, s) in [
            (0.5, "0.5"),
            (1.25, "1.25"),
            (61.0, "61"),
            (1e21, "1e+21"),
            (123456789012345680000.0, "123456789012345680000"),
            (1e-7, "1e-7"),
            (0.000001, "0.000001"),
            (-2.5e-10, "-2.5e-10"),
            (-0.0, "0"),
            (f64::NAN, "NaN"),
        ] {
            assert_eq!(number(x), s, "{x}");
        }
    }

    #[test]
    fn to_fixed_rounds_the_exact_value_half_up() {
        assert_eq!(to_fixed(0.5, 4), "0.5000");
        assert_eq!(to_fixed(0.03125, 4), "0.0313");
        // the values Node 24 prints
        assert_eq!(to_fixed(1.00005, 4), "1.0001");
        assert_eq!(to_fixed(9.99995, 4), "10.0000");
        assert_eq!(to_fixed(9.99996, 4), "10.0000");
        assert_eq!(to_fixed(-0.25, 4), "-0.2500");
        assert_eq!(to_fixed(1e21, 4), "1e+21");
    }

    #[test]
    fn string_and_truthiness_follow_js() {
        assert_eq!(string(None), "undefined");
        assert_eq!(string(Some(&json!([1, null, "a", [2, 3]]))), "1,,a,2,3");
        assert_eq!(string(Some(&json!({ "a": 1 }))), "[object Object]");
        assert!(!truthy(Some(&json!(0))) && !truthy(Some(&json!(""))) && truthy(Some(&json!([]))));
        assert_eq!(to_number(Some(&json!(" 12 "))), 12.0);
        assert!(to_number(Some(&json!("1x"))).is_nan());
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -2.0);
    }

    #[test]
    fn stringify_puts_index_keys_first_like_a_js_object() {
        let v: Value =
            serde_json::from_str(r#"{"b":1,"2":[true,null],"1":"x\n\u0001","a":1.0}"#).unwrap();
        assert_eq!(
            stringify(&v),
            r#"{"1":"x\n\u0001","2":[true,null],"b":1,"a":1}"#
        );
    }

    #[test]
    fn clip_counts_utf16_units() {
        assert_eq!(clip_str("café", 10), "café");
        assert_eq!(clip_str("abcdef", 3), "abc… (3 more chars)");
        assert_eq!(clip_str("a😀b", 2), "a\u{fffd}… (2 more chars)");
        assert_eq!(clip(None, 3), "");
    }

    #[test]
    fn spaces_collapse_with_the_js_class() {
        assert_eq!(
            collapse_spaces("Fix   the\nbug\u{a0}\u{85}"),
            "Fix the bug \u{85}"
        );
    }

    #[test]
    fn paths_join_and_basename_like_node() {
        if cfg!(windows) {
            assert_eq!(
                join(&["C:/runs/r1/", "sessions", "dev.jsonl"]),
                "C:\\runs\\r1\\sessions\\dev.jsonl"
            );
            assert_eq!(
                join(&["C:\\a\\.\\b\\..", "events.jsonl"]),
                "C:\\a\\events.jsonl"
            );
            assert_eq!(basename("C:\\bin\\claude.exe"), "claude.exe");
        } else {
            assert_eq!(
                join(&["/runs//r1/", "sessions", "dev.jsonl"]),
                "/runs/r1/sessions/dev.jsonl"
            );
            assert_eq!(join(&["/a/./b/..", "events.jsonl"]), "/a/events.jsonl");
            assert_eq!(join(&["../x", "y"]), "../x/y");
        }
        assert_eq!(basename("/usr/local/bin/claude/"), "claude");
    }
}
