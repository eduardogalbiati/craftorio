// Screenshot seed of Artifacts (--view artifacts, a tab of Runs): the run of an enriched issue (a
// second run group for Collapse all / Expand all, #126), a long run history (#200) and a simulated run
// with demo screenshots (#146, #145; not with --no-demo-shots), the simulated runs shown.

const { demoEvidence } = require('../helpers');
const { demoEnrichRun } = require('./backlog');
const { demoRunHistory } = require('./workflows');

function seed({ ws, project }) {
  demoEnrichRun(ws, project.id);
  demoRunHistory(ws, project.id);
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
