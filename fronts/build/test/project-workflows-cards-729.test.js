// #729: the project's page (Projects › Overview) shows only the workflows added to the project, as
// cards, and "+ Add a workflow" opens the list of the others. Acceptance tests, written before the
// code, on the real page (packages/ui-kit/test/renderer-app-harness.js), as
// renderer-projects-workflows-486.test.js drives it (openProjectView, the #project-workflows box that
// ProjectWorkflows.showPage(p, box) fills, the page's delegated click on #view-project).
//
// The contract assumed here:
// - one card per workflow of the project (project.workflows), in its order, in #project-workflows:
//   data-testid="pj-wf-card" data-workflow-id="<bare name>"; a card shows the workflow's name, its
//   category (the Workflows screen's section name, wfSectionName(wfSectionOf(category))), the variant
//   picked in the wizard (the entry's `variant`, read as OnboardingModel's label: feature
//   'remote-code' → "Remote PRs · code first") and its description (clamped by CSS);
// - the default's card (project.defaultWorkflow) holds data-testid="pj-wf-default-badge"; every other
//   card holds a button data-testid="pj-wf-make-default"; every card a button data-testid="pj-wf-remove";
//   both buttons carry data-workflow-id="<bare name>" themselves (the fake DOM's closest() sees only the
//   clicked element's own attributes, its parsed ancestors in this file's helper);
// - Make default saves api.updateProject(id, { defaultWorkflow }); Remove saves
//   api.updateProject(id, { workflows: the set without it (the others kept as they were, `variant`
//   included), defaultWorkflow }) (removing the default names another one or null, never the removed);
// - "+ Add a workflow": a button data-testid="pj-wf-add" at the end of the block, also with no
//   workflow; it opens a dialog data-testid="pj-wf-add-dialog" listing the installed workflows
//   (api.listWorkflows) not already on the project, one data-testid="pj-wf-add-option"
//   data-workflow-id="<bare name>" each, grouped by category with a one-line hint each (class "hint");
//   retired workflows (no file any more: software-development, software-development-local-hero, even
//   when the repository's manifest still names them) are never offered; a search field
//   data-testid="pj-wf-add-search" filters the options (by name; the list's markup drawn again, or the
//   others marked `hidden`); clicking an option saves api.updateProject(id, { workflows: the set plus
//   it, ... }) and its card appears;
// - with no workflow: data-testid="pj-wf-empty" says "No workflow yet: new roadmap items use the
//   Settings default" (i18n key projects.workflows_empty, en.json and pt-BR.json) and "+ Add a workflow"
//   is there;
// - Create Project's dialog (ProjectWorkflows.showDialog) is unchanged: the manifest's workflows checked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('@multiagent/ui-kit/test/page-pieces');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');
const { region } = require('@multiagent/front-analyser/test/project-page-helpers');

const INSTALLED = [
  { file: 'feature.yaml', name: 'feature', category: 'build', origin: 'bundled', description: 'Tests first: the test writer writes the acceptance tests from the issue before any code.', inputs: { task: {} } },
  { file: 'fix.yaml', name: 'fix', category: 'build', origin: 'bundled', description: 'Reproduces a bug, fixes it with its regression test.', inputs: { task: {} } },
  { file: 'release.yaml', name: 'Release', category: 'build', origin: 'bundled', description: 'Checks what merged since the last release, then Ship or Hold.', inputs: {} },
  { file: 'backlog-refresh.yaml', name: 'backlog-refresh', category: 'plan', origin: 'bundled', description: 'Reviews every open issue against the code as it is now.', inputs: {} },
  { file: 'retrospective.yaml', name: 'retrospective', category: 'monitor', origin: 'bundled', description: 'Looks back at the last runs.', inputs: {} },
  { file: 'my-flow.yaml', name: 'my-flow', category: 'build', origin: 'custom', description: 'A flow of my own.', inputs: { task: {} } },
];
const RETIRED = ['software-development', 'software-development-local-hero'];
// the repository's manifest still names a retired workflow
const OLD_MANIFEST = { workflows: [{ name: 'software-development', category: 'team', description: 'Pull requests' }, { name: 'software-development-local-hero', category: 'solo' }] };
const BASE = { id: 'p1', name: 'Project One', repo: 'https://github.com/o/one', folder: 'C:/work/one', exists: true, isGit: true };

const FEATURE = { name: 'feature', origin: 'bundled', category: 'build', variant: 'remote-code' };
const FIX = { name: 'fix', origin: 'bundled', category: 'build', variant: 'remote-e2e' };
const REFRESH = { name: 'backlog-refresh', origin: 'bundled', category: 'plan' };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (x) => JSON.parse(JSON.stringify(x));

// The project's page, Overview, of p1 = BASE + `project`
async function overviewOf(project, { manifest = null, lang = 'en' } = {}) {
  let record = { ...BASE, ...clone(project) };
  const app = loadApp({
    storage: { 'multiagent.currentProject': 'p1' },
    api: {
      listProjects: async () => [clone(record)],
      listWorkflows: async () => clone(INSTALLED),
      projectManifest: async () => clone(manifest),
      // the service's projects:update: the record with the patch applied
      updateProject: async (id, patch) => { record = { ...record, ...JSON.parse(JSON.stringify(patch)) }; return clone(record); },
      getSettings: async () => ({ lastProject: 'p1' }),
      listProjectRuns: async () => ({ runs: [], project: clone(record), local: null }),
      getBacklog: async () => ({ platform: 'github', syncedAt: '2026-10-01T00:00:00Z', issues: [], epics: [] }),
      getRepositoryPerformance: () => new Promise(() => {}),
      envDetails: async () => [],
      speechStatus: async () => ({ path: null, command: 'whisper', installHint: '', models: [], model: 'base', languages: ['en'], language: 'en' }),
    },
  });
  await app.boot();
  app.sandbox.confirm = () => true; // a Remove that asks first is answered yes
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
  app.run('openProjectView("p1")');
  await app.settle(30);
  return app;
}

// ---- reading the page --------------------------------------------------------------------------------

// The Workflows box's markup, wrapped in its own element (so a parsed button's ancestors reach #project-workflows)
const boxMarkup = (app) => `<div id="project-workflows">${String(app.el('#project-workflows').innerHTML || '')}</div>`;
// Every markup the page holds now, each element's wrapped in its own id (the dialog may live anywhere)
function pageScope(app) {
  const parts = [];
  for (const el of [...app.elements.values(), ...app.created]) {
    const html = String(el.innerHTML || '');
    if (html) parts.push(el.id ? `<div id="${el.id}">${html}</div>` : html);
    for (const [, ins] of el.inserted || []) parts.push(String(ins || ''));
  }
  return parts.join('\n');
}
const byTestId = (html, id) => H.findAll(html, (e) => e.attrs['data-testid'] === id);
const cards = (app) => byTestId(boxMarkup(app), 'pj-wf-card');
const cardIds = (app) => cards(app).map((c) => String(c.attrs['data-workflow-id'] ?? ''));
const cardOf = (app, id) => cards(app).find((c) => c.attrs['data-workflow-id'] === id) || null;
const textOf = (el) => (el ? H.visibleText(el.inner) : '');
const has = (el, testid) => !!el && H.findEl(el.outer, (e) => e.attrs['data-testid'] === testid) !== null;
const buttonIn = (el, testid) => (el ? H.findEl(el.outer, (e) => e.attrs['data-testid'] === testid) : null);

// The Add dialog's options now listed (not hidden), by workflow id, deduplicated, in their order
function options(app) {
  const seen = [];
  for (const o of byTestId(pageScope(app), 'pj-wf-add-option')) {
    if ('hidden' in o.attrs) continue;
    let hiddenParent = false;
    for (let n = o.parent; n; n = n.parent) if ('hidden' in n.attrs) hiddenParent = true;
    const id = String(o.attrs['data-workflow-id'] ?? '');
    if (!hiddenParent && !seen.includes(id)) seen.push(id);
  }
  return seen;
}
const dialogMarkup = (app) => byTestId(pageScope(app), 'pj-wf-add-dialog').map((d) => d.outer).join('\n') + region(app, 'pj-wf-add-dialog');

// ---- acting on the page ------------------------------------------------------------------------------

let seq = 0;
// Fires `type` on a parsed element: a live fake target carrying its attributes (its own `#id` element
// when it has one, with a closest() that walks its parsed ancestors), then every element holding its
// markup, the project page's section and the document
async function fire(app, el, type, { value } = {}) {
  assert.ok(el, `an element to ${type}`);
  const sel = el.attrs.id ? `#${el.attrs.id}` : `[data-test-729-${(seq += 1)}]`;
  const target = app.el(sel);
  for (const [k, v] of Object.entries(el.attrs)) {
    if (k.startsWith('data-')) target.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    else if (k === 'class') target.className = v;
    else if (k !== 'id') target.attrs[k] = v;
  }
  target.tagName = el.name.toUpperCase();
  target.textContent = H.visibleText(el.inner);
  if (value !== undefined) target.value = value;
  target.closest = (s) => { for (let n = el; n; n = n.parent) if (H.matches(n, s)) return n === el ? target : H.fakeEl(n); return null; };
  target.matches = (s) => H.matches(el, s);
  const holders = [...app.elements.values(), ...app.created].filter((f) => f !== target
    && (String(f.innerHTML || '').includes(el.outer) || (f.inserted || []).some(([, h]) => String(h).includes(el.outer))));
  const chain = [...new Set([target, ...holders, app.el('#view-project')])];
  const ev = {
    type, target, currentTarget: target, key: '', button: 0, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = true; },
  };
  for (const node of chain) {
    if (ev.stopped) break;
    ev.currentTarget = node;
    await node[`on${type}`]?.(ev);
    for (const fn of node.listeners[type] || []) await fn(ev);
  }
  if (!ev.stopped) app.sandbox.document.dispatchEvent(ev);
  await app.settle(30);
}

async function openAdd(app) {
  const add = byTestId(boxMarkup(app), 'pj-wf-add')[0] || byTestId(pageScope(app), 'pj-wf-add')[0];
  assert.ok(add, 'the block has data-testid="pj-wf-add"');
  await fire(app, add, 'click');
}

const onlyPatch = (app) => {
  const calls = app.callsTo('updateProject');
  assert.equal(calls.length, 1, `one api.updateProject call (${calls.length})`);
  assert.equal(String(calls[0][0]), 'p1', 'on the project');
  return calls[0][1];
};
// Array.from: the page's arrays come from its own realm
const names = (list) => Array.from(list || [], (w) => String(w?.name ?? w));

// ---- the cards ---------------------------------------------------------------------------------------

test('#729 Overview: one card per workflow of the project, and none for the installed ones not added', { timeout: 20000 }, async () => {
  const app = await overviewOf({ workflows: [FEATURE, REFRESH], defaultWorkflow: 'feature' });
  assert.equal(H.visibleText(boxMarkup(app)).includes('backlog-refresh'), true, 'the Workflows block is drawn in #project-workflows');
  assert.deepEqual(cardIds(app), ['feature', 'backlog-refresh'], 'two cards data-testid="pj-wf-card", in the project\'s order');
  const block = H.visibleText(H.dropWhere(boxMarkup(app), (e) => e.attrs['data-testid'] === 'pj-wf-add-dialog'));
  for (const absent of ['my-flow', 'retrospective']) assert.equal(block.includes(absent), false, `${absent} (not on the project) is not in the block: ${block}`);
  const boxes = H.findAll(boxMarkup(app), (e) => e.name === 'input' && e.attrs.type === 'checkbox').length;
  assert.equal(boxes, 0, 'no checkbox rows any more');
});

test('#729 Overview: the default workflow\'s card has the Default badge, the others do not', { timeout: 20000 }, async () => {
  const app = await overviewOf({ workflows: [FEATURE, REFRESH], defaultWorkflow: 'feature' });
  assert.equal(has(cardOf(app, 'feature'), 'pj-wf-default-badge'), true, 'feature (the default) has data-testid="pj-wf-default-badge"');
  assert.equal(has(cardOf(app, 'backlog-refresh'), 'pj-wf-default-badge'), false, 'backlog-refresh has no badge');
  assert.match(textOf(buttonIn(cardOf(app, 'feature'), 'pj-wf-default-badge')), /default/i);
  assert.equal(has(cardOf(app, 'feature'), 'pj-wf-make-default'), false, 'the default has no Make default');
  assert.equal(has(cardOf(app, 'backlog-refresh'), 'pj-wf-make-default'), true, 'backlog-refresh has Make default');
  assert.equal(has(cardOf(app, 'feature'), 'pj-wf-remove') && has(cardOf(app, 'backlog-refresh'), 'pj-wf-remove'), true, 'each card has Remove');
});

test('#729 Overview: a card shows its name, its category, the variant picked and its description', { timeout: 20000 }, async () => {
  const app = await overviewOf({ workflows: [FEATURE, REFRESH], defaultWorkflow: 'feature' });
  const feature = textOf(cardOf(app, 'feature'));
  const refresh = textOf(cardOf(app, 'backlog-refresh'));
  const build = String(app.run('wfSectionName(wfSectionOf("build"))'));
  const plan = String(app.run('wfSectionName(wfSectionOf("plan"))'));
  assert.equal(/feature/i.test(feature), true, `the feature card's name: ${feature}`);
  assert.equal(feature.includes(build), true, `the feature card's category "${build}": ${feature}`);
  assert.equal(feature.includes('Remote PRs · code first'), true, `the feature card's variant: ${feature}`);
  assert.equal(refresh.includes('backlog-refresh'), true, `the backlog-refresh card's name: ${refresh}`);
  assert.equal(refresh.includes(plan), true, `the backlog-refresh card's category "${plan}": ${refresh}`);
  const outer = cardOf(app, 'backlog-refresh').outer;
  assert.equal(outer.includes('Reviews every open issue against the code'), true, 'the backlog-refresh card has its description');
});

test('#729 Overview: Make default saves the defaultWorkflow and the badge moves', { timeout: 20000 }, async () => {
  const app = await overviewOf({ workflows: [FEATURE, REFRESH], defaultWorkflow: 'feature' });
  const btn = buttonIn(cardOf(app, 'backlog-refresh'), 'pj-wf-make-default');
  assert.ok(btn, 'backlog-refresh has data-testid="pj-wf-make-default"');
  assert.match(textOf(btn), /make default/i);
  await fire(app, btn, 'click');
  const patch = onlyPatch(app);
  assert.equal(String(patch.defaultWorkflow), 'backlog-refresh');
  if (patch.workflows !== undefined) assert.deepEqual(names(patch.workflows), ['feature', 'backlog-refresh'], 'the set unchanged');
  assert.equal(has(cardOf(app, 'backlog-refresh'), 'pj-wf-default-badge'), true, 'the badge is on backlog-refresh now');
  assert.equal(has(cardOf(app, 'feature'), 'pj-wf-default-badge'), false, 'and no longer on feature');
});

test('#729 Overview: Remove saves the set without it, the others kept as they were, and its card goes', { timeout: 20000 }, async () => {
  const app = await overviewOf({ workflows: [FEATURE, REFRESH], defaultWorkflow: 'feature' });
  const btn = buttonIn(cardOf(app, 'backlog-refresh'), 'pj-wf-remove');
  assert.ok(btn, 'backlog-refresh has data-testid="pj-wf-remove"');
  await fire(app, btn, 'click');
  const patch = onlyPatch(app);
  assert.deepEqual(names(patch.workflows), ['feature']);
  assert.equal(String(Array.from(patch.workflows)[0].variant), 'remote-code', 'feature keeps its variant');
  if ('defaultWorkflow' in patch) assert.equal(String(patch.defaultWorkflow), 'feature', 'the default stays');
  assert.deepEqual(cardIds(app), ['feature'], 'one card left');
});

test('#729 Overview: removing the default saves a default that is not the removed workflow', { timeout: 20000 }, async () => {
  const app = await overviewOf({ workflows: [FEATURE, FIX], defaultWorkflow: 'feature' });
  await fire(app, buttonIn(cardOf(app, 'feature'), 'pj-wf-remove'), 'click');
  const patch = onlyPatch(app);
  assert.deepEqual(names(patch.workflows), ['fix']);
  assert.equal('defaultWorkflow' in patch, true, 'the patch names the new default (or null)');
  assert.notEqual(patch.defaultWorkflow, 'feature', 'never the removed one');
});

// ---- + Add a workflow ----------------------------------------------------------------------------------

test('#729 Overview: "+ Add a workflow" is at the end of the cards', { timeout: 20000 }, async () => {
  const app = await overviewOf({ workflows: [FEATURE, REFRESH], defaultWorkflow: 'feature' });
  const html = boxMarkup(app);
  const add = byTestId(html, 'pj-wf-add')[0];
  assert.ok(add, 'data-testid="pj-wf-add" in the block');
  assert.match(textOf(add), /add a workflow/i);
  const lastCard = cards(app).at(-1);
  assert.equal(html.indexOf(add.outer) > html.indexOf(lastCard.outer), true, 'after the last card');
});

test('#729 Add a workflow: the dialog lists the installed workflows not on the project, never a retired one', { timeout: 20000 }, async () => {
  const app = await overviewOf({ workflows: [FEATURE, FIX], defaultWorkflow: 'feature' }, { manifest: OLD_MANIFEST });
  assert.deepEqual(options(app), [], 'no option before the click');
  await openAdd(app);
  assert.equal(byTestId(pageScope(app), 'pj-wf-add-dialog').length >= 1, true, 'data-testid="pj-wf-add-dialog"');
  const listed = options(app);
  assert.deepEqual([...listed].sort(), ['backlog-refresh', 'my-flow', 'release', 'retrospective'], `the options: ${listed.join(', ')}`);
  for (const old of RETIRED) assert.equal(listed.includes(old), false, `${old} (retired) is not offered`);
});

test('#729 Add a workflow: the options are grouped by category, each with its hint', { timeout: 20000 }, async () => {
  const app = await overviewOf({ workflows: [FEATURE, FIX], defaultWorkflow: 'feature' });
  await openAdd(app);
  const html = dialogMarkup(app);
  const hints = H.findAll(html, (e) => /\bhint\b/.test(String(e.attrs.class || '')) && H.visibleText(e.inner));
  // release and my-flow: build; backlog-refresh: plan; retrospective: monitor
  const sections = new Set(['build', 'plan', 'monitor'].map((c) => String(app.run(`wfSectionName(wfSectionOf("${c}"))`))));
  assert.equal(new Set(hints.map((h) => H.visibleText(h.inner))).size >= 3, true, `a hint per category (${hints.length})`);
  const text = H.visibleText(html);
  for (const s of sections) assert.equal(text.includes(s), true, `the "${s}" group is named`);
});

test('#729 Add a workflow: the search filters the options', { timeout: 20000 }, async () => {
  const app = await overviewOf({ workflows: [FEATURE, FIX], defaultWorkflow: 'feature' });
  await openAdd(app);
  const search = byTestId(pageScope(app), 'pj-wf-add-search')[0];
  assert.ok(search, 'data-testid="pj-wf-add-search"');
  await fire(app, search, 'input', { value: 'retro' });
  await wait(400); // past a debounce
  await app.settle(20);
  assert.deepEqual(options(app), ['retrospective']);
});

test('#729 Add a workflow: picking one saves the set with it and shows its card', { timeout: 20000 }, async () => {
  const app = await overviewOf({ workflows: [FEATURE, FIX], defaultWorkflow: 'feature' });
  await openAdd(app);
  const opt = byTestId(pageScope(app), 'pj-wf-add-option').find((o) => o.attrs['data-workflow-id'] === 'backlog-refresh');
  assert.ok(opt, 'a backlog-refresh option');
  await fire(app, opt, 'click');
  const patch = onlyPatch(app);
  assert.deepEqual(names(patch.workflows), ['feature', 'fix', 'backlog-refresh'], 'the set plus the picked one, at the end');
  const added = Array.from(patch.workflows).at(-1);
  assert.equal(String(added.category), 'plan', 'with its category');
  assert.equal(String(added.origin), 'bundled', 'and its origin');
  assert.equal(String(Array.from(patch.workflows)[0].variant), 'remote-code', 'the others kept as they were');
  if ('defaultWorkflow' in patch) assert.equal(String(patch.defaultWorkflow), 'feature', 'the default stays');
  assert.deepEqual(cardIds(app), ['feature', 'fix', 'backlog-refresh'], 'its card is shown');
});

// ---- after the review of #729: Undo, closing the dialog, the search's caret, the CI pick ----------------

// The toasts shown, with their action ({ label, run }) when they have one
function captureToasts(app) {
  const toasts = [];
  app.sandbox.showToast = (title, detail, _runId, _gate, opts) => { toasts.push({ title: String(title ?? ''), action: opts?.action || null }); };
  return toasts;
}

// The selectors focused from now on (the fake DOM's focus() does nothing: each queried element records it)
function captureFocus(app) {
  const focused = [];
  const doc = app.sandbox.document;
  const query = doc.querySelector.bind(doc);
  doc.querySelector = (sel) => {
    const el = query(sel);
    if (el && !el.__focus729) { el.__focus729 = true; el.focus = () => { focused.push(String(sel)); }; }
    return el;
  };
  return focused;
}

const dialogOpen = (app) => byTestId(pageScope(app), 'pj-wf-add-dialog').length > 0;

test('#729 Remove: the toast\'s Undo puts the set (variants included) and the default back', { timeout: 20000 }, async () => {
  const app = await overviewOf({ workflows: [FEATURE, FIX], defaultWorkflow: 'feature' });
  const toasts = captureToasts(app);
  await fire(app, buttonIn(cardOf(app, 'feature'), 'pj-wf-remove'), 'click');
  assert.deepEqual(cardIds(app), ['fix'], 'removed');
  const undo = toasts.find((x) => x.action && typeof x.action.run === 'function');
  assert.ok(undo, `a toast with an action (${toasts.map((x) => x.title).join(' | ')})`);
  assert.match(String(undo.action.label), /undo/i);
  await undo.action.run();
  await app.settle(30);
  const calls = app.callsTo('updateProject');
  assert.equal(calls.length, 2, 'the remove, then the undo');
  const back = calls[1][1];
  assert.deepEqual(names(back.workflows), ['feature', 'fix'], 'the set as it was, in its order');
  assert.equal(String(Array.from(back.workflows)[0].variant), 'remote-code', 'feature\'s variant back');
  assert.equal(String(back.defaultWorkflow), 'feature', 'the default back');
  assert.deepEqual(cardIds(app), ['feature', 'fix'], 'both cards again');
  assert.equal(has(cardOf(app, 'feature'), 'pj-wf-default-badge'), true, 'feature badged Default again');
});

test('#729 Add a workflow: Escape closes the dialog without saving and gives the focus back to "+ Add a workflow"', { timeout: 20000 }, async () => {
  const app = await overviewOf({ workflows: [FEATURE], defaultWorkflow: 'feature' });
  await openAdd(app);
  assert.equal(dialogOpen(app), true, 'the dialog is open');
  const focused = captureFocus(app);
  const dialog = byTestId(pageScope(app), 'pj-wf-add-dialog')[0];
  const target = app.el(dialog.attrs.id ? `#${dialog.attrs.id}` : '[data-testid="pj-wf-add-dialog"]');
  const ev = { type: 'keydown', key: 'Escape', target, currentTarget: target, preventDefault() {}, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = true; } };
  for (const node of [target, app.el('#project-workflows'), app.el('#view-project')]) {
    if (ev.stopped) break;
    ev.currentTarget = node;
    await node.onkeydown?.(ev);
    for (const fn of node.listeners.keydown || []) await fn(ev);
  }
  if (!ev.stopped) app.sandbox.document.dispatchEvent(ev);
  await app.settle(30);
  assert.equal(dialogOpen(app), false, 'the dialog is closed');
  assert.equal(app.callsTo('updateProject').length, 0, 'nothing saved');
  assert.equal(focused.some((s) => /pj-wf-add(?![-\w])/.test(s)), true, `"+ Add a workflow" has the focus again (${focused.join(', ')})`);
});

test('#729 Add a workflow: a click on the backdrop closes the dialog, a click inside it does not', { timeout: 20000 }, async () => {
  const app = await overviewOf({ workflows: [FEATURE], defaultWorkflow: 'feature' });
  await openAdd(app);
  const html = pageScope(app);
  const dialog = byTestId(html, 'pj-wf-add-dialog')[0];
  const title = H.findEl(dialog.outer, (e) => /^h\d$/.test(e.name));
  assert.ok(title, 'the dialog has a title');
  await fire(app, title, 'click');
  assert.equal(dialogOpen(app), true, 'a click on the dialog\'s title keeps it open');
  const backdrop = byTestId(pageScope(app), 'pj-wf-add-dialog')[0].parent;
  assert.ok(backdrop, 'the dialog sits on a backdrop');
  assert.notEqual(backdrop.attrs.id, 'project-workflows', 'a backdrop of its own, not the block');
  await fire(app, backdrop, 'click');
  assert.equal(dialogOpen(app), false, 'a click on the backdrop closes it');
  assert.equal(app.callsTo('updateProject').length, 0, 'nothing saved');
});

test('#729 Add a workflow: the search keeps its caret where it was across the list\'s redraw', { timeout: 20000 }, async () => {
  const app = await overviewOf({ workflows: [FEATURE], defaultWorkflow: 'feature' });
  await openAdd(app);
  const search = byTestId(pageScope(app), 'pj-wf-add-search')[0];
  assert.ok(search?.attrs.id, 'the search field has an id (it is found again after the redraw)');
  const live = app.el(`#${search.attrs.id}`);
  const ranges = [];
  live.setSelectionRange = (a, b) => { ranges.push([a, b]); };
  live.selectionStart = 2; // the owner typed "retro" then moved the caret after "re"
  live.selectionEnd = 2;
  await fire(app, search, 'input', { value: 'retro' });
  await wait(400);
  await app.settle(20);
  assert.deepEqual(options(app), ['retrospective'], 'the list was drawn again, filtered');
  assert.equal(ranges.length > 0, true, 'the caret is put back');
  assert.deepEqual(ranges.at(-1), [2, 2], 'where the owner left it, not at the end');
});

test('#729 Overview: the release card shows its CI pick by its label', { timeout: 20000 }, async () => {
  const RELEASE = { name: 'release', origin: 'bundled', category: 'build', variant: 'train', ci: 'pr+release' };
  const app = await overviewOf({ workflows: [FEATURE, RELEASE], defaultWorkflow: 'feature' });
  const release = textOf(cardOf(app, 'release'));
  assert.equal(release.includes('CI: On pull requests and releases'), true, `the release card: ${release}`);
  assert.equal(textOf(cardOf(app, 'feature')).includes('CI:'), false, 'no CI line on a card without a CI pick');
});

// #726: the variant and CI labels are the model's i18n keys, shown in the interface language
test('#726 Overview: in pt-BR the cards show the variant and the CI pick in Portuguese, never English nor a raw key', { timeout: 20000 }, async () => {
  const RELEASE = { name: 'release', origin: 'bundled', category: 'build', variant: 'train', ci: 'pr+release' };
  const app = await overviewOf({ workflows: [FEATURE, RELEASE], defaultWorkflow: 'feature' }, { lang: 'pt-BR' });
  const feature = textOf(cardOf(app, 'feature'));
  const release = textOf(cardOf(app, 'release'));
  assert.equal(feature.includes('PRs remotos · código primeiro'), true, `the feature card's variant in pt-BR: ${feature}`);
  assert.equal(release.includes('Em pull requests e releases'), true, `the release card's CI in pt-BR: ${release}`);
  const leaks = ['Remote PRs', 'Release train', 'On pull requests and releases', 'onboarding.'].filter((s) => (feature + release).includes(s));
  assert.deepEqual(leaks, [], `English or raw keys in the cards: ${feature} | ${release}`);
});

// ---- the empty state -----------------------------------------------------------------------------------

const I18N = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'i18n');
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(I18N, `${lang}.json`), 'utf8'));

test('#729 Overview: a project without workflows says so in one line and offers "+ Add a workflow"', { timeout: 20000 }, async () => {
  const app = await overviewOf({});
  assert.deepEqual(cardIds(app), [], 'no card');
  const empty = byTestId(boxMarkup(app), 'pj-wf-empty')[0];
  assert.ok(empty, 'data-testid="pj-wf-empty"');
  assert.equal(textOf(empty), 'No workflow yet: new roadmap items use the Settings default');
  assert.equal(byTestId(boxMarkup(app), 'pj-wf-add').length, 1, '"+ Add a workflow" is there');
  await openAdd(app);
  assert.deepEqual([...options(app)].sort(), ['backlog-refresh', 'feature', 'fix', 'my-flow', 'release', 'retrospective'], 'every installed workflow is offered');
});

test('#729 the empty state\'s line is translated: projects.workflows_empty in en.json and pt-BR.json', () => {
  const en = catalog('en')['projects.workflows_empty'];
  const pt = catalog('pt-BR')['projects.workflows_empty'];
  assert.equal(en, 'No workflow yet: new roadmap items use the Settings default');
  assert.equal(typeof pt === 'string' && pt.trim().length > 0, true, 'a pt-BR text');
  assert.notEqual(pt, en, 'translated');
});

// ---- Create Project keeps its block --------------------------------------------------------------------

test('#729 Create Project: the manifest\'s workflows still come in checked', { timeout: 20000 }, async () => {
  const MANIFEST = { workflows: [{ name: 'backlog-refresh', category: 'intake', description: 'Refresh the issues' }, { name: 'feature', category: 'build' }] };
  const app = loadApp({
    api: {
      listProjects: async () => [],
      listWorkflows: async () => clone(INSTALLED),
      projectManifest: async () => clone(MANIFEST),
      getSettings: async () => ({}),
    },
  });
  await app.boot();
  const box = app.el('#pj-workflows-729');
  await app.sandbox.ProjectWorkflows.showDialog(box, { folder: 'C:/work/new', url: 'https://github.com/o/new.git' });
  await app.settle(10);
  const checked = H.findAll(String(box.innerHTML), (e) => e.name === 'input' && e.attrs.type === 'checkbox' && 'checked' in e.attrs)
    .map((e) => String(e.attrs['data-workflow'] ?? e.attrs.value ?? '').replace(/\.ya?ml$/i, ''));
  assert.deepEqual([...new Set(checked)].sort(), ['backlog-refresh', 'feature']);
});
