// Screenshot seed of Artifacts (--view artifacts, a tab of Runs): the run of an enriched issue (a
// second run group for Collapse all / Expand all, #126), a long run history (#200) and a simulated run
// with demo screenshots (#146, #145; not with --no-demo-shots), the simulated runs shown. #80: a
// finished feature run of a project without UI folders (id ending `-nui00080`), whose result.md
// (rendered by the engine's own result summary) says the screenshots and the UI review were skipped.

const fs = require('fs');
const path = require('path');
const { renderResultSummary } = require('@craftorio/engine/domains/evidence/result-summary');
const {
  demoEvidence,
  writeEvents,
} = require('../helpers');
const { demoEnrichRun } = require('./backlog');
const { demoRunHistory } = require('./workflows');

function demoNoUiFoldersRun(ws, projectId) {
  const start = Date.now() - 864e5;
  const runId = `${new Date(start).toISOString().slice(0, 10).replace(/-/g, '')}-101500-nui00080`;
  const dir = path.join(ws.runs, runId);
  const at = (m) => new Date(start + m * 6e4).toISOString();
  const inputs = { task: 'Menu page: list the dishes of the day', ui_folders: [], steps_folders: [] };
  const summary = { run_id: runId, workflow: 'feature', project_id: projectId, mock: false, inputs, status: 'success', started_at: at(0), finished_at: at(18), duration_ms: 18 * 6e4, sessions: [] };
  writeEvents(dir, runId, [
    { ts: at(0), type: 'workflow.started', workflow: 'feature', file: 'feature.yaml', project_id: projectId, mock: false, inputs },
    { ts: at(18), type: 'workflow.finished', status: 'success' },
  ]);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(dir, 'result.md'), renderResultSummary(dir, summary));
}

function seed({ ws, project }) {
  demoEnrichRun(ws, project.id);
  demoRunHistory(ws, project.id);
  demoNoUiFoldersRun(ws, project.id);
}

// no menu entry: a tab of Runs
async function open(page) {
  if (page.run?.simulated && page.args.demoShots) await demoEvidence(page, page.run.dir);
  await page.js('showView("artifacts")');
}

// the demo runs are simulated, which Artifacts hides by default
const afterOpen = ({ js }) => js('const c = document.querySelector(\'#art-show-sim\'); if (c && !c.checked) c.click();');

module.exports = {
  afterOpen,
  open,
  run: true,
  seed,
};
