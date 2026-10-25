// Bare native controls guard (issue #383): a `<select` tag, a `type="date"` or a
// `type="datetime-local"` input written in a renderer file is a bare native control. The app's
// controls are select.js (Select.markup) and date-range.js (DateRange.fields); the files that had
// bare controls when the guard came are BASELINE, each with its counts: a listed file may only
// shrink, a file not listed may have none. Scans the .js and .html page files of every layer (the UI kit,
// the fronts, the apps' page folders: scripts/source-tree.js pageFiles).
// Checked by test/bare-controls-383.test.js; docs/agents/renderer.md ("UI conventions").
//
//   node scripts/bare-controls.js   report, exit 1 when a file has more than its baseline

const fs = require('fs');
const path = require('path');
const { pageFiles } = require('./source-tree');

const ROOT = path.join(__dirname, '..');
const KINDS = {
  date: { re: /type=(["'])date\1/g, label: 'type="date" input' },
  datetime: { re: /type=(["'])datetime-local\1/g, label: 'type="datetime-local" input' },
  select: { re: /<select(?=[\s>/])/g, label: '<select> tag' },
};

// path (from the repository root, with /) -> its counts when listed; only lower them
const BASELINE = {
  'packages/ui-kit/agent-overrides.js': { select: 2 },
  'packages/ui-kit/chain-picker.js': { select: 4 },
  'packages/ui-kit/date-range.js': { date: 1 },
  'packages/ui-kit/diff-viewer.js': { select: 1 },
  'packages/ui-kit/gate-panel.js': { select: 1 },
  'apps/desktop/renderer/index.html': { select: 4 },
  'apps/web/renderer/index.html': { select: 4 },
  'packages/ui-kit/resume-dialog.js': { select: 1 },
  'packages/ui-kit/select.js': { select: 1 },
  'fronts/analyser/views/analytics/analytics-agents.js': { select: 1 },
  'fronts/analyser/views/analytics/analytics-run.js': { select: 1 },
  'fronts/plan/views/arena/arena.js': { select: 5 },
  'fronts/build/views/artifacts/artifacts.js': { select: 1 },
  'fronts/build/views/backlog/backlog-po-proposals.js': { select: 3 },
  'fronts/build/views/backlog/backlog-po.js': { select: 1 },
  'fronts/build/views/backlog/backlog-roadmap.js': { select: 4 },
  'fronts/build/views/backlog/backlog.js': { select: 7 },
  'fronts/plan/views/discovery/discovery-commit.js': { select: 2 },
  'fronts/plan/views/discovery/discovery.js': { select: 5 },
  'fronts/plan/views/duo/duo.js': { select: 7 },
  'fronts/plan/views/inbox/inbox.js': { select: 3 },
  'fronts/ai/views/nightwatch/nightwatch.js': { datetime: 1, select: 1 },
  'fronts/ai/views/oracle/oracle.js': { datetime: 1 },
  'fronts/analyser/views/project/project-architecture.js': { select: 1 },
  'fronts/analyser/views/project/project-city-agents.js': { select: 1 },
  'fronts/analyser/views/project/project-city.js': { select: 1 },
  'fronts/build/views/sessions/sessions.js': { select: 2 },
  'packages/ui-kit/views/settings/settings-markup.js': { select: 6 },
  'fronts/build/views/workflows/builder.js': { select: 4 },
  'fronts/build/views/workflows/workflows.js': { select: 3 },
  'packages/ui-kit/workflow-inputs.js': { select: 1 },
};

function countBareControls(src) {
  const text = String(src || '');
  const out = {};
  for (const [kind, { re }] of Object.entries(KINDS)) out[kind] = (text.match(re) || []).length;
  return out;
}

// the .js and .html page files of every layer (the UI kit, the fronts, the apps' page folders: their
// root files and their views/, scripts/source-tree.js pageFiles; a layer's POCs and 3D sources are
// not page files; a scratch tree without manifests has its apps/<app>/renderer/ only)
const listFiles = (root) => pageFiles(root, { match: /\.(js|html)$/ }).map((f) => f.file);

// [{ file, kind, count, allowed, message }], sorted by file.
function checkBareControls({ root = ROOT, baseline = BASELINE } = {}) {
  const problems = [];
  for (const file of listFiles(root).sort()) {
    const counts = countBareControls(fs.readFileSync(path.join(root, ...file.split('/')), 'utf8'));
    const listed = Object.hasOwn(baseline, file) ? baseline[file] : {};
    for (const [kind, { label }] of Object.entries(KINDS)) {
      const allowed = listed[kind] || 0;
      if (counts[kind] <= allowed) continue;
      const how = kind === 'select' ? 'build it with Select.markup (select.js)' : 'use DateRange.fields (date-range.js) or the app\'s input style';
      problems.push({ file, kind, count: counts[kind], allowed, message: `${file} has ${counts[kind]} bare ${label}${counts[kind] === 1 ? '' : 's'}, ${allowed} allowed (scripts/bare-controls.js): ${how}.` });
    }
  }
  return problems.sort((a, b) => a.file.localeCompare(b.file));
}

if (require.main === module) {
  const problems = checkBareControls();
  for (const p of problems) console.log(p.message);
  if (problems.length) process.exitCode = 1;
}

module.exports = {
  BASELINE,
  checkBareControls,
  countBareControls,
  KINDS,
  listFiles,
};
