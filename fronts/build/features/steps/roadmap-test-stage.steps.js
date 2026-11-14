// Steps of fronts/build/features/roadmap-test-stage-702.feature (#702): "Start Test" on a built work item of
// the Roadmap starts the sdlc-test workflow on it. Reuses "I open the Roadmap" (backlog.steps.js), "I show
// all the items of the roadmap" (roadmap-waiting-merge.steps.js), "the roadmap item {string} offers {string}
// on its card", "... offers no {string} button", "I click {string} on the roadmap item {string}"
// (roadmap.steps.js) and the gate card's steps (run.steps.js). Locators are roles and data-testid only
// (skills/ui-conventions).
//
// The seed: a work item is a roadmap item whose inputs.item names its folder under docs/work/ in the
// project's folder (the inputs of sdlc-record / sdlc-test); its plan.md has the Progress table the Code &
// Build runs fill, and `status: built` once every row is done. The project's folder is made a local git
// repository with one commit (sdlc-test starts from the local base, remote: false).
//
// What the screens expose (the renderer's contract for these steps):
// - the button "Start Test" (exact name) on the card of a built work item only (role button, inside
//   data-testid="roadmap-item");
// - data-testid="roadmap-test-run" (new): on that card once its Test run started, a button that opens the
//   run (data-run = the run id), in place of "Start Test".

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');
const workflows = require('../../../../features/support/workflows');

const LOAD_TIMEOUT = 30000;
const RUN_TIMEOUT = 60000;

const roadmapItem = (page, title) => page.getByTestId('roadmap-item').filter({ hasText: title }).first();
const slugOf = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---- the demo workspace, edited once the app is open (the app follows the files) ----------------

const roadmapFile = (e2e) => path.join(e2e.scratch, 'workspace', 'backlog', `${e2e.project.id}.roadmap.json`);
function editRoadmap(e2e, fn) {
  const file = roadmapFile(e2e);
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  fn(r);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...r, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, file);
}

function git(e2e, cwd, args) {
  const config = path.join(e2e.scratch, 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_AUTHOR_DATE: '2026-10-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T10:00:00Z' };
  return execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, env, encoding: 'utf8' }).trim();
}

// docs/work/<slug>/plan.md: `done` of `total` Progress rows done; built when all are
function planMd(slug, title, done, total) {
  const built = done === total;
  const rows = Array.from({ length: total }, (_, k) => (k < done
    ? `| ${k + 1}. Step ${k + 1} | done | run-${slug}-${k + 1} | abc${k + 1}def |`
    : `| ${k + 1}. Step ${k + 1} | pending | — | — |`));
  return [
    '---', `item: ${slug}`, 'issue: "#1"', 'stage: build', `status: ${built ? 'built' : 'accepted'}`, 'date: 2026-10-01', '---', '',
    `# Plan: ${title}`, '', '## Proof', '', `- ${title} works end to end.`, '',
    '## Progress', '', '| Step | Status | Run | Commit / PR |', '|---|---|---|---|', ...rows, '',
  ].join('\n');
}

// a done roadmap item whose docs/work/<slug>/ folder has a plan with `done` of `total` Progress rows done,
// in a stage "Work items" added at the end of the demo roadmap (the roadmap planned: nothing starts)
Given('the roadmap has the work item {string} with {int} of {int} Progress steps done', async ({ e2e }, title, done, total) => {
  const folder = e2e.project && e2e.project.folder;
  expect(folder, 'the demo project has a folder').toBeTruthy();
  const slug = slugOf(title);
  const dir = path.join(folder, 'docs', 'work', slug);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(folder, '.git'))) git(e2e, folder, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'intent.md'), `---\nitem: ${slug}\nstage: plan\nstatus: accepted\n---\n\n# Intent: ${title}\n`);
  fs.writeFileSync(path.join(dir, 'spec.md'), `---\nitem: ${slug}\nstage: design\nstatus: signed off\n---\n\n# Spec: ${title}\n\n- R1. ${title} works end to end.\n`);
  fs.writeFileSync(path.join(dir, 'plan.md'), planMd(slug, title, done, total));
  git(e2e, folder, ['add', '-A']);
  git(e2e, folder, ['commit', '-q', '-m', `Plan of ${title}: ${done} of ${total} steps done`]);
  editRoadmap(e2e, (r) => {
    const model = r.stages.flatMap((s) => s.items).find((x) => x.status === 'planned' && !x.runId && !x.error);
    expect(model, 'a planned item in the demo roadmap').toBeTruthy();
    const base = JSON.parse(JSON.stringify(model));
    for (const k of ['issues', 'reason', 'modeReason', 'origin', 'cost']) delete base[k];
    const number = 7020 + r.stages.flatMap((s) => s.items).filter((x) => String(x.id).startsWith('work-item-')).length;
    const item = {
      ...base, id: `work-item-${slug}`, number, url: `${e2e.project.repo}/issues/${number}`, title, body: `The Code & Build work of ${title}.`, knownPullRequests: [],
      workflow: workflows.FEATURE.file, workflowName: workflows.FEATURE.name, mock: true,
      inputs: { ...workflows.LOCAL, item: slug }, status: 'done', runId: null, runs: [], error: null,
    };
    let stage = r.stages.find((s) => s.id === 'stage-work-items');
    if (!stage) {
      stage = { id: 'stage-work-items', name: 'Work items', note: '', items: [] };
      r.stages.push(stage);
    }
    stage.items.push(item);
    Object.assign(r, { state: 'planned', simulated: true, pausedBy: null, error: null });
  });
});

// ---- the runs of the scratch workspace ------------------------------------------------------------

// the workflow.started event of each run in the scratch workspace
function startedRuns(e2e) {
  const runs = path.join(e2e.scratch, 'workspace', 'runs');
  if (!fs.existsSync(runs)) return [];
  return fs.readdirSync(runs).map((d) => {
    const file = path.join(runs, d, 'events.jsonl');
    if (!fs.existsSync(file)) return null;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'workflow.started') return { dir: d, ...ev };
      } catch { /* a line being written */ }
    }
    return null;
  }).filter(Boolean);
}

Then('a run of the workflow {string} started for the work item {string}', async ({ e2e }, name, slug) => {
  await expect.poll(() => startedRuns(e2e).some((ev) => ev.workflow === name && ev.inputs?.item === slug), {
    timeout: RUN_TIMEOUT, message: `a ${name} run with the input item=${slug}`,
  }).toBe(true);
});

Then('no run of the workflow {string} has started', async ({ e2e }, name) => {
  // the Roadmap had its time to draw and to act: nothing starts the Test stage by itself
  await expect(e2e.window.getByTestId('roadmap-item').first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await e2e.window.waitForTimeout(2000);
  expect(startedRuns(e2e).filter((ev) => ev.workflow === name)).toEqual([]);
});

// ---- the Test run on the card ---------------------------------------------------------------------

Then('the roadmap item {string} shows its Test run', async ({ e2e }, title) => {
  const chip = roadmapItem(e2e.window, title).getByTestId('roadmap-test-run');
  await expect(chip).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(chip).toHaveAttribute('data-run', /\S/);
});

When('I open the Test run of the roadmap item {string}', async ({ e2e }, title) => {
  const chip = roadmapItem(e2e.window, title).getByTestId('roadmap-test-run');
  await expect(chip).toBeVisible({ timeout: RUN_TIMEOUT });
  await chip.click();
});
