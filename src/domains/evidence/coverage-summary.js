// Coverage summary (#225): the suite step runs node's test runner with
// --experimental-test-coverage when the suite is `node --test` (src/engine/suite-step.js) and saves
// coverage/coverage-summary.md, a Tests artifact: the totals and the changed files' coverage. No
// model call.
// - parseNodeCoverage(text, { changedFiles }): the coverage table of the runner's output (spec
//   lines start with "ℹ ", TAP lines with "# "; folders are rows of their own, files indented under
//   them) → { totals: { lines, branches, functions }, files: [{ file, lines, branches, functions,
//   uncovered }] } (files: the changed ones found, in changedFiles' order), or null without a report;
//   several tables (scripts/test.js's two runs, #402) merge: each number the better of theirs;
// - renderCoverageSummary(summary): the markdown of the artifact;
// - saveCoverage(text, runDir, changedFiles): writes it into the run folder (moved from suite-step, #527).
const fs = require('fs');
const path = require('path');

const PREFIX = /^(?:ℹ|#) ?/;

const num = (s) => {
  const t = String(s || '').trim();
  return t === '' ? null : Number(t);
};
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');

// One coverage table's rows → { totals, byFile }
function parseTable(rows) {
  let totals = null;
  const byFile = new Map();
  const stack = []; // the folders above the current row, by depth
  for (const row of rows) {
    if (!row.includes('|')) continue;
    const cells = row.split('|');
    const nameCell = cells[0];
    const name = nameCell.trim();
    if (!name || name === 'file') continue;
    const [lineP, branchP, funcP] = cells.slice(1, 4).map(num);
    const uncovered = (cells.slice(4).join('|') || '').trim();
    if (name === 'all files') {
      totals = { lines: lineP, branches: branchP, functions: funcP };
      continue;
    }
    const depth = nameCell.length - nameCell.trimStart().length;
    stack.length = depth;
    if (lineP == null && branchP == null && funcP == null) { stack[depth] = name; continue; }
    const file = [...stack.slice(0, depth).filter(Boolean), name].join('/');
    byFile.set(file, { file, lines: lineP, branches: branchP, functions: funcP, uncovered });
  }
  return { totals, byFile };
}

// The better of two percentages (null: not measured)
const best = (a, b) => (a == null ? b : b == null ? a : Math.max(a, b));

function parseNodeCoverage(text, { changedFiles = [] } = {}) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(PREFIX, ''));
  // scripts/test.js may run two node --test processes (#402: one per test budget), one table each
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*start of coverage report/.test(lines[i])) continue;
    const end = lines.findIndex((l, j) => j > i && /^\s*end of coverage report/.test(l));
    tables.push(parseTable(lines.slice(i + 1, end < 0 ? undefined : end)));
    if (end < 0) break;
    i = end;
  }
  if (!tables.length) return null;
  // Several tables: the percentages only, not the lines behind them, so each number is the better of
  // the tables' (a lower bound of the union's coverage), the uncovered lines from the best-covered one
  let totals = null;
  const byFile = new Map();
  for (const t of tables) {
    if (t.totals) totals = totals ? { lines: best(totals.lines, t.totals.lines), branches: best(totals.branches, t.totals.branches), functions: best(totals.functions, t.totals.functions) } : t.totals;
    for (const [file, row] of t.byFile) {
      const had = byFile.get(file);
      if (!had) { byFile.set(file, row); continue; }
      byFile.set(file, {
        file,
        lines: best(had.lines, row.lines),
        branches: best(had.branches, row.branches),
        functions: best(had.functions, row.functions),
        uncovered: (row.lines ?? -1) > (had.lines ?? -1) ? row.uncovered : had.uncovered,
      });
    }
  }
  if (!totals && !byFile.size) return null;
  const files = [];
  for (const f of changedFiles || []) {
    const hit = byFile.get(norm(f));
    if (hit) files.push(hit);
  }
  return { totals: totals || { lines: null, branches: null, functions: null }, files };
}

const pct = (n) => (n == null ? '–' : `${n}%`);

function renderCoverageSummary(summary) {
  if (!summary) return '# Coverage\n\nNo coverage report in the suite output.\n';
  const t = summary.totals || {};
  const out = [
    '# Coverage',
    '',
    '| | Lines | Branches | Functions |',
    '| --- | --- | --- | --- |',
    `| All files | ${pct(t.lines)} | ${pct(t.branches)} | ${pct(t.functions)} |`,
    '',
  ];
  if (summary.files?.length) {
    out.push('## Changed files', '', '| File | Lines | Branches | Functions | Uncovered lines |', '| --- | --- | --- | --- | --- |');
    for (const f of summary.files) out.push(`| \`${f.file}\` | ${pct(f.lines)} | ${pct(f.branches)} | ${pct(f.functions)} | ${f.uncovered || ''} |`);
    out.push('');
  } else {
    out.push('No changed source file in the coverage report.', '');
  }
  return out.join('\n');
}

// The coverage report of a suite's output → <run_dir>/coverage/coverage-summary.md and its numbers
// ({ lines, branches, functions, files, path }), or null without a report. No model call.
function saveCoverage(text, runDir, changedFiles) {
  const head = parseNodeCoverage(text);
  if (!head || !runDir) return null;
  let changed = [];
  try { changed = (typeof changedFiles === 'function' ? changedFiles() : changedFiles) || []; } catch { changed = []; }
  const summary = parseNodeCoverage(text, { changedFiles: changed });
  const rel = 'coverage/coverage-summary.md';
  try {
    fs.mkdirSync(path.join(runDir, 'coverage'), { recursive: true });
    fs.writeFileSync(path.join(runDir, rel), renderCoverageSummary(summary));
  } catch { return null; }
  return { ...summary.totals, files: summary.files.length, path: rel };
}

module.exports = {
  parseNodeCoverage,
  renderCoverageSummary,
  saveCoverage,
};
