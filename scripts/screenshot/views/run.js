// Screenshot seed of the Run screen (--view run): a live simulated run started from the Start panel
// (--workflow, --pipeline, --then, --input), its gates approved as they come but the one of --stop-at,
// where it captures, with demo screenshots (not with --no-demo-shots) and a scratch workspace (#201).
// `live`: no finished run is recorded, the default --wait is longer, --stop-at and --input apply.

const fs = require('fs');
const path = require('path');
const { demoEvidence, writeDemoPackage } = require('../helpers');

function seed({ project }) {
  writeDemoPackage(project.folder);
}

async function open(page) {
  const { args, js, pause, project, runDirs } = page;
  // a live simulated run started from the Start panel; gates are approved as they come
  await js(`
    // a pipeline is the Start panel's option "pipe:<file>" (start-drawer.js); never an Electron
    // argument: one with a colon makes Electron exit before this script runs
    await api.setSettings({ developerMode: true, lastWorkflow: ${JSON.stringify(args.pipeline ? `pipe:${args.pipeline}` : args.workflow)} });
    openDrawer(); // #412: Start left the top bar

    await new Promise((r) => setTimeout(r, 500));
    document.querySelector('#project-select').value = ${JSON.stringify(project.id)};
    document.querySelector('#in-task').value = 'Add a /health endpoint';
    for (const [k, val] of Object.entries(${JSON.stringify(args.inputs)})) {
      const el = document.getElementById('in-' + k);
      if (!el) throw new Error('the workflow has no input ' + k);
      el.value = val;
    }
    document.querySelector('#mock-toggle').checked = true;
    if (${JSON.stringify(args.then || '')}) drawerChain().set({ action: 'workflow', workflow: ${JSON.stringify(args.then || '')} });
    if (!document.body.classList.contains('dev-mode')) throw new Error('developer mode is off: refusing to start a real run');
    document.querySelector('#btn-start').click();`);
  // --stop-at: that step's gate stays open and the capture happens once it shows
  const approve = setInterval(() => js(`
    for (const card of document.querySelectorAll('#run-gates:not(.hidden) .run-gate')) {
      if (${JSON.stringify(args.stopAt || '')} && card.querySelector('.run-gate-head')?.textContent.includes(${JSON.stringify(`step: ${args.stopAt}`)})) continue;
      card.querySelector('.run-gate-actions button[data-choice]:not(:disabled), .run-gate-actions button[data-answer="true"]:not(:disabled)')?.click();
      break;
    }`).catch(() => {}), 1000);
  try {
    if (args.stopAt) {
      let shown = false;
      for (const end = Date.now() + Math.max(args.wait, 45000); !shown && Date.now() < end;) {
        await pause(1000);
        shown = await js(`return [...document.querySelectorAll('#run-gates .run-gate-head')].some((h) => h.textContent.includes(${JSON.stringify(`step: ${args.stopAt}`)}))`);
      }
      if (!shown) throw new Error(`the run never waited at ${args.stopAt}`);
      // demo screenshots in the live run, for its gate's Artifacts panel and the viewer
      const live = runDirs()[0];
      if (live && args.demoShots) {
        await demoEvidence(page, live);
        await js(`ArtifactsPanel.refreshRun(${JSON.stringify(path.basename(live))}); window.mountGateScenarios?.(document)`);
      }
      // a live run with a worktree has a scratch workspace (#201; a simulated run has none): a few
      // demo files, for the Run screen's "Scratch workspace" line
      if (live) {
        for (const [rel, text] of [['workspace/skills/code-review/SKILL.md', '# Code review\n'], ['workspace/workflows/software-development.yaml', 'name: demo\n'], ['user-data/Local State', '{}']]) {
          fs.mkdirSync(path.dirname(path.join(live, 'scratch', rel)), { recursive: true });
          fs.writeFileSync(path.join(live, 'scratch', rel), text.repeat(400));
        }
        await js('scratchOfRun.clear(); renderRunSummary()');
      }
      await pause(2500); // the gate's Artifacts panel and changed files load
    } else await pause(args.wait);
  } finally {
    clearInterval(approve);
  }
}

module.exports = {
  live: true,
  open,
  seed,
};
