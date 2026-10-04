// The run's result summary (#225): <run_dir>/result.md, written by the engine when a run ends
// (WorkflowRun.finish, before workflow.finished) from the run's summary (the event's `summary`):
// the status, what was done per issue (the last step output with an `issues` list), the commits
// (the worktree branch and head, the local merge), the tests (each suite step: pass/fail and
// counts; the coverage summary), the screenshots (the final evidence set, new elements #185) and
// links to the key artifacts. It is the first artifact of the run (category `result`,
// src/artifact-categories.js) and what the owner opens. No model call.
const fs = require('fs');
const path = require('path');
const { readEvidence } = require('./evidence');

const posix = (p) => String(p).split(path.sep).join('/');
const link = (rel, text = rel) => `[${text}](${encodeURI(posix(rel))})`;
const exists = (runDir, rel) => { try { return fs.statSync(path.join(runDir, rel)).isFile(); } catch { return false; } };
const oneLine = (s, n = 300) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const duration = (ms) => {
  const s = Math.round((Number(ms) || 0) / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
};
const issueLabel = (x) => {
  if (x == null) return '';
  if (typeof x !== 'object') return String(x);
  const ref = x.number != null ? `#${x.number}` : x.url || x.id || '';
  return [ref, x.title].filter(Boolean).join(' ');
};

// The step outputs, in the order the run produced them
const outputs = (summary) => Object.entries(summary?.steps || {}).map(([id, v]) => ({ id, output: v?.output })).filter((s) => s.output && typeof s.output === 'object');

function issuesSection(summary) {
  const reported = outputs(summary).filter((s) => Array.isArray(s.output.issues) && s.output.issues.some((i) => i && typeof i === 'object' && 'issue' in i)).pop();
  const lines = [];
  if (reported) {
    for (const i of reported.output.issues) {
      lines.push(`- ${i.done === false ? '✗' : '✓'} ${oneLine(i.issue)}: ${oneLine(i.summary || (i.done === false ? 'not done' : 'done'))}`);
    }
  } else if (summary?.issues?.length) {
    for (const i of summary.issues) lines.push(`- ${oneLine(issueLabel(i))}`);
  }
  return lines.length ? ['## Issues', '', ...lines, ''] : [];
}

function commitsSection(summary) {
  const wt = summary?.worktree;
  const lm = summary?.local_merge;
  const lines = [];
  if (wt?.branch) lines.push(`- Branch \`${wt.branch}\`${wt.base ? ` (base \`${wt.base}\`)` : ''}${wt.commit ? ` at \`${String(wt.commit).slice(0, 12)}\`` : ''}`);
  if (lm?.commit) lines.push(`- Merged into the local \`${lm.base || 'base'}\`: \`${String(lm.commit).slice(0, 12)}\``);
  const developer = outputs(summary).filter((s) => s.output.commit_sha).pop();
  if (developer) lines.push(`- Last commit reported by \`${developer.id}\`: \`${String(developer.output.commit_sha).slice(0, 12)}\``);
  return lines.length ? ['## Commits', '', ...lines, ''] : [];
}

function testsSection(runDir, summary) {
  const lines = [];
  for (const { id, output: o } of outputs(summary).filter((s) => s.output.kind === 'suite')) {
    const counts = [o.passed != null ? `${o.passed} passed` : '', o.failed != null ? `${o.failed} failed` : ''].filter(Boolean).join(', ');
    lines.push(`- \`${id}\`: **${o.status || 'unknown'}**${counts ? ` (${counts})` : ''}${o.log ? `, ${link(path.relative(runDir, o.log) || o.log, 'log')}` : ''}`);
  }
  if (exists(runDir, 'coverage/coverage-summary.md')) lines.push(`- Coverage: ${link('coverage/coverage-summary.md')}`);
  for (const rel of ['e2e/results.json', 'e2e/scenarios.feature']) if (exists(runDir, rel)) lines.push(`- E2E: ${link(rel)}`);
  return lines.length ? ['## Tests', '', ...lines, ''] : [];
}

function screenshotsSection(runDir, summary) {
  const lines = [];
  for (const { output: o } of outputs(summary).filter((s) => s.output.kind === 'screenshots')) {
    if (o.message) lines.push(`- ${oneLine(o.message)}`);
  }
  let ev = null;
  try { ev = readEvidence(runDir); } catch { ev = null; }
  const final = (ev?.images || []).filter((x) => x.final);
  for (const x of final) lines.push(`- ${link(x.path, `${x.caption || x.key} (${x.side})`)}`);
  return lines.length ? ['## Screenshots', '', ...lines, ''] : [];
}

function renderResultSummary(runDir, summary = {}) {
  const title = summary.workflow || 'Run';
  const head = [
    `# Result: ${title}`,
    '',
    `- Status: **${summary.status || 'unknown'}**${summary.error ? ` (${oneLine(summary.error)})` : ''}`,
    `- Run: \`${summary.run_id || path.basename(runDir)}\`${summary.mock ? ' (simulated)' : ''}`,
    summary.duration_ms != null ? `- Duration: ${duration(summary.duration_ms)}` : '',
    summary.cost_usd ? `- Cost: $${Number(summary.cost_usd).toFixed(2)}` : '',
    '',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
  const keys = ['decisions.tsv', 'evidence/manifest.json'].filter((rel) => exists(runDir, rel));
  return [
    ...head,
    ...issuesSection(summary),
    ...commitsSection(summary),
    ...testsSection(runDir, summary),
    ...screenshotsSection(runDir, summary),
    ...(keys.length ? ['## Key artifacts', '', ...keys.map((rel) => `- ${link(rel)}`), ''] : []),
  ].join('\n');
}

/** Writes <run_dir>/result.md; returns its path, or null when it could not be written. */
function writeResultSummary(runDir, summary) {
  if (!runDir) return null;
  const file = path.join(runDir, 'result.md');
  try {
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(file, renderResultSummary(runDir, summary));
    return file;
  } catch (e) {
    console.error('result summary:', e.message);
    return null;
  }
}

module.exports = {
  renderResultSummary,
  writeResultSummary,
};
