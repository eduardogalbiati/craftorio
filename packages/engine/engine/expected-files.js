// @ts-check
// The docs an issue expects, checked before the code review without an agent (#757): the
// `type: docs_check` step (packages/engine/engine/run/machine-steps.js runDocsCheckStep; the
// `docs_check` step of workflows/feature.yaml and the AI Development heroes, next to rule_check).
// - parseExpectedFiles(text): the paths listed under every `## Expected files` section of the run's
//   task (one issue body or several): the first backticked path of each list item, `(new)` markers
//   dropped, directories kept with their trailing slash, each path once;
// - docsEntries(paths): only the docs among them (under docs/, README.md, any *.md);
// - checkExpectedDocs({ text, changed, leftOut }): `skipped` without docs to expect, `pass` when the
//   diff touches at least one expected doc (a directory entry is satisfied by any file under it) or
//   every untouched doc is declared in left_out with a reason, `missing` otherwise; the message
//   starts with the counts the timeline shows ("docs expected: 2, touched: 0").
// The issues written with the issue-creator skill list their files under `## Expected files` (#429).

'use strict';

const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const EXPECTED = /^expected files\b/i;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

const norm = (p) => String(p ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * The paths under every `## Expected files` section of the text, in order, each once.
 * @param {string} text
 * @returns {string[]}
 */
function parseExpectedFiles(text) {
  const out = [];
  let inSection = false;
  for (const line of String(text || '').split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) {
      inSection = EXPECTED.test(heading[1]);
      continue;
    }
    if (!inSection) continue;
    const item = LIST_ITEM.exec(line);
    const code = item && /`([^`]+)`/.exec(item[1]);
    if (!code) continue;
    const p = norm(code[1].replace(/\s*\(new\)\s*$/i, ''));
    if (p && !/\s/.test(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * The docs among the paths: under docs/ (docs/readme/ included), README.md, any *.md.
 * @param {string[]} paths
 * @returns {string[]}
 */
function docsEntries(paths) {
  return (Array.isArray(paths) ? paths : []).map(norm).filter((p) => p.startsWith('docs/') || /(^|\/)README\.md$/i.test(p) || /\.md$/i.test(p));
}

// a changed file answers an expected entry: the same path, or a file under a directory entry
const touches = (entry, file) => (entry.endsWith('/') ? norm(file).startsWith(entry) : norm(file) === entry);

const escapeRe = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// the path as a whole word: after the start, a space, a backtick, a quote or '('; before the end,
// a space or punctuation ('/' only after a directory entry, which carries its own slash)
const PATH_BEFORE = '(?:^|[\\s`\'"(])';
const PATH_AFTER = '(?=$|[\\s`\'")\\],;:!?]|\\.(?:\\s|$))';
/** @type {(entry: string, text: string) => boolean} */
const namesPath = (entry, text) => {
  if (entry.endsWith('/')) {
    const dir = escapeRe(entry.slice(0, -1));
    return new RegExp(`${PATH_BEFORE}${dir}(?:/|${PATH_AFTER})`).test(text);
  }
  return new RegExp(`${PATH_BEFORE}${escapeRe(entry)}${PATH_AFTER}`).test(text);
};

// a left_out item with a reason that names the entry (its path, or a directory without the slash)
/** @type {(entry: string, leftOut: Array<{ requirement?: string, reason?: string }>) => boolean} */
const declared = (entry, leftOut) => (Array.isArray(leftOut) ? leftOut : []).some((g) => {
  if (!g || !String(g.reason ?? '').trim()) return false;
  return namesPath(entry, String(g.requirement ?? '').replace(/\\/g, '/'));
});

/**
 * The docs check of a run: the docs the task expects against the run's changed files.
 * @param {{ text?: string, changed?: string[], leftOut?: Array<{ requirement?: string, reason?: string }> }} args
 * @returns {{ status: 'pass' | 'missing' | 'skipped', expected: string[], touched: string[], declared: string[], missing: string[], message: string }}
 */
function checkExpectedDocs({ text = '', changed = [], leftOut = [] } = {}) {
  const expected = docsEntries(parseExpectedFiles(text));
  const files = Array.isArray(changed) ? changed : [];
  const touched = expected.filter((e) => files.some((f) => touches(e, f)));
  const counts = `docs expected: ${expected.length}, touched: ${touched.length}`;
  if (!expected.length) {
    return { status: 'skipped', expected, touched, declared: [], missing: [], message: `${counts}. Docs check skipped: the issue lists no docs under ## Expected files.` };
  }
  if (touched.length) {
    return { status: 'pass', expected, touched, declared: [], missing: [], message: `${counts}. The diff touches ${touched.join(', ')}.` };
  }
  const excused = expected.filter((e) => declared(e, leftOut));
  const missing = expected.filter((e) => !excused.includes(e));
  if (!missing.length) {
    return { status: 'pass', expected, touched, declared: excused, missing, message: `${counts}. Every expected doc is in left_out with a reason (${excused.join(', ')}): the reviewer judges it.` };
  }
  const lines = [
    `${counts}. The issue expects these docs; none changed:`,
    ...missing.map((m) => `- ${m}`),
    'Write them (a directory entry: any file under it), or put each one you leave out in left_out with its reason.',
  ];
  return { status: 'missing', expected, touched, declared: excused, missing, message: lines.join('\n') };
}

module.exports = {
  checkExpectedDocs,
  docsEntries,
  parseExpectedFiles,
};
