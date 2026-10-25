// #430: the links inside the city modal (fronts/analyser/views/project/project-city-modal.js) never leave a
// dead button or the modal over another screen. A link that navigates (a run of the agents layer, the
// Conflict map link of a collision, the City view's "Show the facts") closes the modal first; a link
// with nowhere to go in the modal is not shown there. The window is test/city-modes-harness.js's (no
// WebGL: the City view shows its message with "Show the facts"), on the Backlog, the project's
// Conflict map script loaded so its link is drawn as in the app.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const H = require('./city-modes-harness');

const { STAGE, REPLAY, settle, q } = H;
const CMAP = pageFileOf('views/project/project-conflict-map.js');

// a run in progress on the stage's files, with a collision (its Conflict map link)
const BUSY = () => ({
  projectId: 'p1',
  runs: [{ id: 'run-1', colour: '#e4572e', agents: [{ session_id: 's-dev', agent: 'developer', step: 'implement', path: 'src/engine/run.js', kind: 'change', ts: '2026-10-13T10:00:05.000Z' }], trail: ['src/engine/run.js'], dirty: [] }],
  collisions: [{ path: 'src/engine/run.js', runs: ['run-1', 'run-2'] }],
});

function onBacklog(t) {
  const h = H.loadWindow({ agents: BUSY });
  vm.runInContext(fs.readFileSync(CMAP, 'utf8'), h.w, { filename: 'project-conflict-map.js' });
  const doc = h.dom.document;
  const shown = [];
  const runs = [];
  h.w.showView = (v) => { shown.push(String(v)); };
  h.w.showRun = (id) => { runs.push(String(id)); };
  h.w.state.view = 'backlog';
  const o = { ...h, doc, shown, runs };
  t.after(() => { try { q(modalOf(o), 'city-modal-close')?.click(); } catch { /* already closed */ } });
  return o;
}

const modalOf = (o) => [...o.doc.body.querySelectorAll('[data-testid="city-modal"]')].find((el) => H.visible(o.doc.body, el)) || null;
const shownIn = (root, selector) => [...(root?.querySelectorAll(selector) || [])].filter((el) => H.visible(root, el));

test('#430 the City view\'s "Show the facts" inside the modal leads to the project\'s facts or is not shown', async (t) => {
  const o = onBacklog(t);
  o.w.ProjectCityImpact.showStage('p1', STAGE);
  await settle();
  const m = modalOf(o);
  assert.equal(m === null, false, 'the modal is open');
  const buttons = shownIn(m, '[data-pc-facts], [data-pc-open-facts]');
  if (!buttons.length) return; // no button with nowhere to go: fine
  buttons[0].click();
  await settle();
  assert.equal(modalOf(o) === null, true, 'the modal closed: no dead button');
  assert.deepEqual(o.calls.openCity, ['p1'], 'the project was opened (its Architecture tab, Facts)');
});

for (const [what, open] of [
  ['a stage', (w) => w.ProjectCityImpact.showStage('p1', STAGE)],
  ['a replay', (w) => w.ProjectCityAgents.replay('p1', REPLAY.runId)],
]) {
  test(`#430 a run link inside the modal of ${what} closes the modal before opening the run`, async (t) => {
    const o = onBacklog(t);
    open(o.w);
    await settle();
    const m = modalOf(o);
    assert.equal(m === null, false, 'the modal is open');
    const links = shownIn(m, '[data-pca-run]');
    if (!links.length) return; // the modal shows no run link in this mode
    const id = String(links[0].getAttribute('data-pca-run'));
    links[0].click();
    await settle();
    assert.deepEqual(o.runs, [id], 'the run opens');
    assert.equal(modalOf(o) === null, true, 'the modal closed: it does not cover the run\'s screen');
  });

  test(`#430 the Conflict map link inside the modal of ${what} closes the modal before opening the tab`, async (t) => {
    const o = onBacklog(t);
    open(o.w);
    await settle();
    const m = modalOf(o);
    assert.equal(m === null, false, 'the modal is open');
    const links = shownIn(m, '[data-pcm-link]');
    if (!links.length) return; // the modal shows no Conflict map link in this mode
    links[0].click();
    await settle();
    assert.deepEqual(o.calls.openCity, ['p1'], 'the project\'s Conflict map tab opens');
    assert.equal(modalOf(o) === null, true, 'the modal closed: it does not cover the project\'s screen');
  });
}
