// #465 a live terminal on the deterministic steps: the Run screen (acceptance tests written before the
// code). A suite step's card (the step's entry on the Run screen) shows "Live terminal" and "↗"
// (term-dock.js termButtons: the dock, an external window) for its log, the `path` of the run's
// step.log event for that step: while the round runs, and once it ended (the last round's log).
// The page is the real one (test/renderer-app-harness.js); the run is fed through window.api's
// onEvent handler as the service pushes it, then the Run screen is shown. The markup read is the Run
// screen's steps (#steps) and side column (#run-summary); the step's card is the innermost element
// around a "Live terminal" button that names the step (its id as title / data-step, or its log path).
// No agent session is opened in this run: any "Live terminal" drawn is a step's.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./roadmap-status-helpers');
const { loadApp } = require('./renderer-app-harness');

const STEPS = [{ id: 'develop', agent: 'dev' }, { id: 'suite', type: 'suite' }];

async function runScreen(events) {
  const app = loadApp({ api: { externalTerminal: { available: true } } });
  await app.boot();
  const ts = () => new Date().toISOString();
  let seq = 0;
  const emit = (ev) => app.apiHandlers.onEvent.forEach((fn) => fn({ run_id: 'r1', ts: ts(), seq: ++seq, ...ev }));
  emit({ type: 'workflow.started', workflow: 'wf', run_dir: 'C:/ws/runs/r1', inputs: {}, steps: STEPS });
  for (const ev of events) emit(ev);
  app.run("state.runId = 'r1'; showView('run')");
  await app.settle(30);
  assert.deepEqual(app.errors.map((e) => String(e.message)), [], 'the page drew without errors');
  return app;
}

const markup = (app) => `${app.el('#steps').innerHTML}\n${app.el('#run-summary').innerHTML}`;
const namesSuite = (el) => /title="suite"|data-step(?:-id)?="suite"|logs\/suite-1\.log/.test(el.outer);
const textOf = (el) => H.visibleText(el.inner);

// the suite step's card: the innermost element holding a "Live terminal" button and naming the step
function suiteCard(html) {
  const all = H.elements(html);
  const live = all.filter((e) => e.name === 'button' && textOf(e) === 'Live terminal');
  for (const btn of live) {
    for (let p = btn.parent; p; p = p.parent) if (namesSuite(p)) return p;
  }
  return null;
}
const buttonsIn = (card) => H.elements(card.outer).filter((e) => e.name === 'button').map(textOf);

test('#465 a running suite step\'s card shows "Live terminal" and "↗" for its log', async () => {
  const app = await runScreen([
    { type: 'step.started', step_id: 'suite', visit: 1 },
    { type: 'step.log', step_id: 'suite', path: 'logs/suite-1.log', command: 'npm test' },
  ]);
  const html = markup(app);
  const card = suiteCard(html);
  assert.ok(card, `the suite step's card has a "Live terminal" button: ${html.slice(0, 1500)}`);
  const buttons = buttonsIn(card);
  assert.ok(buttons.includes('Live terminal'), JSON.stringify(buttons));
  assert.ok(buttons.includes('↗'), `and "↗" (an external window): ${JSON.stringify(buttons)}`);
});

test('#465 an ended suite step\'s card still shows "Live terminal" and "↗" (its last round\'s log)', async () => {
  const app = await runScreen([
    { type: 'step.started', step_id: 'suite', visit: 1 },
    { type: 'step.log', step_id: 'suite', path: 'logs/suite-1.log', command: 'npm test' },
    { type: 'file.saved', step_id: 'suite', path: 'C:/ws/runs/r1/logs/suite-1.log' },
    { type: 'step.finished', step_id: 'suite', visit: 1, output: { kind: 'suite', status: 'pass', round: 1, scope: 'full', command: 'npm test', log: 'logs/suite-1.log', failures: [] } },
  ]);
  const html = markup(app);
  const card = suiteCard(html);
  assert.ok(card, `the ended suite step's card has a "Live terminal" button: ${html.slice(0, 1500)}`);
  assert.ok(buttonsIn(card).includes('↗'));
});
