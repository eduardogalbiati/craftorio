// Test helper (not a test) for #785's page tests: the whole page (packages/ui-kit/test/
// agent-chat-page-harness.js) with workflows/feature.yaml's real inputs and a fork-code backend
// project's run defaults (api.projectInputHints' `runDefaults`, what `resolveRunInputs` takes), and the
// Product Owner's drawer opened on it. A recommendation is built by the engine's own normalizeAnswer.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { textOf } = require('@craftorio/ui-kit/test/mini-dom');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');
const productOwner = require('@craftorio/engine/domains/po/product-owner');

const feature = yaml.load(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'workflows', 'feature.yaml'), 'utf8'));
const FEATURE = { file: 'feature.yaml', name: feature.metadata.name, description: feature.metadata.description, inputs: feature.inputs };
const QUICK = { file: 'quick.yaml', name: 'quick-dev', description: 'A copy of feature', inputs: feature.inputs };
const RUN_DEFAULTS = {
  kind: 'backend', variant: 'fork-code', mode: 'fork', test_order: 'code_first', language: 'rust', base_branch: 'main',
  test_command: 'cargo test', check_command: 'cargo clippy', e2e_tests: 'off', e2e_command: '', ui_folders: [], screenshots: 'off', steps_folders: [],
};
const HINTS = { language: 'rust', branches: ['main'], defaultBranch: 'main', runDefaults: RUN_DEFAULTS };
const ISSUE = { number: 7, state: 'open', title: 'Index the notes', url: 'https://example.test/7', labels: [{ name: 'complexity:2' }], body: 'x'.repeat(200) };
const plain = (v) => JSON.parse(JSON.stringify(v));

/** A conversation whose answer recommends `group` (the raw answer's fields; the engine normalizes it). */
function recommendation(group = {}) {
  const raw = { summary: 'O plano.', groups: [{ name: 'Notes', issues: [7], workflow: 'feature.yaml', reason: 'Same files.', stage: 1, ...group }], conflicts: [], enrich: [] };
  const answer = productOwner.normalizeAnswer(raw, { issues: [ISSUE], history: [], workflows: [FEATURE, QUICK], runDefaults: RUN_DEFAULTS });
  return plain([
    { role: 'user', text: 'Analisar o backlog e propor runs', ts: '2026-11-05T10:00:00.000Z' },
    { role: 'po', text: answer.summary, ts: '2026-11-05T10:01:00.000Z', answer, costUsd: 0 },
  ]);
}

/** The page with the drawer open on project "demo"; `added`: the groups given to BacklogActions.roadmapGroup. */
async function openDrawer({ history = [], language = null, api = {} } = {}) {
  const page = await loadPage({
    api: {
      listWorkflows: async () => [FEATURE, QUICK],
      listProjects: async () => [{ id: 'demo', name: 'Demo project' }],
      productOwnerHistory: async () => plain(history),
      projectInputHints: async () => plain(HINTS),
      askProductOwner: () => new Promise(() => {}),
      proposeRoadmap: async () => ({ roadmap: { state: 'planned', stages: [] }, dropped: [] }),
      ...api,
    },
  });
  if (language) page.sandbox.I18n.setLanguage(language);
  const added = [];
  const actions = page.sandbox.BacklogActions;
  actions.projectId = () => 'demo';
  actions.project = () => ({ id: 'demo', name: 'Demo project' });
  actions.data = () => ({ projectId: 'demo', issues: [plain(ISSUE)] });
  actions.roadmapGroup = async (g) => { added.push(plain(g)); return []; };
  actions.showRoadmap = () => {};
  await page.sandbox.BacklogPO.open();
  await settle(30);
  return Object.assign(page, { added });
}

/** A real click: bubbles to the drawer's and the document's listeners. */
async function click(page, el, what = 'the control') {
  assert.equal(el === null, false, `${what} is rendered`);
  el.dispatchEvent(new page.dom.classes.MouseEvent('click', { bubbles: true, cancelable: true }));
  await settle(30);
}

/** Whether `el`, or an ancestor, is hidden (attribute, class or style). A missing element counts as hidden. */
function isHidden(el) {
  if (!el) return true;
  for (let n = el; n; n = n.parentNode) {
    if (n.hasAttribute?.('hidden') || n.classList?.contains('hidden') || n.style?.display === 'none') return true;
  }
  return false;
}

/** The owner sends `text` through the drawer's chat. */
async function send(page, text) {
  page.dom.type(page.$('#po-drawer [data-testid="agent-chat-input"]'), text);
  await click(page, page.$('#po-drawer [data-testid="agent-chat-send"]'), 'Ask');
}

const byTestId = (root, id) => root.querySelector(`[data-testid="${id}"]`);

module.exports = { FEATURE, QUICK, RUN_DEFAULTS, HINTS, plain, recommendation, openDrawer, click, isHidden, send, byTestId, settle, textOf, loadPage };
