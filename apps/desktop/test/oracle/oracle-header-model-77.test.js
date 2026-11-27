// #77: the model the Agents window's header shows for the Oracle (fronts/ai/views/oracle/oracle.js,
// AgentsWindow.register({ id: 'oracle', header })). Acceptance tests, written before the fix.
// Decision: no fallback. The header's model is the Oracle service's own (oracle:state's `model`, which
// load() fetches when the surface mounts) or '' until it answers, never anything else: the dead read
// of window.oracleAgent (defined by no file) goes, and so does its `var oracleAgent;` in
// packages/contract/page-globals.js.
// Seam: the whole page (packages/ui-kit/test/agent-chat-page-harness.js loadPage, a fake window.api:
// the only mock), the Agents window mounted on the Oracle (window.AgentsWindow.mount, the way
// packages/ui-kit/test/renderer-agents-window-263.test.js mounts it); header().model is read where the
// window shows it, the header's .aw-model (agents-window.js headerHtml prints it only when non-empty).
// Type side: packages/engine/test/typecheck-edges-52.test.js runs the typecheck on scratch trees only,
// so the page-globals declaration is checked here by its source.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const ORACLE_JS = path.join(ROOT, 'fronts', 'ai', 'views', 'oracle', 'oracle.js');
const PAGE_GLOBALS = path.join(ROOT, 'packages', 'contract', 'page-globals.js');

// the page harness is required inside each test: a harness that fails to load fails its tests, not the file
const harness = () => require('../../../../packages/ui-kit/test/agent-chat-page-harness');
const textOf = (el) => require('../../../../packages/ui-kit/test/mini-dom').textOf(el);

// The page with the Agents window mounted on the Oracle (its surface mounted: load() asks oracle:state).
async function oracleWindow(api) {
  const { loadPage, settle } = harness();
  const page = await loadPage({ api });
  const aw = page.sandbox.AgentsWindow;
  assert.equal(typeof aw?.mount, 'function', 'window.AgentsWindow.mount (packages/ui-kit/agents-window.js)');
  page.run("document.body.insertAdjacentHTML('beforeend', '<div id=\"aw-root-77\"></div>')");
  aw.mount(page.$('#aw-root-77'), { agent: 'oracle' });
  await settle(20);
  return page;
}

// header() is called again on the next paint (AgentsWindow.changed, the agents' own redraw call)
async function repaint(page) {
  page.sandbox.AgentsWindow.changed();
  await harness().settle(10);
}

// what the header says: the agent it names, and the model it shows ('' when header().model is empty)
function headerFacts(page) {
  const head = page.$('#aw-root-77 [data-testid="agents-window-header"]');
  assert.ok(head, 'the Agents window has its header');
  const model = head.querySelector('.aw-model');
  return { title: textOf(head.querySelector('.aw-title') || head).trim(), model: model ? textOf(model).trim() : '' };
}

test('#77 the header shows the model the Oracle service reports (oracle:state model)', async () => {
  const page = await oracleWindow({ oracleState: async () => ({ model: 'claude-opus-5-5', busy: false }) });
  await repaint(page);
  assert.ok(page.callsTo('oracleState').length >= 1, 'mounting the Oracle asked oracle:state');
  const facts = headerFacts(page);
  assert.equal(facts.title, 'Oracle');
  assert.equal(facts.model, 'claude-opus-5-5');
});

test('#77 before the service answers (oracle:state pending) the header shows no model', async () => {
  const { deferred } = harness();
  const state = deferred();
  const page = await oracleWindow({ oracleState: () => state.promise });
  await repaint(page);
  const facts = headerFacts(page);
  assert.equal(facts.title, 'Oracle');
  assert.equal(facts.model, '');
});

test('#77 never a wrong model: a window.oracleAgent on the page is not shown when the service has no model', async () => {
  const page = await oracleWindow({ oracleState: async () => ({ busy: false }) });
  page.run("window.oracleAgent = { model: 'stale-model' }");
  await repaint(page);
  const facts = headerFacts(page);
  assert.equal(facts.title, 'Oracle', 'the header was painted for the Oracle');
  assert.equal(facts.model, '', 'the header\'s model is the service\'s or empty, never window.oracleAgent\'s');
});

test('#77 source: oracle.js no longer reads oracleAgent', () => {
  const src = fs.readFileSync(ORACLE_JS, 'utf8');
  const lines = src.split(/\r?\n/).map((l, i) => `${i + 1}: ${l.trim()}`).filter((l) => /oracleAgent/.test(l));
  assert.deepEqual(lines, [], 'fronts/ai/views/oracle/oracle.js mentions oracleAgent');
});

test('#77 types: packages/contract/page-globals.js does not declare oracleAgent', () => {
  const src = fs.readFileSync(PAGE_GLOBALS, 'utf8');
  const lines = src.split(/\r?\n/).map((l, i) => `${i + 1}: ${l.trim()}`).filter((l) => /\boracleAgent\b/.test(l));
  assert.deepEqual(lines, [], 'page-globals.js declares oracleAgent');
});
