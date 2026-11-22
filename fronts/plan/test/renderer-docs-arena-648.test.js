// #648 (phase 2 of #636, docs/work/write-doc/spec.md R5, R14): "Several writers" (Arena mode) in the
// write-doc draft. The New item panel of the Documents screen (fronts/plan/views/docs, #647/#671) had
// the option drawn but disabled; with phase 2 it can be turned on. Acceptance test, written before the
// code: the real page in the renderer harness with a fake window.api.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

// startRun answers, in order (the last one repeats): e.g. an ended run's kept work, then a run
async function docsApp({ answers = [{ runId: 'r9' }] } = {}) {
  let n = 0;
  const app = loadApp({
    storage: { 'craftorio.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/repo' }],
      getSettings: async () => ({ lastProject: 'p1' }),
      listDocItems: async () => [],
      readDoc: async (projectId, item, doc) => ({ item, doc, status: 'draft', source: { file: `docs/work/${item}/${doc}.md`, markdown: '# Doc\n' }, translation: null }),
      listDocChanges: async () => ({ changes: [], unreviewed: [], base: 'abc123' }),
      startRun: async () => answers[Math.min(n++, answers.length - 1)],
    },
  });
  await app.boot();
  app.run("showView('docs')");
  await app.settle(10);
  return app;
}

// the opening tag of the element carrying data-testid="<id>" in the page's markup, or ''
function openingTag(app, id) {
  const html = [...app.elements.values(), ...app.created].map((e) => e.innerHTML || '')
    .concat(app.defs.get('docs')?.markup || '', app.defs.get('docs')?.modals || '').join('\n');
  const at = html.indexOf(`data-testid="${id}"`);
  if (at < 0) return '';
  const start = html.lastIndexOf('<', at);
  return html.slice(start, html.indexOf('>', at) + 1);
}

test('#648 the New item panel\'s "Several writers" option can be turned on (no longer disabled)', async () => {
  const app = await docsApp();
  const tag = openingTag(app, 'docs-new-writers');
  assert.notEqual(tag, '', 'no docs-new-writers control');
  assert.equal(/\sdisabled(\s|=|\/|>)/.test(tag), false, `the option is still disabled: ${tag}`);
});

// ---- the writers count (2 to 5) and the run's `writers` input ----------------------------------------

const BOX = '#docs-new-panel [data-testid="docs-new-writers"]';
const COUNT = '#docs-new-writers-count';
const COUNT_ROW = '#docs-new-panel [data-docs-writers-count]';
const plain = (v) => JSON.parse(JSON.stringify(v ?? null)); // a page object as a plain one

// fills the New item panel and submits it (the panel's Start)
async function startNewItem(app, title, { writers = null, count = null } = {}) {
  app.run('DocsPanels.newItemWriters(false)'); // the panel as it opens
  app.el('#docs-new-title').value = title;
  app.el('#docs-new-starts').value = 'intent';
  if (writers !== null) app.el(BOX).checked = writers;
  if (count !== null) app.el(COUNT).value = count;
  app.run('DocsPanels.newItemWriters()'); // the box's change
  await app.el('#docs-new-form').onsubmit({ preventDefault() {} });
  await app.settle(20);
}

test('#648 the writers count shows only while "Several writers" is on, three by default', async () => {
  const app = await docsApp();
  assert.equal(app.run('DocsPanels.newItemWriters(false)'), null, 'off: no writers input');
  assert.equal(app.el(COUNT_ROW).classList.contains('hidden'), true);
  app.el(BOX).checked = true;
  assert.equal(app.run('DocsPanels.newItemWriters()'), '3');
  assert.equal(app.el(COUNT_ROW).classList.contains('hidden'), false);
});

test('#648 the writers count is 2 to 5; another value falls back to three', async () => {
  const app = await docsApp();
  app.el(BOX).checked = true;
  for (const n of ['2', '3', '4', '5']) {
    app.el(COUNT).value = n;
    assert.equal(app.run('DocsPanels.newItemWriters()'), n);
  }
  for (const n of ['1', '6', '']) {
    app.el(COUNT).value = n;
    assert.equal(app.run('DocsPanels.newItemWriters()'), '3', `count ${JSON.stringify(n)}`);
  }
});

test('#648 turning "Several writers" off puts the count back to three', async () => {
  const app = await docsApp();
  app.el(BOX).checked = true;
  app.el(COUNT).value = '5';
  assert.equal(app.run('DocsPanels.newItemWriters(false)'), null);
  assert.equal(app.el(BOX).checked, false);
  assert.equal(app.el(COUNT).value, '3');
});

test('#648 a new item with "Several writers" on starts write-doc with the chosen count as its writers input', async () => {
  const app = await docsApp();
  await startNewItem(app, 'Export runs as CSV', { writers: true, count: '4' });
  const starts = app.callsTo('startRun');
  assert.equal(starts.length, 1);
  assert.equal(starts[0][0].file, 'write-doc.yaml');
  assert.equal(starts[0][0].inputs.item, 'export-runs-as-csv');
  assert.equal(starts[0][0].inputs.writers, '4');
});

test('#648 a new item with "Several writers" off sends no writers input (the workflow\'s one writer)', async () => {
  const app = await docsApp();
  await startNewItem(app, 'Export runs as CSV', { writers: false, count: '5' });
  const starts = app.callsTo('startRun');
  assert.equal(starts.length, 1);
  assert.equal('writers' in starts[0][0].inputs, false, JSON.stringify(plain(starts[0][0].inputs)));
});

// ---- an ended run of the item kept work (#112/#170): from scratch, or nothing --------------------------

const KEPT = { kept: { runId: 'old-run', branch: 'write-doc/export-runs-as-csv' } };

test('#648 kept work, the owner starts from scratch: the same run is asked again, confirmed, and its editor opens', async () => {
  const app = await docsApp({ answers: [KEPT, { runId: 'r10' }] });
  app.run("window.keptWorkDialog = async () => 'scratch';");
  const out = await app.run("writeDocForCard({ projectId: 'p1', cardId: 'c1', title: 'Export runs as CSV' })");
  await app.settle(20);
  assert.equal(out, 'r10');
  const starts = app.callsTo('startRun').map(([req]) => plain(req));
  assert.equal(starts.length, 2);
  assert.equal(starts[0].confirmed, undefined);
  assert.equal(starts[1].confirmed, true);
  assert.deepEqual(starts[1].inputs, starts[0].inputs, 'the retry starts the same document');
  assert.equal(app.callsTo('readDoc').length > 0, true, 'the editor opened');
});

test('#648 kept work, the owner keeps it: no new run, no editor, writeDocForCard gives null', async () => {
  const app = await docsApp({ answers: [KEPT] });
  app.run("window.keptWorkDialog = async () => 'keep';");
  const out = await app.run("writeDocForCard({ projectId: 'p1', cardId: 'c1', title: 'Export runs as CSV' })");
  await app.settle(20);
  assert.equal(out, null);
  assert.equal(app.callsTo('startRun').length, 1);
  assert.equal(app.callsTo('readDoc').length, 0, 'no editor opened');
});

test('#648 kept work on a new item: from scratch keeps the writers count in the confirmed run', async () => {
  const app = await docsApp({ answers: [KEPT, { runId: 'r11' }] });
  app.run("window.keptWorkDialog = async () => 'scratch';");
  await startNewItem(app, 'Export runs as CSV', { writers: true, count: '2' });
  const starts = app.callsTo('startRun').map(([req]) => plain(req));
  assert.equal(starts.length, 2);
  assert.equal(starts[1].confirmed, true);
  assert.equal(starts[1].inputs.writers, '2');
});

// ---- Enrich on a Backlog issue (views/backlog/backlog.js enrichIssue → writeDocForCard) ---------------

test('#648 Enrich writes the issue\'s spec: item issue-<n>-<title>, document spec, the issue linked to the run', async () => {
  const app = await docsApp({ answers: [{ runId: 'r12' }] });
  const issue = { number: 42, url: 'https://github.com/o/r/issues/42', title: 'Export runs as CSV' };
  const out = await app.run(`writeDocForCard(${JSON.stringify({ projectId: 'p1', title: issue.title, issue, prompt: 'Issue #42: Export runs as CSV' })})`);
  await app.settle(20);
  assert.equal(out, 'r12');
  const [req] = app.callsTo('startRun').map(([r]) => plain(r));
  assert.equal(req.inputs.item, 'issue-42-export-runs-as-csv');
  assert.equal(req.inputs.document, 'spec');
  assert.equal(req.inputs.prompt, 'Issue #42: Export runs as CSV');
  assert.deepEqual(req.issues, [issue]);
  const reads = app.callsTo('readDoc').map(([p, item, doc]) => `${p}/${item}/${doc}`);
  assert.equal(reads.includes('p1/issue-42-export-runs-as-csv/spec'), true, JSON.stringify(reads));
});
