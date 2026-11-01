// The paths a test file reads from disk (#695), by static analysis of its code: the first argument of
// an fs read (readFileSync, readdirSync, existsSync, statSync, createReadStream...) when it is a
// string literal (relative to the repository root), a `path.join` / `path.resolve` of `__dirname`
// (or of a constant built from it) and literals, or a constant holding one. A non-literal argument
// between the anchor and a literal stands for any folders (`path.join(ROOT, dir, 'views')` →
// `**/views`); a read whose path cannot be resolved (a temp folder, an environment variable, a path
// outside the repository) is left out. A read path matches a file at it or under it (a listed folder).
// Used by the affected-test selection (affected-tests.js: a test is selected when a path it reads
// changes) and by `npm run check`'s rule that tests never read live documents (scripts/test-fixture-rule.js).

const path = require('path');

const READ = /\b(?:readFileSync|readFile|readdirSync|readdir|existsSync|statSync|lstatSync|opendirSync|createReadStream)\s*\(/g;
const DECL = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
const LITERAL = /^(['"`])([^'"`\\$]*)\1$/;
const JOIN = /^path\.(?:join|resolve)\s*\(/;
const ANY = '**';

// The text with its comments blanked (strings kept, newlines kept, so indices keep their lines).
function blankComments(text) {
  let out = '';
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === '\\') { out += text[i + 1] || ''; i++; } else if (c === quote || (c === '\n' && quote !== '`')) quote = null;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i++; }
      if (i < text.length) out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
    } else {
      if (c === '\'' || c === '"' || c === '`') quote = c;
      out += c;
    }
  }
  return out;
}

// The text from `open` (the index of a `(`) to its matching `)`, without them; null when unclosed.
function inside(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '\'' || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (!depth) return text.slice(open + 1, i); }
  }
  return null;
}

// The top-level comma-separated arguments of an argument list.
function splitArgs(list) {
  const args = [];
  let depth = 0;
  let quote = null;
  let from = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '\'' || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && !depth) { args.push(list.slice(from, i).trim()); from = i + 1; }
  }
  args.push(list.slice(from).trim());
  return args.filter(Boolean);
}

// The end of a declaration's value: the first `;` or line end outside brackets and strings.
function valueOf(text, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '\'' || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (!depth && (c === ';' || c === '\n')) return text.slice(from, i).trim();
  }
  return text.slice(from).trim();
}

// An expression → the repository-relative path (or pattern with `**`) it names, or null.
// scope: { dir: the test's folder, paths: constant → path, literals: constant → string }
function resolve(expr, scope) {
  const lit = LITERAL.exec(expr);
  if (lit) return path.posix.isAbsolute(lit[2]) ? null : lit[2];
  if (expr === '__dirname') return scope.dir;
  if (scope.paths.has(expr)) return scope.paths.get(expr);
  if (scope.literals.has(expr)) return scope.literals.get(expr);
  const join = JOIN.exec(expr);
  if (!join) return null;
  const list = inside(expr, join[0].length - 1);
  if (list === null) return null;
  const [first, ...rest] = splitArgs(list);
  const base = first ? resolve(first, scope) : null;
  if (base === null) return null;
  const parts = base ? [base] : [];
  for (const arg of rest) {
    const m = LITERAL.exec(arg);
    if (m) parts.push(m[2]);
    else if (scope.literals.has(arg)) parts.push(scope.literals.get(arg));
    else if (JOIN.test(arg)) return null;
    else if (parts[parts.length - 1] !== ANY) parts.push(ANY);
  }
  if (parts[parts.length - 1] === ANY) return null;
  return parts.length ? path.posix.normalize(parts.join('/')) : '';
}

// Which indices of `text` are inside a string (a test's source written as data is no read); a
// quote or double quote ends at its line, so a regex literal holding one spoils one line at most.
function stringMask(text) {
  const mask = new Uint8Array(text.length);
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      mask[i] = 1;
      if (c === '\\') { mask[i + 1] = 1; i++; } else if (c === quote || (c === '\n' && quote !== '`')) quote = null;
    } else if (c === '\'' || c === '"' || c === '`') quote = c;
  }
  return mask;
}

// A resolved path inside the repository, naming more than its root.
const usable = (p) => !!p && p !== '.' && !p.startsWith('..') && !/\*\*\/\.\./.test(p);

// file: the test's repository-relative path; text: its code. → [{ path, index }] (index in `text`)
function readsOf(file, text) {
  const scope = { dir: path.posix.dirname(file), paths: new Map(), literals: new Map() };
  const mask = stringMask(text);
  for (const m of text.matchAll(DECL)) {
    if (mask[m.index]) continue;
    const value = valueOf(text, m.index + m[0].length);
    const lit = LITERAL.exec(value);
    if (lit) { scope.literals.set(m[1], lit[2]); continue; }
    const p = resolve(value, scope);
    if (p !== null && !p.startsWith('..') && (JOIN.test(value) || value === '__dirname')) scope.paths.set(m[1], p === '.' ? '' : p);
  }
  const out = [];
  for (const m of text.matchAll(READ)) {
    if (mask[m.index]) continue;
    const list = inside(text, m.index + m[0].length - 1);
    const first = list === null ? null : splitArgs(list)[0];
    const p = first ? resolve(first, scope) : null;
    if (usable(p)) out.push({ path: p.replace(/^\.\//, ''), index: m.index });
  }
  return out;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A read path → a RegExp matching a file at it or under it (`**` = any folders).
function readPattern(p) {
  const body = p.split('/').map((seg) => (seg === ANY ? '(?:[^/]+/)*' : `${escape(seg)}/`)).join('').replace(/\/$/, '');
  return new RegExp(`^${body}(?:/|$)`);
}

module.exports = {
  blankComments,
  readPattern,
  readsOf,
};
