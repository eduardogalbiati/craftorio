// File size ratchet (issue #334): every .js file under src/ and scripts/ has at most MAX_LINES lines.
// The files above it when the rule came are EXCEPTIONS, each with its line count when it was
// listed: a listed file may only shrink. It fails when it grows past its count, and when it drops
// to MAX_LINES or fewer (or is gone) until it leaves the list; a lower count may replace the
// recorded one. A new exception needs the owner's ok written in its issue (docs/agents/testing.md,
// which also says how to split a file). Lines are counted the same on every OS (CRLF normalized).
// Checked by test/file-size-ratchet-334.test.js.
//
//   node scripts/file-size-ratchet.js   report, exit 1 when a file breaks the rule

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['src', 'scripts'];
const MAX_LINES = 1000;
const HOW_TO = 'docs/agents/testing.md ("File size ratchet")';

// path (from the repository root, with /) -> its line count when listed; only lower it
const EXCEPTIONS = {
  'src/domains/discovery/discovery.js': 1164,
  'src/domains/po/product-owner.js': 1732,
  'src/renderer/views/arena/arena.js': 1048,
  'src/renderer/views/backlog/backlog-po.js': 1102,
  'src/renderer/views/backlog/backlog-roadmap.js': 2072,
  'src/renderer/views/backlog/backlog.js': 1779,
  'src/renderer/views/discovery/discovery.js': 1560,
};

// Lines of a text as `wc -l` counts a file that ends with a newline, CRLF or LF alike.
function countLines(text) {
  const s = String(text).replace(/\r\n?/g, '\n');
  if (!s) return 0;
  return s.split('\n').length - (s.endsWith('\n') ? 1 : 0);
}

// Files under root/dir (paths from root, with /) whose name matches `match`; also used by bare-controls.js.
function listFiles(root, dir, match = /\.js$/) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules') return [];
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return listFiles(root, rel, match);
    return match.test(e.name) ? [rel] : [];
  });
}

const fmt = (n) => n.toLocaleString('en-US');

// [{ file, kind: 'over' | 'grew' | 'leave-list', lines, message }], sorted by file.
function checkFileSizes({ root = ROOT, exceptions = EXCEPTIONS } = {}) {
  const problems = [];
  const seen = new Set();
  for (const file of DIRS.flatMap((d) => listFiles(root, d)).sort()) {
    const lines = countLines(fs.readFileSync(path.join(root, ...file.split('/')), 'utf8'));
    const listed = Object.hasOwn(exceptions, file) ? exceptions[file] : null;
    if (listed !== null) seen.add(file);
    if (listed !== null && lines <= MAX_LINES) {
      problems.push({ file, kind: 'leave-list', lines, message: `${file} has ${fmt(lines)} lines, within the ${fmt(MAX_LINES)}-line cap: remove it from EXCEPTIONS in scripts/file-size-ratchet.js.` });
    } else if (listed !== null && lines > listed) {
      problems.push({ file, kind: 'grew', lines, message: `${file} grew to ${fmt(lines)} lines, past its recorded ${fmt(listed)}: split it (how-to: ${HOW_TO}) instead of raising the count.` });
    } else if (listed === null && lines > MAX_LINES) {
      problems.push({ file, kind: 'over', lines, message: `${file} has ${fmt(lines)} lines, over the ${fmt(MAX_LINES)}-line cap: split it (how-to: ${HOW_TO}).` });
    }
  }
  for (const file of Object.keys(exceptions)) {
    if (!seen.has(file)) problems.push({ file, kind: 'leave-list', lines: 0, message: `${file} no longer exists: remove it from EXCEPTIONS in scripts/file-size-ratchet.js.` });
  }
  return problems.sort((a, b) => a.file.localeCompare(b.file));
}

if (require.main === module) {
  const problems = checkFileSizes();
  for (const p of problems) console.log(p.message);
  if (problems.length) process.exitCode = 1;
}

module.exports = {
  checkFileSizes,
  countLines,
  DIRS,
  EXCEPTIONS,
  listFiles,
  MAX_LINES,
};
