// src/renderer/views/workflows/workflows.js (#137): Workflows > Definitions, redesigned into
// sections by category (metadata.category; unknown -> Other), compact cards (modes, declared
// outputs, origin badge, a collapsed step flow that expands) and saved pipelines shown as
// connected workflow cards. It runs only inside the Electron renderer (document, window.api), so
// the relevant functions are pulled out of the source and evaluated in a sandbox with a minimal
// fake DOM, the way test/renderer-start-drawer.test.js and test/artifacts-toggle.test.js check a
// view as a seam: rendering is checked on the HTML string it produces, wiring (click handlers) is
// checked with hand-built fake elements rather than a real DOM parser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
const workflowInputsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'workflow-inputs.js'), 'utf8');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'workflows', 'workflows.js'), 'utf8');

function extract(name, re, from = src) {
  const m = re.exec(from);
  assert.ok(m, `${name} not found: the source moved`);
  return m[0];
}

// A minimal stand-in for the #workflows-list / #wf-sections elements: innerHTML is kept as a
// plain string (never parsed); querySelector('[data-clear]') hands back a live button whenever
// the last rendered HTML included one, so the empty state's "Clear the filters" can be clicked.
function fakeBox() {
  let html = '';
  const clearBtn = { onclick: null };
  return {
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; },
    querySelectorAll: () => [],
    querySelector: (sel) => (sel === '[data-clear]' && /data-clear/.test(html) ? clearBtn : null),
    _clearBtn: clearBtn,
  };
}
function fakeFilters() {
  let html = '';
  return { get innerHTML() { return html; }, set innerHTML(v) { html = v; }, querySelectorAll: () => [] };
}
function fakeInput() { return { value: '' }; }

// Builds a sandbox with the Definitions screen's functions loaded from the real source (never
// reimplemented): CATEGORIES/esc come from app.js, WorkflowInputs is the real module (#116).
function loadDefs({ workflows = [], pipelines = [], api = {} } = {}) {
  const pieces = [
    extract('CATEGORIES', /const CATEGORIES = \{[\s\S]*?\n\};/, appSrc),
    extract('esc', /const esc = \(s\) => [^\n]+;/, appSrc),
    'function robotAvatar() { return ""; }', // the real one needs window.Robots/AgentLooks: out of scope here
    extract('WF_SECTIONS', /const WF_SECTIONS = \{[\s\S]*?\n\};/),
    extract('wfDefs', /const wfDefs = \{[^\n]+\};/),
    extract('wfSectionOf', /const wfSectionOf = [^\n]+;/),
    extract('wfSectionName', /const wfSectionName = [^\n]+;/),
    extract('wfByFile', /const wfByFile = [^\n]+;/),
    extract('pipeSection', /const pipeSection = [^\n]+;/),
    extract('wfMatches', /function wfMatches\(w, q\) \{[\s\S]*?\n\}/),
    extract('pipeMatches', /function pipeMatches\(p, q\) \{[\s\S]*?\n\}/),
    extract('renderWorkflowDefinitions', /function renderWorkflowDefinitions\(\) \{[\s\S]*?\n\}/),
    extract('stepFlow', /function stepFlow\(w\) \{[\s\S]*?\n\}/),
    extract('workflowCard', /function workflowCard\(w\) \{[\s\S]*?\n\}/),
    extract('pipelineCard', /function pipelineCard\(p\) \{[\s\S]*?\n\}/),
    extract('wireWorkflowDefinitions', /function wireWorkflowDefinitions\(box\) \{[\s\S]*?\n\}/),
    extract('stepList', /function stepList\(w\) \{[\s\S]*?\n\}/),
    extract('originBadge', /function originBadge\(w\) \{[\s\S]*?\n\}/),
    extract('showWorkflowDefinition', /function showWorkflowDefinition\(file\) \{[\s\S]*?\n\}/),
    'this.helpers = { wfDefs, wfSectionOf, wfSectionName, wfByFile, pipeSection, wfMatches, pipeMatches, '
      + 'renderWorkflowDefinitions, stepFlow, workflowCard, pipelineCard, wireWorkflowDefinitions, stepList, '
      + 'originBadge, showWorkflowDefinition };',
  ];

  const box = fakeBox();
  const filters = fakeFilters();
  const search = fakeInput();
  const els = { '#workflows-list': box, '#wf-sections': filters, '#wf-search': search };
  const calls = { openDrawer: [], showToast: [], confirmDialog: [], showView: [] };

  const sandbox = {
    state: { workflows, workflowsTab: 'runs' },
    api: { listWorkflows: async () => workflows, listPipelines: async () => pipelines, restoreWorkflow: async () => true, ...api },
    CSS: { escape: (s) => String(s) },
    window: {},
    document: { querySelector: (sel) => (sel === '#wf-search' ? search : null), querySelectorAll: () => [] },
    openDrawer: (...a) => calls.openDrawer.push(a),
    confirmDialog: async (...a) => { calls.confirmDialog.push(a); return true; },
    showToast: (...a) => calls.showToast.push(a),
    showView: (...a) => calls.showView.push(a),
    errMsg: (e) => String(e?.message || e),
    setTimeout,
  };
  sandbox.$ = (sel) => els[sel];
  sandbox.window = sandbox; // WorkflowInputs (browser build) attaches itself to window
  vm.createContext(sandbox);
  vm.runInContext(workflowInputsSrc, sandbox);
  vm.runInContext(pieces.join('\n'), sandbox);
  sandbox.helpers.wfDefs.pipelines = pipelines;
  return { sandbox, helpers: sandbox.helpers, box, filters, search, calls };
}

// ---------------------------------------------------------------------------
// wfSectionOf / wfMatches / pipeMatches / stepFlow / originBadge: pure logic
// ---------------------------------------------------------------------------

test('wfSectionOf: a known category keeps its key; an unknown one (or none) goes to "other"', () => {
  const { helpers } = loadDefs();
  assert.equal(helpers.wfSectionOf('plan'), 'plan');
  assert.equal(helpers.wfSectionOf('build'), 'build');
  assert.equal(helpers.wfSectionOf('weird'), 'other');
  assert.equal(helpers.wfSectionOf(undefined), 'other');
});

test('wfMatches: an empty query always matches; a query matches the name, description, file, tags, outputs, step ids or an agent\'s model', () => {
  const { helpers } = loadDefs();
  const w = {
    name: 'Software development', description: 'Write, review and ship', file: 'software-development.yaml',
    tags: ['team'], outputs: { pr_url: { type: 'string', value: '{{ steps.merge.output.pr_url }}' } }, steps: [{ id: 'develop' }, { id: 'review' }],
    agents: { dev: { model: 'claude-opus-5-5', provider: 'claude' } },
  };
  assert.equal(helpers.wfMatches(w, ''), true);
  assert.equal(helpers.wfMatches(w, 'software'), true);
  assert.equal(helpers.wfMatches(w, 'write, review'), true);
  assert.equal(helpers.wfMatches(w, 'pr_url'), true);
  assert.equal(helpers.wfMatches(w, 'develop'), true);
  assert.equal(helpers.wfMatches(w, 'opus-5-5'), true);
  assert.equal(helpers.wfMatches(w, 'nothing like this'), false);
});

test('pipeMatches: matches the pipeline\'s own name/description/file, or a stage workflow\'s file or name', () => {
  const { helpers, sandbox } = loadDefs();
  sandbox.state.workflows = [{ file: 'a.yaml', name: 'Alpha' }];
  const p = { name: 'Issue to dev', description: 'From tracker to code', file: 'p1.yaml', stages: [{ workflow: 'a.yaml' }] };
  assert.equal(helpers.pipeMatches(p, ''), true);
  assert.equal(helpers.pipeMatches(p, 'issue to dev'), true);
  assert.equal(helpers.pipeMatches(p, 'alpha'), true); // via the stage workflow's name
  assert.equal(helpers.pipeMatches(p, 'a.yaml'), true); // via the stage workflow's file
  assert.equal(helpers.pipeMatches(p, 'nope'), false);
});

test('stepFlow: 7 or fewer steps are all shown; more than 7 shows the first 6 and "+N more"; a human gate is marked', () => {
  const { helpers } = loadDefs();
  const steps = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, type: i === 1 ? 'human_approval' : 'agent' }));
  const seven = helpers.stepFlow({ steps: steps(7) });
  assert.match(seven, /s1/);
  assert.match(seven, /s7/);
  assert.doesNotMatch(seven, /more/);
  const ten = helpers.stepFlow({ steps: steps(10) });
  assert.match(ten, /s6/);
  assert.doesNotMatch(ten, /s7/);
  assert.match(ten, /\+4 more/);
  assert.match(seven, /class="step-chip human"/, 'the human_approval step (s2) is marked');
});

test('originBadge: default/modified/custom text, and a "newer default" badge only when updateAvailable', () => {
  const { helpers } = loadDefs();
  assert.match(helpers.originBadge({ origin: 'default' }), />default</);
  assert.match(helpers.originBadge({ origin: 'modified' }), />modified</);
  assert.match(helpers.originBadge({ origin: 'custom' }), />custom</);
  assert.doesNotMatch(helpers.originBadge({ origin: 'default' }), /newer default/);
  assert.match(helpers.originBadge({ origin: 'modified', updateAvailable: true, bundledVersion: '2.0.0' }), /newer default v2\.0\.0/);
});

// ---------------------------------------------------------------------------
// workflowCard: modes, outputs, Restore default, "Used in", the collapsed/expanded flow
// ---------------------------------------------------------------------------

test('workflowCard: modes render as pills and declared outputs (a map, #134) as chips, the description in the chip\'s title', () => {
  const { helpers } = loadDefs();
  const w = {
    file: 'wf.yaml', name: 'WF', agents: {}, steps: [],
    inputs: { mode: { enum: ['auto', 'validated'], default: 'auto' } },
    outputs: { summary: { type: 'string', description: 'What changed', value: '{{ steps.write.output.summary }}' }, pr_url: { type: 'string', value: '{{ steps.merge.output.pr_url }}' } },
  };
  const html = helpers.workflowCard(w);
  assert.match(html, /class="pill pill-idle"[^>]*>Auto</);
  assert.match(html, /class="pill pill-idle"[^>]*>Validated</);
  assert.match(html, /class="badge wf-out" title="What changed Declared output[^"]*">⇢ summary</);
  assert.match(html, /class="badge wf-out"[^>]*>⇢ pr_url</);
});

test('workflowCard: Restore default shows only when the workflow is restorable', () => {
  const { helpers } = loadDefs();
  const base = { file: 'wf.yaml', name: 'WF', agents: {}, steps: [], origin: 'modified' };
  assert.match(helpers.workflowCard({ ...base, restorable: true }), /data-restore/);
  assert.doesNotMatch(helpers.workflowCard({ ...base, restorable: false }), /data-restore/);
  assert.doesNotMatch(helpers.workflowCard({ ...base }), /data-restore/);
});

test('workflowCard: "Used in" lists the pipelines that start from it or feed it, with its role', () => {
  const { helpers } = loadDefs();
  helpers.wfDefs.pipelines = [
    { file: 'p1.yaml', name: 'Pipe one', stages: [{ workflow: 'wf.yaml' }, { workflow: 'other.yaml' }] },
    { file: 'p2.yaml', name: 'Pipe two', stages: [{ workflow: 'before.yaml' }, { workflow: 'wf.yaml' }] },
  ];
  const html = helpers.workflowCard({ file: 'wf.yaml', name: 'WF', agents: {}, steps: [] });
  assert.match(html, /Used in/);
  assert.match(html, /data-goto-pipe="p1\.yaml"[^>]*>Pipe one</);
  assert.match(html, /\(starts it\)/);
  assert.match(html, /data-goto-pipe="p2\.yaml"[^>]*>Pipe two</);
  assert.match(html, /\(stage 2 of 2\)/);
});

test('workflowCard: the step flow is collapsed by default and expands once its file is in wfDefs.open', () => {
  const { helpers } = loadDefs();
  const w = { file: 'wf.yaml', name: 'WF', agents: { a: { model: 'm' } }, steps: [{ id: 'develop', agent: 'a', next: [] }, { id: 'review', type: 'human_approval', next: [] }] };
  const closed = helpers.workflowCard(w);
  assert.match(closed, /aria-expanded="false"/);
  assert.doesNotMatch(closed, /<ol class="wf-steps">/);
  helpers.wfDefs.open.add('wf.yaml');
  const open = helpers.workflowCard(w);
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /<ol class="wf-steps">/);
  assert.match(open, /<b>develop<\/b>/);
  helpers.wfDefs.open.clear();
});

// ---------------------------------------------------------------------------
// pipelineCard: stages connected, the mapping and condition on each arrow, a missing workflow
// ---------------------------------------------------------------------------

test('pipelineCard: stages are connected, each arrow shows its mapping and "on <condition>"', () => {
  const { helpers, sandbox } = loadDefs();
  sandbox.state.workflows = [{ file: 'a.yaml', name: 'Alpha', category: 'plan' }, { file: 'b.yaml', name: 'Beta', category: 'build' }];
  const p = {
    file: 'p1.yaml', name: 'Pipe', stages: [
      { workflow: 'a.yaml', when: null, map: {} },
      { workflow: 'b.yaml', when: 'success', map: { issues: 'issues' } },
    ],
  };
  const html = helpers.pipelineCard(p);
  assert.match(html, /<b>Alpha<\/b>/);
  assert.match(html, /<b>Beta<\/b>/);
  assert.match(html, /issues → issues/);
  assert.match(html, /on success/);
  assert.doesNotMatch(html, /badge warn">missing/);
});

test('pipelineCard: a stage whose workflow is not in the workspace shows a "missing" badge', () => {
  const { helpers, sandbox } = loadDefs();
  sandbox.state.workflows = [];
  const p = { file: 'p1.yaml', name: 'Pipe', stages: [{ workflow: 'gone.yaml', when: null, map: {} }] };
  const html = helpers.pipelineCard(p);
  assert.match(html, /badge warn">missing/);
});

test('pipelineCard: Run pipeline is disabled when the pipeline failed to load or its first workflow is missing', () => {
  const { helpers, sandbox } = loadDefs();
  sandbox.state.workflows = [{ file: 'a.yaml', name: 'Alpha' }];
  const ok = helpers.pipelineCard({ file: 'p1.yaml', name: 'P', stages: [{ workflow: 'a.yaml', when: null, map: {} }] });
  assert.doesNotMatch(ok, /data-run-pipe disabled/);
  const missing = helpers.pipelineCard({ file: 'p2.yaml', name: 'P', stages: [{ workflow: 'gone.yaml', when: null, map: {} }] });
  assert.match(missing, /data-run-pipe disabled/);
});

test('pipelineCard: a target stage (Product Owner → roadmap) ends the chain with a "roadmap" badge, not a workflow card', () => {
  const { helpers, sandbox } = loadDefs();
  sandbox.state.workflows = [{ file: 'a.yaml', name: 'Alpha', category: 'plan' }];
  const p = { file: 'p1.yaml', name: 'Pipe', stages: [{ workflow: 'a.yaml', when: null, map: {} }, { target: 'product_owner', when: 'success', map: {} }] };
  const html = helpers.pipelineCard(p);
  assert.match(html, /<b>Product Owner<\/b>/);
  assert.match(html, /<span class="badge">roadmap<\/span>/);
});

test('pipelineCard: an origin badge and "Restore default" (data-restore-pipe) show only for a restorable pipeline', () => {
  const { helpers, sandbox } = loadDefs();
  sandbox.state.workflows = [{ file: 'a.yaml', name: 'Alpha' }];
  const stages = [{ workflow: 'a.yaml', when: null, map: {} }];
  const plain = helpers.pipelineCard({ file: 'p1.yaml', name: 'P', stages });
  assert.doesNotMatch(plain, /data-restore-pipe/);
  const modified = helpers.pipelineCard({ file: 'p1.yaml', name: 'P', stages, origin: 'modified', restorable: true });
  assert.match(modified, />modified</);
  assert.match(modified, /data-restore-pipe/);
});

// ---------------------------------------------------------------------------
// renderWorkflowDefinitions: grouping, counts, the section pills, search, sorting, empty state
// ---------------------------------------------------------------------------

function workflow(file, name, category, origin = 'default') {
  return { file, name, category, origin, agents: {}, steps: [] };
}

test('renderWorkflowDefinitions: workflows land in the right section, with the right counts; "Other" shows only when non-empty', () => {
  const workflows = [workflow('a.yaml', 'Alpha', 'plan'), workflow('b.yaml', 'Beta', 'build'), workflow('c.yaml', 'Gamma', 'weird')];
  const { helpers, box, filters } = loadDefs({ workflows });
  helpers.renderWorkflowDefinitions();
  assert.match(filters.innerHTML, /data-section="all"[^>]*>All <span class="muted">3<\/span>/);
  assert.match(filters.innerHTML, /data-section="plan"[^>]*>Plan &amp; Design <span class="muted">1<\/span>/);
  assert.match(filters.innerHTML, /data-section="build"[^>]*>Code &amp; Build <span class="muted">1<\/span>/);
  assert.match(filters.innerHTML, /data-section="monitor"[^>]*>Monitor &amp; Improve <span class="muted">0<\/span>/);
  assert.match(filters.innerHTML, /data-section="other"[^>]*>Other <span class="muted">1<\/span>/);
  assert.match(box.innerHTML, /Alpha[\s\S]*Beta[\s\S]*Gamma/);
});

test('renderWorkflowDefinitions: the "Other" pill is absent when every workflow has a known category', () => {
  const workflows = [workflow('a.yaml', 'Alpha', 'plan'), workflow('b.yaml', 'Beta', 'build')];
  const { helpers, filters } = loadDefs({ workflows });
  helpers.renderWorkflowDefinitions();
  assert.doesNotMatch(filters.innerHTML, /data-section="other"/);
});

test('renderWorkflowDefinitions: the section pill narrows the list to its own workflows', () => {
  const workflows = [workflow('a.yaml', 'Alpha', 'plan'), workflow('b.yaml', 'Beta', 'build')];
  const { helpers, box } = loadDefs({ workflows });
  helpers.wfDefs.section = 'build';
  helpers.renderWorkflowDefinitions();
  assert.match(box.innerHTML, /Beta/);
  assert.doesNotMatch(box.innerHTML, /Alpha/);
  helpers.wfDefs.section = 'all';
});

test('renderWorkflowDefinitions: the search box narrows workflows and pipelines by name', () => {
  const workflows = [workflow('a.yaml', 'Alpha', 'plan'), workflow('b.yaml', 'Beta', 'build')];
  const pipelines = [{ file: 'p1.yaml', name: 'Pipeline for Alpha', category: 'plan', stages: [{ workflow: 'a.yaml', when: null, map: {} }] }];
  const { helpers, box } = loadDefs({ workflows, pipelines });
  helpers.wfDefs.query = 'alpha';
  helpers.renderWorkflowDefinitions();
  assert.match(box.innerHTML, /Alpha/);
  assert.match(box.innerHTML, /Pipeline for Alpha/);
  assert.doesNotMatch(box.innerHTML, />Beta</);
  helpers.wfDefs.query = '';
});

test('renderWorkflowDefinitions: the Pipelines tab (#254) shows the pipelines alone; the Definitions tab shows both', () => {
  const workflows = [workflow('a.yaml', 'Alpha', 'plan'), workflow('b.yaml', 'Beta', 'build')];
  const pipelines = [{ file: 'p1.yaml', name: 'Release chain', category: 'build', stages: [{ workflow: 'a.yaml', when: null, map: {} }] }];
  const { sandbox, helpers, box } = loadDefs({ workflows, pipelines });
  sandbox.state.workflowsTab = 'pipelines';
  helpers.renderWorkflowDefinitions();
  assert.match(box.innerHTML, /Release chain/);
  assert.doesNotMatch(box.innerHTML, />Beta</);
  sandbox.state.workflowsTab = 'definitions';
  helpers.renderWorkflowDefinitions();
  assert.match(box.innerHTML, /Release chain/);
  assert.match(box.innerHTML, /Beta/);
});

test('renderWorkflowDefinitions: the Pipelines tab with no pipeline shows its empty state, though workflows exist', () => {
  const { sandbox, helpers, box, filters } = loadDefs({ workflows: [workflow('a.yaml', 'Alpha', 'plan')], pipelines: [] });
  sandbox.state.workflowsTab = 'pipelines';
  helpers.renderWorkflowDefinitions();
  assert.match(box.innerHTML, /No pipelines yet/);
  assert.doesNotMatch(box.innerHTML, /Alpha/);
  assert.equal(filters.innerHTML, '');
});

test('renderWorkflowDefinitions: custom workflows sort after bundled ones within their section', () => {
  const workflows = [workflow('z.yaml', 'Zzz custom', 'build', 'custom'), workflow('a.yaml', 'Aaa bundled', 'build', 'default')];
  const { helpers, box } = loadDefs({ workflows });
  helpers.renderWorkflowDefinitions();
  const html = box.innerHTML;
  assert.ok(html.indexOf('Aaa bundled') < html.indexOf('Zzz custom'), 'the bundled workflow must render before the custom one');
});

test('renderWorkflowDefinitions: no match for the filters shows an empty state; "Clear the filters" resets the section and the search box', () => {
  const workflows = [workflow('a.yaml', 'Alpha', 'plan')];
  const { helpers, box, search } = loadDefs({ workflows });
  helpers.wfDefs.query = 'nothing matches this';
  search.value = 'nothing matches this';
  helpers.renderWorkflowDefinitions();
  assert.match(box.innerHTML, /No workflow matches/);
  assert.match(box.innerHTML, /data-clear/);

  box._clearBtn.onclick();

  assert.equal(helpers.wfDefs.section, 'all');
  assert.equal(helpers.wfDefs.query, '');
  assert.equal(search.value, '');
  assert.match(box.innerHTML, /Alpha/, 'clearing the filters re-renders the full list');
});

// ---------------------------------------------------------------------------
// wireWorkflowDefinitions: Run pipeline (api.runPipeline, or the Start drawer fallback)
// ---------------------------------------------------------------------------

function fakePipeButton(pipeFile) {
  return { closest: (sel) => (sel === '.wf-pipe' ? { dataset: { pipe: pipeFile } } : null), onclick: null };
}
function wireBoxWithRunPipe(btn) {
  return { querySelectorAll: (sel) => (sel === '[data-run-pipe]' ? [btn] : []), querySelector: () => null };
}

test('wireWorkflowDefinitions: Run pipeline opens the Start drawer on the pipeline when api.runPipeline exists (the drawer itself starts every stage)', async () => {
  const { helpers, calls } = loadDefs({ api: { runPipeline: async () => {} } });
  helpers.wfDefs.pipelines = [{ file: 'p1.yaml', stages: [{ workflow: 'a.yaml' }] }];
  const btn = fakePipeButton('p1.yaml');
  helpers.wireWorkflowDefinitions(wireBoxWithRunPipe(btn));

  await btn.onclick();

  assert.equal(calls.openDrawer.length, 1);
  assert.equal(calls.openDrawer[0][0].pipeline, 'p1.yaml');
});

test('wireWorkflowDefinitions: without api.runPipeline, Run pipeline opens the Start drawer on the pipeline\'s first workflow', async () => {
  const { helpers, calls } = loadDefs({ api: { runPipeline: undefined } });
  helpers.wfDefs.pipelines = [{ file: 'p1.yaml', stages: [{ workflow: 'a.yaml' }, { workflow: 'b.yaml' }] }];
  const btn = fakePipeButton('p1.yaml');
  helpers.wireWorkflowDefinitions(wireBoxWithRunPipe(btn));

  await btn.onclick();

  assert.equal(calls.openDrawer.length, 1);
  assert.equal(calls.openDrawer[0][0].workflow, 'a.yaml');
});

// ---------------------------------------------------------------------------
// showWorkflowDefinition: the deep link resets the filters so the card is visible
// ---------------------------------------------------------------------------

test('showWorkflowDefinition: resets the section and the search box so a filtered-out card becomes visible', () => {
  const { helpers, search, calls } = loadDefs();
  helpers.wfDefs.section = 'monitor';
  helpers.wfDefs.query = 'something else';
  search.value = 'something else';

  helpers.showWorkflowDefinition('wf.yaml');

  assert.equal(helpers.wfDefs.section, 'all');
  assert.equal(helpers.wfDefs.query, '');
  assert.equal(search.value, '');
  assert.deepEqual(calls.showView, [['workflows']]);
});
