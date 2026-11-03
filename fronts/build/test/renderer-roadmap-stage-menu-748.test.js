// #748: the roadmap stage's ⋮ menu opens and closes without redrawing the Backlog, draws through the
// shared menu (packages/ui-kit/menu.js) in aligned, grouped entries with no explanation lines, has
// renamed entries, no "Move on from this stage", and a last, dangerous "Remove from roadmap".
// Acceptance tests written before the code.
//
// Harness: fronts/build/views/backlog/backlog-roadmap.js runs whole in a vm sandbox (the same globals
// as test/roadmap-status-helpers.js loadRoadmap) on a small real DOM (packages/ui-kit/test/mini-dom.js),
// with packages/ui-kit/menu.js loaded before it when it exists. The page is wired the way backlog.js
// wires the Roadmap (backlog.js ~1486-1533): #bl-list's clicks go to BacklogRoadmap.onClick, the
// document's keydowns to BacklogRoadmap.onKeyDown, and a click outside #bl-list calls
// BacklogRoadmap.closeMenu() and redraws when it says a menu was open. ctx.render counts its calls and
// redraws #bl-list from BacklogRoadmap.html, as backlog.js's render does.
// Only the IPC boundary (window.api) and the app's dialogs (confirmDialog) are fakes.
//
// Assumed (chosen here):
// - the stage's ⋮ button keeps data-testid="roadmap-stage-menu"; its menu is a role="menu" element
//   in the page (next to the button or floating), drawn by Menu.menuHtml: class "ui-menu", entries
//   role="menuitem" each with one ".ui-menu-icon" slot, dividers role="separator", a refused entry
//   aria-disabled="true" with its reason in its title only, the danger entry class "ui-menu-danger";
// - the groups, in order: [Enable|Disable · Run this stage] | [Stop when finished · Stop now] |
//   [Release after this stage] | [Move up · Move down] | [Add note|Edit note] | [Remove from roadmap];
// - Remove from roadmap is refused with RoadmapModel.allowedActions(r, stage).removeStage.reason;
//   picked, it asks confirmDialog(title, message, yes) naming "stage N" and "<count> items", then
//   saves through api.saveRoadmap(projectId, stages, label, updatedAt) without the stage, its items
//   and its cut line, with a history label naming the stage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');
const { createDom, textOf } = require('@multiagent/ui-kit/test/mini-dom');
const H = require('./roadmap-status-helpers');

const view = { showAll: true, since: 'total' };
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

function loadPage(data, { confirm = true } = {}) {
  const rl = H.loadRunList({ now: H.NOW });
  const calls = { render: 0, confirm: [], save: [], archive: 0, clear: 0, item: 0, errors: [] };
  const sandbox = {
    console,
    esc: H.esc,
    state: { runs: new Map(), runMeta: new Map() },
    errMsg: (e) => String(e?.message || e),
    devMode: () => false,
    confirmDialog: async (...a) => { calls.confirm.push(a.map((x) => String(x ?? '')).join(' ‖ ')); return confirm; },
    keptWorkDialog: async () => null,
    choiceDialog: async () => null,
    fmtDur: (ms) => (ms == null ? 'unknown' : `${Math.round(ms / 1000)}s`),
    robotAvatar: (...a) => rl.robotAvatar(...a),
    displayName: H.displayName,
    agentLabel: H.agentLabel,
    PERSON_SVG: rl.PERSON,
    ENGINE_SVG: rl.ENGINE,
    progressChip: (...a) => rl.progressChip(...a),
    ChainModel: { chainBadgesHtml: () => '' },
    scheduleRender: () => {},
    markdownHtml: (s) => H.esc(s),
    placePopover: () => {},
    requestAnimationFrame: (f) => setTimeout(f, 0),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    api: {
      listWorkflows: async () => [],
      saveRoadmap: async (projectId, stages, label) => {
        // Arrays copied into this realm: `stages` comes from the vm sandbox, and
        // deepEqual also compares the Array prototype.
        const list = Array.from(stages);
        calls.save.push({
          projectId: String(projectId),
          stages: Array.from(list.filter((s) => s.kind !== 'release'), (s) => String(s.id)),
          releases: Array.from(list.filter((s) => s.kind === 'release'), (s) => String(s.id)),
          items: Array.from(list.flatMap((s) => Array.from(s.items || [])), (x) => String(x.id)),
          label: label == null ? null : String(label),
        });
        return { roadmap: { state: 'planned', stages }, issues: [] };
      },
      startRoadmap: async () => ({ roadmap: { state: 'running', stages: [] } }),
      roadmapItem: async () => { calls.item += 1; return { roadmap: { state: 'planned', stages: [] } }; },
      setRoadmapLive: async () => ({ roadmap: { state: 'running', stages: [] } }),
      archiveIssues: async () => { calls.archive += 1; return {}; },
      clearRoadmap: async () => { calls.clear += 1; return {}; },
      pauseRoadmap: async () => ({ roadmap: { state: 'paused', stages: [] }, issues: [] }),
    },
  };
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.setInterval = () => 0;
  sandbox.clearInterval = () => {};
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  sandbox.showRun = () => {};
  vm.createContext(withI18n(sandbox));
  H.installClock(sandbox, H.NOW);
  H.evalStatusPill(sandbox);
  vm.runInContext(H.read('..', '..', '..', 'packages', 'shared', 'run-progress-model.js'), sandbox);
  vm.runInContext(H.read('..', '..', '..', 'packages', 'shared', 'default-workflow.js'), sandbox);
  vm.runInContext(H.read('..', '..', '..', 'packages', 'shared', 'roadmap-model.js'), sandbox);
  vm.runInContext(H.read('workflow-inputs.js'), sandbox);
  if (H.exists('estimates.js')) vm.runInContext(H.read('estimates.js'), sandbox);
  if (H.exists('menu.js')) vm.runInContext(H.read('menu.js'), sandbox, { filename: 'menu.js' });
  vm.runInContext(H.read('views', 'backlog', 'backlog-roadmap.js'), sandbox);
  const R = sandbox.BacklogRoadmap;
  const doc = dom.document;
  const ctx = {
    projectId: 'p1',
    setData: (d) => { if (d?.roadmap) data.roadmap = d.roadmap; },
    setError: (e) => calls.errors.push(String(e)),
    setShowAll() {},
    setSince() {},
    render: () => { calls.render += 1; doc.querySelector('#bl-list').innerHTML = R.html(data, () => {}, view); },
  };
  doc.body.innerHTML = `<div id="elsewhere-box"><button type="button" id="elsewhere">elsewhere</button></div><div id="bl-list">${R.html(data, () => {}, view)}</div>`;
  // backlog.js's wiring of the Roadmap
  let pending = Promise.resolve();
  doc.querySelector('#bl-list').addEventListener('click', (e) => { pending = R.onClick(e, ctx, data); });
  doc.addEventListener('keydown', (e) => R.onKeyDown(e, ctx));
  doc.addEventListener('click', (e) => { if (e.target.isConnected && !e.target.closest('#bl-list') && R.closeMenu()) ctx.render(); });
  const done = async () => { await pending; await settle(); };
  return { R, sandbox, doc, dom, ctx, calls, data, done };
}

const it = (id, status, n, extra = {}) => H.item(id, status, n, `Issue ${n}`, { origin: H.iso(H.NOW - H.HOUR), runId: status === 'planned' ? null : `run-${id}`, runs: [], error: null, ...extra });
const stage = (id, items, extra = {}) => ({ id, name: '', note: '', items, ...extra });
const roadmap = (state, stages) => ({ roadmap: { state, stages, updatedAt: null }, issues: [] });

const hiddenEl = (el) => { for (let e = el; e && e.getAttribute; e = e.parentNode) if (e.hidden || e.hasAttribute('hidden') || e.classList.contains('hidden') || e.style?.display === 'none') return true; return false; };
const openMenus = (doc) => [...doc.querySelectorAll('[role="menu"]')].filter((m) => m.isConnected && !hiddenEl(m));
const stageButton = (doc, s) => doc.querySelector(`#bl-list [data-testid="roadmap-stage"][data-stage="${s}"] [data-testid="roadmap-stage-menu"]`);
const labelOf = (el) => textOf(el.querySelector('.ui-menu-label') || el).replace(/^[^\p{L}]+/u, '').trim();
const rows = (menu) => [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((el) => (el.getAttribute('role') === 'separator' ? '|' : labelOf(el)));
const entryNamed = (menu, label) => [...menu.querySelectorAll('[role="menuitem"]')].find((el) => labelOf(el) === label) || null;

async function openStageMenu(page, s) {
  stageButton(page.doc, s).click();
  await page.done();
  const menus = openMenus(page.doc);
  assert.equal(menus.length, 1, 'one menu open');
  return menus[0];
}

const three = (middle, state = 'planned') => roadmap(state, [
  stage('st1', [it('a', 'done', 1)]),
  middle,
  stage('st3', [it('z', 'planned', 9)]),
]);

// ---------- opening and closing: no full redraw ----------

test('#748 a click on a stage\'s ⋮ opens its menu without redrawing the Backlog (ctx.render not called); its first entry has the focus', async () => {
  const page = loadPage(three(stage('st2', [it('b', 'planned', 2)])));
  const menu = await openStageMenu(page, 1);
  assert.equal(page.calls.render, 0);
  assert.equal(stageButton(page.doc, 1).getAttribute('aria-expanded'), 'true');
  assert.equal(menu.contains(page.doc.activeElement), true, 'the focus is in the menu');
  assert.equal(page.doc.activeElement.getAttribute('role'), 'menuitem');
});

test('#748 Escape closes the stage menu without redrawing, the focus back on its ⋮', async () => {
  const page = loadPage(three(stage('st2', [it('b', 'planned', 2)])));
  await openStageMenu(page, 1);
  page.dom.keydown(page.doc.activeElement, 'Escape');
  await page.done();
  assert.equal(openMenus(page.doc).length, 0);
  assert.equal(page.calls.render, 0);
  assert.equal(page.doc.activeElement.getAttribute('data-testid'), 'roadmap-stage-menu');
  assert.equal(page.doc.activeElement.getAttribute('aria-expanded'), 'false');
});

test('#748 a second click on the same ⋮ closes the menu without redrawing', async () => {
  const page = loadPage(three(stage('st2', [it('b', 'planned', 2)])));
  await openStageMenu(page, 1);
  stageButton(page.doc, 1).click();
  await page.done();
  assert.equal(openMenus(page.doc).length, 0);
  assert.equal(page.calls.render, 0);
});

test('#748 a click outside the page\'s list closes the stage menu without redrawing', async () => {
  const page = loadPage(three(stage('st2', [it('b', 'planned', 2)])));
  await openStageMenu(page, 1);
  const out = page.doc.querySelector('#elsewhere');
  out.dispatchEvent(new page.dom.classes.MouseEvent('mousedown', { bubbles: true }));
  out.click();
  await page.done();
  assert.equal(openMenus(page.doc).length, 0);
  assert.equal(page.calls.render, 0);
});

test('#748 a click elsewhere on the roadmap (a stage\'s name) closes the stage menu without redrawing', async () => {
  const page = loadPage(three(stage('st2', [it('b', 'planned', 2)])));
  await openStageMenu(page, 1);
  const name = page.doc.querySelector('#bl-list [data-testid="roadmap-stage"][data-stage="0"] [data-rm-name]');
  name.dispatchEvent(new page.dom.classes.MouseEvent('mousedown', { bubbles: true }));
  name.click();
  await page.done();
  assert.equal(openMenus(page.doc).length, 0);
  assert.equal(page.calls.render, 0);
});

// ---------- the entries: shared menu, groups, labels ----------

test('#748 the stage menu is the shared menu: class ui-menu, every entry with its icon slot', async () => {
  const page = loadPage(three(stage('st2', [it('b', 'planned', 2)])));
  const menu = await openStageMenu(page, 1);
  assert.equal(menu.classList.contains('ui-menu'), true);
  const entries = [...menu.querySelectorAll('[role="menuitem"]')];
  assert.ok(entries.length >= 8);
  assert.deepEqual(entries.map((el) => el.querySelectorAll('.ui-menu-icon').length), entries.map(() => 1));
});

test('#748 a disabled stage\'s menu: its groups in order, with dividers between them (English)', async () => {
  const page = loadPage(three(stage('st2', [it('b', 'planned', 2)], { disabled: true })));
  const menu = await openStageMenu(page, 1);
  assert.deepEqual(rows(menu), [
    'Enable', 'Run this stage', '|', 'Stop when finished', 'Stop now', '|', 'Release after this stage', '|',
    'Move up', 'Move down', '|', 'Add note', '|', 'Remove from roadmap',
  ]);
});

test('#748 a running stage\'s menu (with a note): Disable and Edit note in the same groups (English)', async () => {
  const page = loadPage(three(stage('st2', [it('b', 'running', 2), it('c', 'planned', 3)], { note: 'Why here' }), 'running'));
  const menu = await openStageMenu(page, 1);
  assert.deepEqual(rows(menu), [
    'Disable', 'Run this stage', '|', 'Stop when finished', 'Stop now', '|', 'Release after this stage', '|',
    'Move up', 'Move down', '|', 'Edit note', '|', 'Remove from roadmap',
  ]);
});

test('#748 a disabled stage\'s menu in Brazilian Portuguese', async (t) => {
  t.after(() => I18nOf().setLanguage('en'));
  I18nOf().setLanguage('pt-BR');
  const page = loadPage(three(stage('st2', [it('b', 'planned', 2)], { disabled: true })));
  const menu = await openStageMenu(page, 1);
  assert.deepEqual(rows(menu), [
    'Ativar', 'Executar esta etapa', '|', 'Parar após finalizar', 'Parar agora', '|', 'Release após esse stage', '|',
    'Mover para cima', 'Mover para baixo', '|', 'Adicionar nota', '|', 'Remover do roadmap',
  ]);
});

test('#748 a running stage\'s menu in Brazilian Portuguese: Desativar, Editar nota', async (t) => {
  t.after(() => I18nOf().setLanguage('en'));
  I18nOf().setLanguage('pt-BR');
  const page = loadPage(three(stage('st2', [it('b', 'running', 2)], { note: 'Por quê' }), 'running'));
  const menu = await openStageMenu(page, 1);
  const labels = rows(menu);
  assert.equal(labels[0], 'Desativar');
  assert.equal(labels.includes('Editar nota'), true);
});

test('#748 a finished stage (no Stop group): no divider first, last or twice in a row', async () => {
  const page = loadPage(three(stage('st2', [it('b', 'done', 2)])));
  const menu = await openStageMenu(page, 1);
  const labels = rows(menu);
  assert.equal(labels.includes('Stop when finished'), false);
  assert.notEqual(labels[0], '|');
  assert.notEqual(labels.at(-1), '|');
  assert.equal(labels.join(',').includes('|,|'), false, labels.join(','));
  assert.equal(labels.at(-1), 'Remove from roadmap');
});

test('#748 no explanation lines: a refused entry is aria-disabled, its reason only in its title', async () => {
  const page = loadPage(three(stage('st2', [it('b', 'running', 2)]), 'running'));
  const menu = await openStageMenu(page, 1);
  assert.equal(page.doc.querySelectorAll('.bl-menu-why').length, 0);
  const run = entryNamed(menu, 'Run this stage');
  assert.equal(run.getAttribute('aria-disabled'), 'true');
  const why = run.getAttribute('title');
  assert.equal(why, 'The roadmap is running: pause or stop it first');
  assert.equal(textOf(menu).includes(why), false, 'the reason is not written in the menu');
});

test('#748 "Move on from this stage" is gone from the stage menu, even with an item waiting at a gate', async (t) => {
  const d = () => three(stage('st2', [it('b', 'running', 2, { waiting: true, gate: 'review' }), it('c', 'planned', 3)]), 'running');
  const en = rows(await openStageMenu(loadPage(d()), 1));
  assert.equal(en.some((l) => /Move on/i.test(l)), false, en.join(', '));
  t.after(() => I18nOf().setLanguage('en'));
  I18nOf().setLanguage('pt-BR');
  const pt = rows(await openStageMenu(loadPage(d()), 1));
  assert.equal(pt.some((l) => /Seguir adiante/i.test(l)), false, pt.join(', '));
});

// ---------- Remove from roadmap ----------

const removable = () => roadmap('planned', [
  stage('st1', [it('a', 'done', 1)]),
  stage('st2', [it('b', 'planned', 2), it('c', 'planned', 3), it('d', 'failed', 4)]),
  { kind: 'release', id: 'rel-1', name: 'v1', items: [] }, // the cut line after stage 2
  stage('st3', [it('e', 'planned', 5)]),
]);

test('#748 Remove from roadmap is the last entry, flagged as dangerous', async () => {
  const page = loadPage(removable());
  const menu = await openStageMenu(page, 1);
  const entries = [...menu.querySelectorAll('[role="menuitem"]')];
  assert.equal(labelOf(entries.at(-1)), 'Remove from roadmap');
  assert.equal(entries.at(-1).classList.contains('ui-menu-danger'), true);
  assert.equal(entries.filter((el) => el.classList.contains('ui-menu-danger')).length, 1);
});

test('#748 Remove from roadmap asks first, naming the stage and its item count; declined, nothing is saved', async () => {
  const page = loadPage(removable(), { confirm: false });
  const menu = await openStageMenu(page, 1);
  entryNamed(menu, 'Remove from roadmap').click();
  await page.done();
  assert.equal(page.calls.confirm.length, 1);
  assert.match(page.calls.confirm[0], /stage 2\b/i);
  assert.match(page.calls.confirm[0], /\b3 items\b/);
  assert.equal(page.calls.save.length, 0);
});

test('#748 Remove from roadmap confirmed: saves the roadmap without the stage, its items and its cut line, with a history label', async () => {
  const page = loadPage(removable());
  const menu = await openStageMenu(page, 1);
  entryNamed(menu, 'Remove from roadmap').click();
  await page.done();
  assert.equal(page.calls.save.length, 1);
  const saved = page.calls.save[0];
  assert.equal(saved.projectId, 'p1');
  assert.deepEqual(saved.stages, ['st1', 'st3']);
  assert.deepEqual(saved.items, ['a', 'e']);
  assert.deepEqual(saved.releases, [], 'its cut line went with it');
  assert.equal(typeof saved.label, 'string');
  assert.match(saved.label, /stage 2\b/i, 'the version kept before it says what was removed');
});

test('#748 Remove from roadmap leaves the issues alone: no archive, no clear, no item action', async () => {
  const page = loadPage(removable());
  const menu = await openStageMenu(page, 1);
  entryNamed(menu, 'Remove from roadmap').click();
  await page.done();
  assert.deepEqual([page.calls.archive, page.calls.clear, page.calls.item], [0, 0, 0]);
});

for (const [what, items] of [
  ['an item of the stage runs', [it('b', 'running', 2), it('c', 'planned', 3)]],
  ['an item of the stage waits at a gate', [it('b', 'running', 2, { waiting: true, gate: 'review' })]],
]) {
  test(`#748 Remove from roadmap is refused while ${what}: aria-disabled, the model's reason in its title; a click asks nothing, saves nothing, redraws nothing`, async () => {
    const d = three(stage('st2', items), 'running');
    const page = loadPage(d);
    const menu = await openStageMenu(page, 1);
    const remove = entryNamed(menu, 'Remove from roadmap');
    assert.equal(remove.getAttribute('aria-disabled'), 'true');
    const model = page.sandbox.RoadmapModel.allowedActions(d.roadmap, d.roadmap.stages[1]).removeStage;
    const reason = String(model?.reason ?? '');
    assert.ok(reason.length > 0);
    assert.equal(remove.getAttribute('title'), reason);
    remove.click();
    await page.done();
    assert.equal(page.calls.confirm.length, 0);
    assert.equal(page.calls.save.length, 0);
    assert.equal(page.calls.render, 0);
    assert.equal(openMenus(page.doc).length, 1, 'its menu stays open');
  });
}

// ---------- the other menus move to the shared one ----------

test('#748 the roadmap bar\'s Pause menu is the shared menu: class ui-menu, icon slots, no explanation lines', async () => {
  const page = loadPage(three(stage('st2', [it('b', 'running', 2)]), 'running'));
  page.doc.querySelector('#bl-list [data-rm="pause"]').click();
  await page.done();
  const menu = openMenus(page.doc)[0];
  assert.ok(menu, 'the Pause menu is open');
  assert.equal(menu.classList.contains('ui-menu'), true);
  const entries = [...menu.querySelectorAll('[role="menuitem"]')];
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((el) => el.querySelectorAll('.ui-menu-icon').length), [1, 1]);
  assert.equal(page.doc.querySelectorAll('.bl-menu-why').length, 0);
});

test('#748 the Backlog card\'s ⋯ menu draws with the shared menu (backlog.js, checked as source), with no explanation line', () => {
  const src = fs.readFileSync(require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), 'views/backlog/backlog.js'), 'utf8');
  assert.match(src, /\bMenu\.(menuHtml|bindMenu)\(/);
  assert.equal(src.includes('bl-menu-why'), false);
});

// the catalog module the sandboxes use (withI18n's I18n: one per process)
function I18nOf() { return require('@multiagent/shared/i18n.js'); }
