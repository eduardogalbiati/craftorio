// #405 "main stays green": the Roadmap tab names the known failures on the base (acceptance tests
// written before the code).
//
// Seams:
// - src/renderer/views/backlog/backlog-roadmap.js loaded whole into a vm sandbox (the setup of
//   test/renderer-backlog-roadmap-view.test.js, copied in its minimal form); the seam is
//   BacklogRoadmap.html(data, rerender): `data.baseFailures` is the project's knownFailures list
//   (packages/engine/domains/project/base-health.js). Only the returned HTML string is checked.
//
// Assumptions:
// - Non-empty: exactly one element data-testid="base-failures" whose text counts the failures
//   (e.g. "1 known failure on the base") and holds a link data-testid="base-failures-link".
// - Empty or missing: no base-failures element.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');

const R = path.join(__dirname, '..', 'src', 'renderer');
const read = (...p) => fs.readFileSync(path.join(R, ...p), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

function loadRoadmap() {
  const store = new Map();
  const sandbox = {
    esc,
    state: {},
    errMsg: (e) => String(e?.message || e),
    devMode: () => false,
    confirmDialog: async () => true,
    keptWorkDialog: async () => null,
    choiceDialog: async () => null,
    fmtDur: (ms) => (ms == null ? 'unknown' : `${Math.round(ms / 1000)}s`),
    robotAvatar: () => '<svg class="robot"></svg>',
    agentLabel: (agent) => agent,
    PERSON_SVG: '<svg class="person"></svg>',
    ENGINE_SVG: '<svg class="engine"></svg>',
    progressChip: (c) => esc(c.name),
    ChainModel: { chainBadgesHtml: () => '' },
    scheduleRender: () => {},
    markdownHtml: (s) => esc(s),
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    api: {
      listWorkflows: async () => [],
      saveRoadmap: async (projectId, stages) => ({ roadmap: { state: 'planned', stages } }),
      startRoadmap: async () => ({ roadmap: { state: 'running', stages: [] } }),
      roadmapItem: async () => ({ roadmap: { state: 'planned', stages: [] } }),
      setRoadmapLive: async () => ({ roadmap: { state: 'running', stages: [] } }),
    },
  };
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.window = sandbox;
  sandbox.window.showRun = () => {};
  vm.createContext(withI18n(sandbox));
  vm.runInContext(read('status-pill.js'), sandbox);
  vm.runInContext(read('..', '..', 'packages', 'shared', 'run-progress-model.js'), sandbox);
  vm.runInContext(read('..', '..', 'packages', 'shared', 'default-workflow.js'), sandbox);
  vm.runInContext(read('..', '..', 'packages', 'shared', 'roadmap-model.js'), sandbox);
  vm.runInContext(read('workflow-inputs.js'), sandbox);
  if (fs.existsSync(path.join(R, 'estimates.js'))) vm.runInContext(read('estimates.js'), sandbox);
  vm.runInContext(read('views', 'backlog', 'backlog-roadmap.js'), sandbox);
  return sandbox.window.BacklogRoadmap;
}

const item = (id, status, number, title) => ({ id, status, workflow: 'software-development.yaml', inputs: {}, issues: [{ number, title, url: `https://github.com/o/r/issues/${number}` }] });
function data(baseFailures) {
  return {
    roadmap: { state: 'running', stages: [
      { id: 'st1', name: '', note: '', items: [item('i1', 'running', 1, 'Running one')] },
      { id: 'st2', name: '', note: '', items: [item('i2', 'planned', 2, 'Planned two')] },
    ] },
    issues: [{ number: 1, title: 'Running one', labels: [] }, { number: 2, title: 'Planned two', labels: [] }],
    epics: [],
    ...(baseFailures === undefined ? {} : { baseFailures }),
  };
}
const FAILURE = { test: 'cart totals include tax', file: 'test/cart.test.js', first_seen: '2026-10-15T10:00:00.000Z', last_seen: '2026-10-15T11:00:00.000Z', runs: ['r1', 'r2'], issue: { url: 'https://github.com/o/r/issues/501' } };
const count = (html, s) => html.split(s).length - 1;

test('#405 roadmap with one known base failure: one base-failures line counting it, with a link', () => {
  const html = loadRoadmap().html(data([FAILURE]), () => {});
  assert.equal(count(html, 'data-testid="base-failures"'), 1);
  const at = html.indexOf('data-testid="base-failures"');
  const block = html.slice(at, at + 2000);
  assert.match(text(block), /\b1 known failure/);
  assert.ok(block.includes('data-testid="base-failures-link"'), 'the line holds its link');
});

test('#405 roadmap with no known base failures (empty or missing): no base-failures line', () => {
  for (const list of [[], undefined]) {
    const html = loadRoadmap().html(data(list), () => {});
    assert.equal(count(html, 'data-testid="base-failures"'), 0);
    assert.match(html, /Running one/, 'the roadmap itself still renders');
  }
});
