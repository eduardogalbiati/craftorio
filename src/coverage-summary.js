// Coverage summary (#225): the suite step runs node's test runner with
// --experimental-test-coverage when the suite is `node --test` (src/engine/suite-step.js) and saves
// coverage/coverage-summary.md, a Tests artifact: the totals and the changed files' coverage. No
// model call.
// - parseNodeCoverage(text, { changedFiles }): the coverage table of the runner's output (spec
//   lines start with "ℹ ", TAP lines with "# "; folders are rows of their own, files indented under
//   them) → { totals: { lines, branches, functions }, files: [{ file, lines, branches, functions,
//   uncovered }] } (files: the changed ones found, in changedFiles' order), or null without a report;
// - renderCoverageSummary(summary): the markdown of the artifact.
const PREFIX = /^(?:ℹ|#) ?/;

const num = (s) => {
  const t = String(s || '').trim();
  return t === '' ? null : Number(t);
};
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');

function parseNodeCoverage(text, { changedFiles = [] } = {}) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(PREFIX, ''));
  const start = lines.findIndex((l) => /^\s*start of coverage report/.test(l));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^\s*end of coverage report/.test(l));
  const rows = lines.slice(start + 1, end < 0 ? undefined : end);
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

module.exports = {
  parseNodeCoverage,
  renderCoverageSummary,
};
