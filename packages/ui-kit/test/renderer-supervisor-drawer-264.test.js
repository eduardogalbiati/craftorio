// #264 (with #254): the Supervisor button leaves the top bar and the Supervisor screen leaves the
// menu; the supervisor's conversation (history, input, agent inbox) opens as a right-side drawer
// from the Workflows screen (#409: its round Supervisor button), like the Product Owner's drawer in the Backlog.
// Esc and the backdrop still close it; a run's "Ask the supervisor" keeps working.
// The views are the real page (test/renderer-app-harness.js loads index.html's scripts in a vm).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pageDirs, pageFile, pageFiles } = require('../../../scripts/source-tree');
const PAGE_ROOT = path.join(__dirname, '..', '..', '..');
// a page file by its page-relative name, wherever its layer is (phase 3 of the reorganisation study)
const page = (rel) => pageFile(PAGE_ROOT, rel);
void pageDirs; void pageFiles; void page;
const { loadApp, navEntries, text } = require('./renderer-app-harness');

const sources = () => pageFiles(PAGE_ROOT, { match: /\.(js|html)$/ }).map((f) => path.join(PAGE_ROOT, f.file));
const drawerOpen = (app) => app.el('#svc-drawer').classList.contains('open');

test('the top bar has no Supervisor button on any screen, and nothing references #btn-svc-open', async () => {
  const app = loadApp();
  await app.boot();
  for (const view of ['dashboard', 'workflows', 'backlog']) {
    app.run(`showView('${view}')`);
    await app.settle();
  }
  assert.ok(!app.created.some((el) => el.id === 'btn-svc-open'), 'a #btn-svc-open button was created');
  const referencing = sources().filter((f) => fs.readFileSync(f, 'utf8').includes('btn-svc-open')).map((f) => path.relative(PAGE_ROOT, f));
  assert.deepEqual(referencing, []);
});

test('the Supervisor screen and its menu entry are gone', () => {
  const app = loadApp();
  assert.ok(!navEntries(app.defs).some((e) => /supervisor/i.test(text(e.label))), 'a menu entry still names the Supervisor');
  const markup = [...app.defs.values()].map((d) => d.markup || '').join('\n');
  assert.doesNotMatch(markup, /id="view-supervisor"/);
});

// #409: the header's button became a round button at the bottom right (data-testid supervisor-fab)
test('the Workflows screen opens the Supervisor drawer (its round Supervisor button, #409)', async () => {
  const app = loadApp();
  await app.boot();
  app.run("showView('workflows')");
  await app.settle();
  assert.match(app.defs.get('workflows').markup, /data-testid="supervisor-fab"/);
  assert.equal(drawerOpen(app), false);
  await app.click('[data-testid="supervisor-fab"]', { within: ['#view-workflows'] });
  assert.equal(drawerOpen(app), true);
});

test('the drawer still closes on its backdrop and on Esc', async () => {
  const app = loadApp();
  await app.boot();
  app.run('window.openSupervisorChat()');
  await app.settle();
  assert.equal(drawerOpen(app), true);
  await app.click('#svc-backdrop');
  assert.equal(drawerOpen(app), false);

  app.run('window.openSupervisorChat()');
  await app.settle();
  assert.equal(drawerOpen(app), true);
  await app.key('Escape');
  assert.equal(drawerOpen(app), false);
});

test('a run\'s "Ask the supervisor" actions keep their handler (the run\'s supervisor drawer)', async () => {
  const app = loadApp();
  await app.boot();
  assert.equal(app.run('typeof openSupervisorForCurrent'), 'function');
  assert.match(fs.readFileSync(page('views/run/run.js'), 'utf8'), /\$\('#btn-run-sup'\)\.onclick = \(\) => openSupervisorForCurrent\(\)/);
});
