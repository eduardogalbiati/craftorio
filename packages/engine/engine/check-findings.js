// What a found check (check-tools.js) reports, compared with what it reports on the base (#50), for the check step
// (check-step.js). A finding is a line with a place in a file: `src/a.js:2:1: msg`, `a.ts(2,3): error`, Checkstyle's
// `[WARN] /x/F.java:[3,5] msg`, ESLint's rows under a file's line, Prettier's `[warn] src/a.js`. Two findings are the
// same when their file (relative to the checkout) and their text are, whatever the line they are at; how many there
// are counts. Lines with no place (a summary, a duration) are never findings.
// - parseFindings(text, dir) → [{ key, line }], the line with the file relative to the checkout
// - compareFindings(now, before) → { added: [line], old: how many were there already }

'use strict';

const fs = require('fs');
const path = require('path');
const { clean, fileOf } = require('./output-lines');

const PREFIX = /^\s*(?:\[[A-Za-z]+\]\s+|(?:error|warning):?\s+)/i;
// a path, then :2:1, :2, (2,3), (2) or :[2,3]
const LOCATED = /^((?:[A-Za-z]:[\\/])?[^:"'<>|*?]*?[^\s:"'<>|*?])(?::\[(\d+)(?:,(\d+))?\]|:(\d+)(?::(\d+))?|\((\d+)(?:,(\d+))*\))(?=[\s:]|$)[\s:]*(?:- )?(.*)$/;
// ESLint's rows: `  1:5  error  text  rule`
const ROW = /^\s+(\d+):(\d+)\s+(.+)$/;
// a stack trace's frame, npm's own lines and its banner
const NOT_A_FINDING = /^\s*(?:at |npm |> )/;

const isPath = (s) => /[A-Za-z]/.test(s) && /[./\\]/.test(s);
const oneSpace = (s) => s.replace(/\s+/g, ' ').trim();

// the folders a checkout's paths may start with (a tool prints the real one)
function rootsOf(dir) {
  try { return [...new Set([fs.realpathSync.native(dir), path.resolve(dir)])]; } catch { return [path.resolve(dir)]; }
}

function relativeFile(file, roots) {
  const rel = roots.map((root) => fileOf(file, root)).find((f) => !path.isAbsolute(f)) || fileOf(file);
  return path.posix.normalize(rel);
}

// the text without the checkout's folder nor the lines it names (they move)
function textKey(text, roots) {
  const local = roots.reduce((t, root) => t.split(root + path.sep).join(''), text);
  return oneSpace(local).replace(/\bline \d+/g, 'line N');
}

function located(line, roots) {
  const m = LOCATED.exec(line.replace(PREFIX, ''));
  if (!m || !isPath(m[1])) return null;
  const file = relativeFile(m[1], roots);
  const place = [m[2] || m[4] || m[6], m[3] || m[5] || m[7]].filter(Boolean).join(':');
  return { key: `${file}|${textKey(m[8], roots)}`, line: `${file}:${place}: ${oneSpace(m[8])}`.replace(/: $/, '') };
}

// Prettier names the file alone
function fileAlone(line, roots) {
  const m = /^\[(?:error|warn)\]\s+(\S.*)$/.exec(line);
  const file = m && relativeFile(m[1], roots);
  return file && isPath(file) && fs.existsSync(path.join(roots[0], file)) ? { key: `${file}|`, line: file } : null;
}

// a line that is only a file's path: the header of ESLint's rows
const headerOf = (line) => (/^\S/.test(line) && isPath(line) && !/[:"'<>|*?]/.test(line.replace(/^[A-Za-z]:/, '')) ? line : null);

function parseFindings(text, dir) {
  const roots = rootsOf(dir);
  const out = [];
  let header = null;
  for (const raw of clean(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim() || NOT_A_FINDING.test(line)) continue;
    const row = header && ROW.exec(line);
    const finding = row ? located(`${header}:${row[1]}:${row[2]}: ${row[3]}`, roots) : located(line, roots) || fileAlone(line, roots);
    if (finding) out.push(finding);
    if (!row) header = headerOf(line);
  }
  return out;
}

function compareFindings(now, before) {
  const left = new Map();
  for (const f of before) left.set(f.key, (left.get(f.key) || 0) + 1);
  const added = [];
  for (const f of now) {
    const n = left.get(f.key) || 0;
    if (n) left.set(f.key, n - 1);
    else added.push(f.line);
  }
  return { added: [...new Set(added)], old: now.length - added.length };
}

module.exports = {
  compareFindings,
  parseFindings,
};
