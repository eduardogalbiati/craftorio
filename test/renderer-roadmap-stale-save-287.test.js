// #287 the Roadmap screen and a roadmap changed elsewhere. Acceptance tests written before the code.
// - src/renderer/views/backlog/backlog-roadmap.js is loaded whole in a vm sandbox (as
//   test/renderer-backlog-roadmap.test.js does): every save sends the roadmap's `updatedAt` it read
//   (api.saveRoadmap(projectId, stages, label, base): the 4th argument); a refused save (the service
//   answers the current Backlog with `conflict: { reason }`) shows the reason, takes the stored roadmap
//   (ctx.setData) and keeps the Edit form open with the values the owner typed.
// - src/renderer/views/backlog/backlog.js: reload, backlogChanged, staleNotice, ownerBusy and
//   liveReload are pulled out of the source and run for real (as test/renderer-backlog-refresh.test.js
//   does), with the real BacklogRoadmap loaded beside them: when the roadmap changes while an Edit
//   form is open, the form's notice says what changed ("The roadmap changed: 1 item updated elsewhere").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('./i18n-sandbox.js');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', ...p), 'utf8');
const roadmapSrc = read('views', 'backlog', 'backlog-roadmap.js');
const backlogSrc = read('views', 'backlog', 'backlog.js');
const MODULES = ['status-pill.js', 'estimates.js', '../shared/run-progress-model.js', '../shared/default-workflow.js', '../shared/roadmap-model.js', 'workflow-inputs.js'].map((f) => read(f));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const settle = () => new Promise((r) => setTimeout(r, 0));
const SHOW_ALL = { showAll: true, since: 'total' };

// the globals backlog-roadmap.js needs (the same stubs as test/renderer-backlog-roadmap.test.js)
function roadmapGlobals({ saveRoadmap, listWorkflows, choiceDialog, startRoadmap } = {}) {
  return {
    esc,
    state: {},
    errMsg: (e) => String(e?.message || e),
    devMode: () => false,
    confirmDialog: async () => true,
    keptWorkDialog: async () => null,
    choiceDialog: choiceDialog || (async () => null),
    fmtDur: (ms) => (ms == null ? 'unknown' : `${Math.round(ms / 1000)}s`),
    robotAvatar: () => '<svg class="robot"></svg>',
    agentLabel: (agent) => agent,
    PERSON_SVG: '<svg class="person"></svg>',
    ENGINE_SVG: '<svg class="engine"></svg>',
    progressChip: (c) => esc(c.name),
    ChainModel: { chainBadgesHtml: () => '' },
    scheduleRender: () => {},
    api: {
      listWorkflows: listWorkflows || (async () => []),
      saveRoadmap: saveRoadmap || (async (projectId, stages) => ({ roadmap: { state: 'planned', stages } })),
      startRoadmap: startRoadmap || (async () => ({ roadmap: { state: 'running', stages: [] } })),
    },
  };
}

function loadRoadmap(opts = {}) {
  const saved = [];
  const sandbox = roadmapGlobals({
    ...opts,
    saveRoadmap: async (...args) => {
      saved.push(JSON.parse(JSON.stringify(args))); // primitives only: never compare vm objects
      return opts.answer ? opts.answer(...args) : { roadmap: { state: 'planned', stages: args[1] } };
    },
  });
  sandbox.document = { querySelector: () => null, querySelectorAll: () => [] };
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  for (const m of MODULES) vm.runInContext(m, sandbox);
  vm.runInContext(roadmapSrc, sandbox);
  return { BacklogRoadmap: sandbox.BacklogRoadmap, saved, sandbox };
}

function makeCtx(projectId = 'p1') {
  const calls = { setData: [], setError: [], render: 0 };
  return {
    projectId,
    setData: (d) => calls.setData.push(JSON.parse(JSON.stringify(d))),
    setError: (e) => calls.setError.push(String(e)),
    render: () => { calls.render += 1; },
    _calls: calls,
  };
}

const target = (selector, itemId, stage, extra = {}) => {
  const box = { dataset: { item: itemId, stage: String(stage) } };
  const btn = { dataset: extra.dataset || {} };
  btn.closest = (sel) => {
    if (sel === selector) return btn;
    if (sel === '.rm-form') return extra.form || null;
    if (sel === '[data-item]' || sel === '[data-stage]') return box;
    return null;
  };
  return btn;
};
const formOf = (fields) => ({ querySelectorAll: (sel) => (sel === '[data-rm-field]' ? fields : []), querySelector: () => null });

const T1 = '2026-10-11T10:00:00.000Z';
const T2 = '2026-10-11T10:05:00.000Z';
const WORKFLOW = { file: 'w.yaml', inputs: { mode: { enum: ['auto', 'validated'] }, language: { enum: ['js', 'python', 'go'] } } };
const issue = (n) => ({ number: n, title: `Issue ${n}`, url: `https://x/${n}` });
const it1 = (over = {}) => ({ id: 'it1', status: 'planned', workflow: 'w.yaml', issues: [issue(282), issue(284)], inputs: { mode: 'auto', language: 'js' }, ...over });
const it2 = () => ({ id: 'it2', status: 'planned', workflow: 'w.yaml', issues: [issue(290)], inputs: {} });
const dataAt = (updatedAt, item = it1()) => ({ roadmap: { state: 'planned', updatedAt, stages: [{ id: 'st1', name: 'One', note: '', items: [item] }, { id: 'st2', name: 'Two', note: '', items: [it2()] }] }, issues: [] });

// ---- every save says what it was based on ----------------------------------------------------------

test('#287 Save of an Edit form sends the roadmap\'s updatedAt the screen read', async () => {
  const { BacklogRoadmap, saved } = loadRoadmap();
  const data = dataAt(T1);
  const ctx = makeCtx();
  await BacklogRoadmap.onClick({ target: target('[data-rm-edit]', 'it1', 0) }, ctx, data);
  const form = formOf([{ dataset: { rmField: 'language' }, type: 'select-one', value: 'python' }]);
  await BacklogRoadmap.onClick({ target: target('[data-rm-save]', 'it1', 0, { form }) }, ctx, data);
  assert.equal(saved.length, 1);
  assert.equal(saved[0][1][0].items[0].inputs.language, 'python');
  assert.equal(saved[0][3], T1, 'api.saveRoadmap(projectId, stages, label, base): base is the updatedAt read');
});

test('#287 the mode toggle\'s save sends the roadmap\'s updatedAt too', async () => {
  const { BacklogRoadmap, saved } = loadRoadmap();
  const data = dataAt(T1);
  await BacklogRoadmap.onClick({ target: target('[data-rm-mode]', 'it1', 0, { dataset: { rmMode: 'validated' } }) }, makeCtx(), data);
  assert.equal(saved.length, 1);
  assert.equal(saved[0][3], T1);
});

// ---- a refused save ----------------------------------------------------------------------------------

const REASON = 'Stage "One" was changed elsewhere: the inputs of #282 + #284 were set there too. Nothing was saved.';

test('#287 a refused save shows the reason and takes the stored roadmap (the screen reloads)', async () => {
  const fresh = dataAt(T2, it1({ inputs: { mode: 'auto', language: 'go' } }));
  const { BacklogRoadmap } = loadRoadmap({ answer: () => ({ ...fresh, conflict: { reason: REASON } }) });
  const ctx = makeCtx();
  const data = dataAt(T1);
  await BacklogRoadmap.onClick({ target: target('[data-rm-edit]', 'it1', 0) }, ctx, data);
  const form = formOf([{ dataset: { rmField: 'language' }, type: 'select-one', value: 'python' }]);
  await BacklogRoadmap.onClick({ target: target('[data-rm-save]', 'it1', 0, { form }) }, ctx, data);
  assert.ok(ctx._calls.setData.some((d) => d?.roadmap?.updatedAt === T2), 'the stored roadmap is shown');
  assert.ok(ctx._calls.setError.some((m) => m.includes(REASON)), `the reason is shown: ${JSON.stringify(ctx._calls.setError)}`);
});

test('#287 a refused save keeps the Edit form open with the values the owner typed', async () => {
  const fresh = dataAt(T2, it1({ inputs: { mode: 'auto', language: 'go' } }));
  const { BacklogRoadmap } = loadRoadmap({ listWorkflows: async () => [WORKFLOW], answer: () => ({ ...fresh, conflict: { reason: REASON } }) });
  const data = dataAt(T1);
  BacklogRoadmap.html(data, () => {}, SHOW_ALL); // loads the workflows
  await settle();
  const ctx = makeCtx();
  await BacklogRoadmap.onClick({ target: target('[data-rm-edit]', 'it1', 0) }, ctx, data);
  const form = formOf([{ dataset: { rmField: 'language' }, type: 'select-one', value: 'python' }]);
  await BacklogRoadmap.onClick({ target: target('[data-rm-save]', 'it1', 0, { form }) }, ctx, data);
  assert.equal(BacklogRoadmap.busy(), true, 'the form is still open');
  const html = BacklogRoadmap.html(fresh, () => {}, SHOW_ALL);
  assert.match(html, /data-rm-field="language"[^>]*value="python"/, 'the typed value, not the stored "go"');
});

const GONE = 'Stage "One" was removed elsewhere. Nothing was saved.';

test('#287 a refused save whose item is gone shows the "Not saved" box with the reason; Dismiss clears it', async () => {
  const gone = { roadmap: { state: 'planned', updatedAt: T2, stages: [{ id: 'st2', name: 'Two', note: '', items: [it2()] }] }, issues: [] };
  const { BacklogRoadmap } = loadRoadmap({ answer: () => ({ ...gone, conflict: { reason: GONE } }) });
  const ctx = makeCtx();
  const data = dataAt(T1);
  await BacklogRoadmap.onClick({ target: target('[data-rm-edit]', 'it1', 0) }, ctx, data);
  const form = formOf([{ dataset: { rmField: 'language' }, type: 'select-one', value: 'python' }]);
  await BacklogRoadmap.onClick({ target: target('[data-rm-save]', 'it1', 0, { form }) }, ctx, data);
  const html = BacklogRoadmap.html(gone, () => {}, SHOW_ALL);
  assert.match(html, /data-testid="roadmap-save-conflict"/, 'the "Not saved" box shows');
  assert.ok(html.includes(esc(GONE)), 'with the reason');
  await BacklogRoadmap.onClick({ target: target('[data-rm-conflict-dismiss]', null, 0) }, ctx, gone);
  assert.doesNotMatch(BacklogRoadmap.html(gone, () => {}, SHOW_ALL), /roadmap-save-conflict/, 'Dismiss clears it');
});

test('#287 Start with items that push: "Switch them" refused because the roadmap changed elsewhere starts nothing and shows the reason', async () => {
  const list = [{ file: 'software-development.yaml', name: 'Software development', merge: 'remote' }, { file: 'software-development-local-hero.yaml', name: 'Software development (local)', merge: 'local' }];
  const starts = [];
  const item = { id: 'it1', status: 'planned', workflow: 'software-development.yaml', workflowName: 'Software development', issues: [issue(1)] };
  const data = { roadmap: { state: 'planned', updatedAt: T1, stages: [{ id: 'st1', name: '', note: '', items: [item] }] }, issues: [] };
  const fresh = { roadmap: { ...data.roadmap, updatedAt: T2 }, issues: [] };
  const { BacklogRoadmap, saved, sandbox } = loadRoadmap({
    listWorkflows: async () => list,
    choiceDialog: async () => 'switch',
    startRoadmap: async (...args) => { starts.push(args.length); return fresh; },
    answer: () => ({ ...fresh, conflict: { reason: REASON } }),
  });
  sandbox.state.settings = { defaultWorkflow: null };
  sandbox.state.workflows = list;
  BacklogRoadmap.html(data, () => {}, SHOW_ALL);
  await settle();
  const ctx = makeCtx();
  const start = { dataset: { rm: 'start' }, closest: (sel) => (sel === '[data-rm]' ? start : null) };
  await BacklogRoadmap.onClick({ target: start }, ctx, data);
  assert.equal(saved.length, 1, 'the switch was sent');
  assert.equal(saved[0][3], T1, 'with the updatedAt read');
  assert.equal(starts.length, 0, 'nothing starts');
  assert.ok(ctx._calls.setError.some((m) => m.includes(REASON)), `the reason is shown: ${JSON.stringify(ctx._calls.setError)}`);
});

// ---- the notice on the open form -------------------------------------------------------------------

const pick = (re) => {
  const m = re.exec(backlogSrc);
  assert.ok(m, `${re} not found in backlog.js: the source moved`);
  return m[0];
};

// backlog.js's live refresh with an Edit form open (`editing`), the real BacklogRoadmap beside it
function loadBacklog({ shown, next }) {
  const state = { data: next, editing: true };
  const notice = { el: null };
  const form = {
    querySelector: (sel) => (notice.el && sel === '[data-bl-stale]' ? notice.el : null),
    prepend: (el) => { notice.el = el; },
    append: (el) => { notice.el = el; },
  };
  const element = () => {
    const el = { dataset: {}, innerHTML: '', textContent: '', className: '', children: [] };
    el.querySelector = () => ({ addEventListener: () => {} });
    el.append = (...xs) => { el.children.push(...xs.map(String)); };
    return el;
  };
  const sandbox = roadmapGlobals();
  Object.assign(sandbox, {
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    FORM: form,
    renders: 0,
  });
  sandbox.document = { hidden: false, activeElement: null, createElement: element, querySelector: () => null, querySelectorAll: () => [] };
  sandbox.api.onEvent = () => {};
  sandbox.api.onBacklogChanged = () => {};
  sandbox.api.getBacklog = async () => state.data;
  sandbox.window = sandbox;
  sandbox.state.view = 'backlog';
  vm.createContext(withI18n(sandbox));
  for (const m of MODULES) vm.runInContext(m, sandbox);
  vm.runInContext(roadmapSrc, sandbox);
  Object.assign(sandbox.BacklogRoadmap, { busy: () => state.editing, closeEdit: () => { state.editing = false; } });
  vm.runInContext(
    `let bl = { mode: 'roadmap', projectId: 'p1', data: null, syncing: false, seq: 0, selected: new Set() };
     let watching = true;
     let pendingReload = null;
     let shownData = '';
     const $b = (sel) => (/\\.rm-form/.test(sel) && window.BacklogRoadmap.busy() ? FORM : null);
     const visible = () => state.view === 'backlog';
     const dataKey = (id, data) => \`\${id}:\${JSON.stringify(data ?? null)}\`;
     function render() { renders += 1; }
     function setData(data) { bl.data = data; shownData = dataKey(bl.projectId, data); }
     ${pick(/async function reload\(\) \{[\s\S]*?\n  \}/)}
     ${pick(/async function backlogChanged\(\) \{[\s\S]*?\n  \}/)}
     ${pick(/function staleNotice\([^)]*\) \{[\s\S]*?\n  \}/)}
     ${pick(/const ownerBusy = \(\) => \{[\s\S]*?\n  \};/)}
     ${pick(/async function liveReload\(\) \{[\s\S]*?\n  \}/)}
     this.helpers = { setData, liveReload };`,
    sandbox,
  );
  sandbox.helpers.setData(shown);
  const text = () => (notice.el ? `${notice.el.innerHTML} ${notice.el.textContent} ${notice.el.children.join(' ')}` : '');
  return { liveReload: () => sandbox.helpers.liveReload(), text, renders: () => sandbox.renders };
}

test('#287 the open Edit form says the roadmap changed elsewhere, and how: "1 item updated elsewhere"', async () => {
  const shown = dataAt(T1);
  const next = dataAt(T2, it1({ issues: [issue(282), issue(284), issue(285)] })); // #285 appended by a script
  const t = loadBacklog({ shown, next });
  await t.liveReload();
  await settle();
  assert.equal(t.renders(), 0, 'nothing replaces the form under the owner');
  assert.match(t.text(), /roadmap changed/i);
  assert.match(t.text(), /1 item updated elsewhere/i);
});
