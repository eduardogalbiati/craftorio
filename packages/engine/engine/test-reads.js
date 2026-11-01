// The paths a test file reads from disk (#695), by static analysis of its code: the first argument of
// an fs read (readFileSync, readdirSync, existsSync, statSync, createReadStream...) when it is a
// string literal (relative to the repository root), a `path.join` / `path.resolve` of `__dirname`
// (or of a constant built from it) and literals, a template literal or a `+` of literals and
// constants (`${DIR}/spec.md`), or a constant holding one. A local helper that reads its parameter
// (`const read = (rel) => fs.readFileSync(path.join(ROOT, rel))`) reads what each of its calls passes.
// A non-literal argument between the anchor and a literal stands for any folders
// (`path.join(ROOT, dir, 'views')` → `**/views`); a read whose path cannot be resolved (a temp
// folder, an environment variable, a path outside the repository) is left out. A read path matches
// a file at it or under it (a listed folder). The text is the code without its comments
// (withoutComments of source-text.js).
// Used by the affected-test selection (affected-tests.js: a test is selected when a path it reads
// changes) and by `npm run check`'s rule that tests never read live documents (scripts/test-fixture-rule.js).

const path = require('path');
const { escapeRegExp } = require('./source-text');

const READ = /\b(?:readFileSync|readFile|readdirSync|readdir|existsSync|statSync|lstatSync|opendirSync|createReadStream)\s*\(/g;
const DECL = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
// `const read = (rel) =>`, `const read = rel =>`, `function read(rel`: a helper and its first parameter
const HELPER = /\b(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(\s*([A-Za-z_$][\w$]*)[^)\n]*\)|([A-Za-z_$][\w$]*))\s*=>|function\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*))/g;
const LITERAL = /^(['"`])([^'"`\\$]*)\1$/;
const TEMPLATE = /^`([^`\\]*)`$/;
const JOIN = /^path\.(?:join|resolve)\s*\(/;
const ANY = '**';
// a helper's parameter while its reads are resolved: replaced by each call's argument
const PARAM = '\u0000';

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

// The top-level parts of an argument list split at `sep` (`,` for arguments, `+` for a concatenation).
function splitArgs(list, sep = ',') {
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
    else if (c === sep && !depth) { args.push(list.slice(from, i).trim()); from = i + 1; }
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

// A template literal or a `+` of literals and literal constants → the string, or null.
function textOf(expr, scope) {
  const tpl = TEMPLATE.exec(expr);
  if (tpl) {
    let known = true;
    const s = tpl[1].replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (_, name) => {
      if (scope.literals.has(name)) return scope.literals.get(name);
      known = false;
      return '';
    });
    return known && !s.includes('${') ? s : null;
  }
  const terms = splitArgs(expr, '+');
  if (terms.length < 2) return null;
  const parts = terms.map((t) => LITERAL.exec(t)?.[2] ?? (TEMPLATE.test(t) ? textOf(t, scope) : scope.literals.get(t)));
  return parts.every((p) => typeof p === 'string') ? parts.join('') : null;
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
  if (!join) {
    const s = textOf(expr, scope);
    return s === null || path.posix.isAbsolute(s) ? null : s;
  }
  const list = inside(expr, join[0].length - 1);
  if (list === null) return null;
  const [first, ...rest] = splitArgs(list);
  const base = first ? resolve(first, scope) : null;
  if (base === null) return null;
  const parts = base ? [base] : [];
  for (const arg of rest) {
    const m = LITERAL.exec(arg);
    const s = m ? m[2] : (scope.literals.get(arg) ?? textOf(arg, scope));
    if (typeof s === 'string') parts.push(s);
    else if (JOIN.test(arg)) return null;
    else if (parts[parts.length - 1] !== ANY) parts.push(ANY);
  }
  if (parts[parts.length - 1] === ANY) return null;
  return parts.length ? path.posix.normalize(parts.join('/')) : '';
}

// Which indices of `text` are inside a string (a test's source written as data is no read); a
// quote or double quote ends at its line.
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

// The reads of `text` (code) in `scope` → [{ path, index }]; a path may hold PARAM.
function directReads(text, scope, offset = 0) {
  const mask = stringMask(text);
  const out = [];
  for (const m of text.matchAll(READ)) {
    if (mask[m.index]) continue;
    const list = inside(text, m.index + m[0].length - 1);
    const first = list === null ? null : splitArgs(list)[0];
    const p = first ? resolve(first, scope) : null;
    if (p !== null) out.push({ path: p, index: offset + m.index });
  }
  return out;
}

// The local helpers that read their first parameter → Map(name → [path with PARAM])
function readHelpers(text, scope, mask) {
  const helpers = new Map();
  for (const m of text.matchAll(HELPER)) {
    if (mask[m.index]) continue;
    const name = m[1] || m[4];
    const param = m[2] || m[3] || m[5];
    const open = m[1] ? -1 : text.indexOf('{', m.index + m[0].length);
    const body = m[1] ? valueOf(text, m.index + m[0].length) : (open < 0 ? null : inside(text, open));
    if (!body) continue;
    const own = { ...scope, literals: new Map([...scope.literals, [param, PARAM]]) };
    const reads = directReads(body, own).map((r) => r.path).filter((p) => p.includes(PARAM));
    if (reads.length) helpers.set(name, reads);
  }
  return helpers;
}

// Each call of a reading helper → what it reads with the call's first argument.
function helperReads(text, scope, mask, helpers) {
  const out = [];
  for (const [name, reads] of helpers) {
    for (const m of text.matchAll(new RegExp(`(^|[^.\\w$])${escapeRegExp(name)}\\s*\\(`, 'g'))) {
      const at = m.index + m[1].length;
      if (mask[at] || /function\s+$/.test(text.slice(Math.max(0, at - 12), at))) continue;
      const list = inside(text, m.index + m[0].length - 1);
      const first = list === null ? null : splitArgs(list)[0];
      const arg = first ? resolve(first, scope) : null;
      if (arg === null) continue;
      for (const p of reads) out.push({ path: path.posix.normalize(p.split(PARAM).join(arg)), index: at });
    }
  }
  return out;
}

// file: the test's repository-relative path; text: its code without comments.
// → [{ path, index }] (index in `text`)
function readsOf(file, text) {
  const scope = { dir: path.posix.dirname(file), paths: new Map(), literals: new Map() };
  const mask = stringMask(text);
  for (const m of text.matchAll(DECL)) {
    if (mask[m.index]) continue;
    const value = valueOf(text, m.index + m[0].length);
    const lit = LITERAL.exec(value);
    if (lit) { scope.literals.set(m[1], lit[2]); continue; }
    const s = JOIN.test(value) ? null : textOf(value, scope);
    if (s !== null) { scope.literals.set(m[1], s); continue; }
    const p = resolve(value, scope);
    if (p !== null && !p.startsWith('..') && (JOIN.test(value) || value === '__dirname')) scope.paths.set(m[1], p === '.' ? '' : p);
  }
  const reads = [...directReads(text, scope), ...helperReads(text, scope, mask, readHelpers(text, scope, mask))];
  return reads
    .filter((r) => !r.path.includes(PARAM) && usable(r.path))
    .map((r) => ({ path: r.path.replace(/^\.\//, ''), index: r.index }))
    .sort((a, b) => a.index - b.index);
}

// A read path → a RegExp matching a file at it or under it (`**` = any folders).
function readPattern(p) {
  const body = p.split('/').map((seg) => (seg === ANY ? '(?:[^/]+/)*' : `${escapeRegExp(seg)}/`)).join('').replace(/\/$/, '');
  return new RegExp(`^${body}(?:/|$)`);
}

module.exports = {
  readPattern,
  readsOf,
};
