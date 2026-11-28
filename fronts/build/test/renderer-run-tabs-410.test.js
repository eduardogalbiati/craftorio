// #410 the Run screen's tab row, and #412 its Stop / Pause. Acceptance tests written before the code.
// The page is the real one (test/renderer-app-harness.js): a run is put in app.js's `state`, render()
// draws the Run screen, and what shows is rebuilt as one HTML string from the view's markup and what
// each of its elements (by id) was given as innerHTML; an element hidden (class "hidden", static or
// toggled, or `.hidden`) is left out. The markup is read with test/roadmap-status-helpers.js's parser.
//
// Assumed interface (the developer's names are free except where listed):
// - The FIRST row of section#view-run (a direct child of it, before #run-fail-banner,
//   #run-pause-banner, #run-chain and #run-gates) holds a role="tablist" (class "tabs") with three
//   role="tab" (class "tab"): Chat, Details, 3D; Details has aria-selected="true".
// - The run's actions keep their ids (#btn-run-sup, #btn-run-watch, #btn-run-resume, #btn-run-diff,
//   #btn-run-analytics…) and conditions, but sit in that row (outside the tablist), not in the
//   Workflow panel (#run-summary).
// - A live run without a chain: "+ When it finishes…" ([data-chain="edit"]) is in the row, and no
//   chain banner shows. With a chain, the banner (Edit / Cancel chain) shows after the row.
// - #412: a live run of this window has "Pause after current step" and "Stop" buttons in that row;
//   a past / finished run has neither.
// - The details panel's tabs read Artifacts | Session | Events, and a run opens on Artifacts
//   (app.js state.tab defaults to 'artifacts').
// - The run chat's header has the same tablist (Chat selected).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const H = require('./roadmap-status-helpers');

const cls = (e) => String(e.attrs.class || '').split(/\s+/).filter(Boolean);
// the screen's own section (.view) is shown by showView through the real DOM only: never hidden here
const staticHidden = (e) => !cls(e).includes('view') && (cls(e).includes('hidden') || 'hidden' in e.attrs);

// the fake element of an id, if a script ever touched it
const fakeOf = (app, id) => app.created.find((c) => c.id === id) || app.elements.get(`#${id}`) || null;

// a real DOM's classList starts from the class attribute: same for the fake elements of the markup
function seedHidden(app, markup) {
  for (const e of H.elements(markup)) {
    if (!e.attrs.id || !staticHidden(e)) continue;
    const el = app.el(`#${e.attrs.id}`);
    if (el.classList.length === 0) el.classList.add('hidden');
  }
}

// what shows: the markup with each element's rendered innerHTML put in, hidden elements left out
function shown(app, html, depth = 0) {
  if (depth > 6) return html;
  let out = '';
  let at = 0;
  for (const e of H.elements(html)) {
    if (e.start < at) continue;
    const fake = e.attrs.id ? fakeOf(app, e.attrs.id) : null;
    const hidden = cls(e).includes('view') ? false : fake ? fake.classList.contains('hidden') || fake.hidden === true || (depth > 0 && staticHidden(e)) : staticHidden(e);
    if (hidden) { out += html.slice(at, e.start); at = e.end; continue; }
    if (fake && typeof fake.innerHTML === 'string' && fake.innerHTML.trim()) {
      out += html.slice(at, e.openEnd) + shown(app, fake.innerHTML, depth + 1) + html.slice(e.innerEnd, e.end);
      at = e.end;
    }
  }
  return out + html.slice(at);
}

/** The Run screen showing run r1. status: its status; past: opened from disk; chain: r.chain; events: its events. */
async function runScreen({ status = 'running', past = false, chain = null, events = [] } = {}) {
  const app = loadApp({ api: { runChain: async () => chain, listActiveRuns: async () => [], listRuns: async () => ({ runs: [] }) } });
  seedHidden(app, app.defs.get('run').markup);
  await app.boot();
  app.sandbox.__run = { id: 'r1', status, startedAt: Date.now() - 60000, finishedAt: status === 'running' ? null : Date.now(), workflow: 'software-development', file: 'software-development.yaml', inputs: {}, chain };
  app.sandbox.__events = events;
  app.sandbox.__past = past;
  app.run("(() => { const v = newRunView(); v.past = __past; v.run = __run; v.events = __events; state.runs.set('r1', v); state.runId = 'r1'; })()");
  app.run("showView('run')");
  await app.settle();
  app.run('render()');
  await app.settle();
  return { app, html: shown(app, app.defs.get('run').markup) };
}

const els = (html) => H.elements(html);
const section = (html) => H.findEl(html, (e) => e.attrs.id === 'view-run');
const tablist = (html) => H.findEl(section(html).outer, (e) => e.attrs.role === 'tablist');
// the row of the Run screen holding the tablist: the section's direct child that contains it
function tabRow(html) {
  const all = els(html);
  const sec = all.find((e) => e.attrs.id === 'view-run');
  let node = all.find((e) => e.attrs.role === 'tablist' && e.start > sec.start && e.end <= sec.end);
  assert.ok(node, 'the Run screen has a role="tablist"');
  while (node.parent && node.parent !== sec) node = node.parent;
  assert.equal(node.parent === sec, true, 'the tablist is inside the Run screen\'s section');
  return node;
}
const hasIn = (html, pred) => H.findAll(html, pred).length > 0;
// the redesign (2026-11-28): the row shows at most two actions, the others are entries of its ⋮ menu (closed,
// so hidden): the row's actions are #run-actions' whole markup, open menu or not
const rowActions = (app) => `<div>${fakeOf(app, 'run-actions')?.innerHTML || ''}</div>`;
const byId = (id) => (e) => e.attrs.id === id;
const buttonText = (label) => (e) => e.name === 'button' && H.visibleText(e.inner).trim() === label;
// the Workflow panel: the element whose heading reads "Workflow"
function workflowPanel(html) {
  const h = H.findEl(html, (e) => /^h\d$/.test(e.name) && H.visibleText(e.inner).trim() === 'Workflow');
  return h ? h.parent.outer : '';
}

// ---- the tab row --------------------------------------------------------------------------------

test('#410 Run screen: Chat, Details and 3D are tabs of a role="tablist" (.tabs), Details selected', () => {
  const app = loadApp();
  const markup = app.defs.get('run').markup;
  const list = tablist(markup);
  assert.ok(list, 'the Run screen has a role="tablist"');
  assert.equal(cls(list).includes('tabs'), true, 'the tablist has the .tabs class');
  const tabs = H.findAll(list.outer, (e) => e.attrs.role === 'tab');
  assert.deepEqual(tabs.map((e) => H.visibleText(e.inner).trim()), ['Chat', 'Details', '3D']);
  assert.deepEqual(tabs.map((e) => cls(e).includes('tab')), [true, true, true], 'each tab has the .tab class');
  assert.deepEqual(tabs.map((e) => e.attrs['aria-selected'] || 'false'), ['false', 'true', 'false']);
  assert.equal(list.attrs['aria-label'], 'Run view');
  assert.equal(tabs[2].attrs['data-testid'], 'run-3d', 'the 3D tab keeps its test id');
});

test('#410 Run screen: the tab row is its first row, above the fail, pause and chain banners and the gate cards', () => {
  const app = loadApp();
  const markup = app.defs.get('run').markup;
  const row = tabRow(markup);
  const sec = section(markup);
  const firstChild = els(markup).find((e) => e.parent && e.parent.start === sec.start);
  assert.equal(firstChild.start, row.start, 'the tab row is the section\'s first child');
  assert.equal(row.attrs['data-testid'], 'run-tab-row', 'the row has data-testid="run-tab-row" (the E2E steps\' locator)');
  for (const id of ['run-fail-banner', 'run-pause-banner', 'run-chain', 'run-gates']) {
    const box = H.findEl(markup, byId(id));
    assert.ok(box, `#${id} is still on the Run screen`);
    assert.equal(box.start > row.end, true, `#${id} comes after the tab row`);
  }
});

test('#410 run chat: its header shows the same tablist, Chat selected, with Details and 3D', () => {
  const app = loadApp();
  const markup = app.defs.get('runchat').markup;
  const list = H.findEl(markup, (e) => e.attrs.role === 'tablist');
  assert.ok(list, 'the run chat has a role="tablist"');
  assert.equal(cls(list).includes('tabs'), true);
  const tabs = H.findAll(list.outer, (e) => e.attrs.role === 'tab');
  assert.deepEqual(tabs.map((e) => H.visibleText(e.inner).trim()), ['Chat', 'Details', '3D']);
  assert.deepEqual(tabs.map((e) => e.attrs['aria-selected'] || 'false'), ['true', 'false', 'false']);
  assert.equal(list.attrs['aria-label'], 'Run view');
  assert.equal(tabs[2].attrs['data-testid'], 'run-3d', 'the 3D tab keeps its test id');
});

// ---- the run's actions on the tab row ------------------------------------------------------------

test('#410 Details, a live run: Ask the supervisor, Watch, Review changes and Open in Analytics sit on the tab row, outside the tablist, not in the Workflow panel', async () => {
  const { app, html } = await runScreen({ status: 'running', events: [{ type: 'worktree.ready', run_id: 'r1' }] });
  const row = tabRow(html);
  const list = H.findEl(row.outer, (e) => e.attrs.role === 'tablist');
  assert.equal(hasIn(row.outer, byId('run-actions')), true, 'the actions\' box is on the tab row');
  for (const id of ['btn-run-sup', 'btn-run-watch', 'btn-run-diff', 'btn-run-analytics']) {
    assert.equal(hasIn(rowActions(app), byId(id)), true, `#${id} is on the tab row (a button or a ⋮ entry)`);
    assert.equal(hasIn(list.outer, byId(id)), false, `#${id} is not one of the tabs`);
    assert.equal(hasIn(workflowPanel(html), byId(id)), false, `#${id} left the Workflow panel`);
  }
});

test('#410 Details, a failed run: Resume from step… is on the tab row with Ask the supervisor; no Watch (same conditions as before)', async () => {
  const { app, html } = await runScreen({ status: 'failed', past: true });
  assert.equal(hasIn(rowActions(app), byId('btn-run-sup')), true, 'Ask the supervisor on the tab row (its ⋮ menu)');
  assert.equal(hasIn(rowActions(app), byId('btn-run-resume')), true, 'Resume from step… on the tab row (its ⋮ menu)');
  assert.equal(hasIn(html, byId('btn-run-watch')), false, 'no Watch for a run that ended');
  assert.equal(hasIn(workflowPanel(html), byId('btn-run-resume')), false, 'Resume left the Workflow panel');
});

test('#410 a failed run: the tab row shows above the fail banner', async () => {
  const { html } = await runScreen({ status: 'failed', past: true });
  const row = tabRow(html);
  const banner = H.findEl(html, byId('run-fail-banner'));
  assert.ok(banner, 'the fail banner shows');
  assert.equal(banner.start > row.end, true);
});

// ---- the chain ---------------------------------------------------------------------------------

test('#410 a live run without a chain: "+ When it finishes…" is on the tab row, and no chain banner shows', async () => {
  const { html } = await runScreen({ status: 'running' });
  const row = tabRow(html);
  const link = H.findEl(row.outer, (e) => e.attrs['data-chain'] === 'edit');
  assert.ok(link, '[data-chain="edit"] is on the tab row');
  assert.match(H.visibleText(link.inner), /When it finishes/);
  assert.equal(hasIn(html, (e) => cls(e).includes('chain-banner-title')), false, 'no chain banner (no "Chain" title)');
});

test('#410 a live run with a chain: the chain banner shows below the tab row with Edit and Cancel chain', async () => {
  const chain = { then: { action: 'start', workflow: 'docs.yaml' }, state: 'waiting' };
  const { html } = await runScreen({ status: 'running', chain });
  const row = tabRow(html);
  const banner = H.findEl(html, (e) => cls(e).includes('chain-banner-title'));
  assert.ok(banner, 'the chain banner shows');
  assert.equal(banner.start > row.end, true, 'the banner is after the tab row');
  const box = H.findEl(html, byId('run-chain'));
  assert.ok(box, '#run-chain shows');
  assert.equal(hasIn(box.outer, (e) => e.attrs['data-chain'] === 'edit'), true, 'Edit in the banner');
  assert.equal(hasIn(box.outer, (e) => e.attrs['data-chain'] === 'clear'), true, 'Cancel chain in the banner');
});

// ---- #412 Stop and Pause on the tab row ---------------------------------------------------------

test('#412 a live run of this window: "Pause after current step" and "Stop" are on the tab row', async () => {
  const { html } = await runScreen({ status: 'running' });
  const row = tabRow(html);
  assert.equal(hasIn(row.outer, buttonText('Stop')), true, 'Stop on the tab row');
  assert.equal(hasIn(row.outer, buttonText('Pause after current step')), true, 'Pause after current step on the tab row');
  assert.equal(H.findEl(row.outer, buttonText('Stop'))?.attrs['data-testid'], 'run-stop');
  assert.equal(H.findEl(row.outer, buttonText('Pause after current step'))?.attrs['data-testid'], 'run-pause');
});

test('#412 a past (finished) run: no Stop and no Pause on the tab row', async () => {
  const { html } = await runScreen({ status: 'success', past: true });
  const row = tabRow(html);
  assert.equal(hasIn(row.outer, buttonText('Stop')), false);
  assert.equal(hasIn(row.outer, buttonText('Pause after current step')), false);
});

test('#412 an interrupted run opened from disk (status still running, past view): no Stop and no Pause on the tab row', async () => {
  const { html } = await runScreen({ status: 'running', past: true });
  const row = tabRow(html);
  assert.equal(hasIn(row.outer, buttonText('Stop')), false);
  assert.equal(hasIn(row.outer, buttonText('Pause after current step')), false);
});

test('#410 a run that ended: no "+ When it finishes…" on the tab row', async () => {
  for (const status of ['success', 'failed']) {
    const { html } = await runScreen({ status, past: true });
    assert.equal(hasIn(tabRow(html).outer, (e) => e.attrs['data-chain'] === 'edit'), false, `none for a ${status} run`);
  }
});

test('#410 a live run with a chain set: no "+ When it finishes…" on the tab row (Edit is in the banner)', async () => {
  const chain = { then: { action: 'start', workflow: 'docs.yaml' }, state: 'waiting' };
  const { html } = await runScreen({ status: 'running', chain });
  assert.equal(hasIn(tabRow(html).outer, (e) => e.attrs['data-chain'] === 'edit'), false);
});

// ---- the details panel's tabs -------------------------------------------------------------------

test('#410 the details panel\'s tabs read Artifacts | Session | Events, in that order', () => {
  const app = loadApp();
  const markup = app.defs.get('run').markup;
  const panel = H.findEl(markup, (e) => cls(e).includes('detail-panel'));
  assert.ok(panel, 'the details panel is on the Run screen');
  const labels = H.findAll(panel.outer, (e) => cls(e).includes('tab') && 'data-tab' in e.attrs)
    .map((e) => H.visibleText(e.inner).replace(/\d+/g, '').trim());
  assert.deepEqual(labels, ['Artifacts', 'Session', 'Events']);
});

test('#410 a run opens on Artifacts: state.tab defaults to \'artifacts\' and the markup shows that tab', () => {
  const app = loadApp();
  assert.equal(app.state().tab, 'artifacts');
  const markup = app.defs.get('run').markup;
  const active = H.findAll(markup, (e) => 'data-tab' in e.attrs && cls(e).includes('active')).map((e) => e.attrs['data-tab']);
  assert.deepEqual(active, ['artifacts'], 'the Artifacts tab is the active one');
  assert.equal(staticHidden(H.findEl(markup, byId('tab-artifacts'))), false, 'its body shows');
  assert.equal(staticHidden(H.findEl(markup, byId('tab-detail'))), true, 'the Session body is hidden');
});

test('#410 switching to another run opens it on Artifacts; selecting the same run keeps the tab', async () => {
  const { app } = await runScreen({ status: 'running' });
  app.run("(() => { const v = newRunView(); v.run = { id: 'r2', status: 'success', startedAt: Date.now() - 60000, finishedAt: Date.now(), workflow: 'software-development', file: 'software-development.yaml', inputs: {} }; state.runs.set('r2', v); })()");
  app.run("state.tab = 'detail'");
  app.run("selectRun('r1', { open: false })");
  assert.equal(app.state().tab, 'detail', 'the same run keeps the Session tab');
  app.run("selectRun('r2', { open: false })");
  assert.equal(app.state().tab, 'artifacts', 'another run opens on Artifacts');
  await app.settle();
});

// this file's own reading of the screen (passes before and after the change): the run's actions render
test('harness: a live run\'s screen renders its actions (Ask the supervisor, Open in Analytics) somewhere on it', async () => {
  const { app } = await runScreen({ status: 'running' });
  assert.equal(hasIn(rowActions(app), byId('btn-run-sup')), true);
  assert.equal(hasIn(rowActions(app), byId('btn-run-analytics')), true);
});
