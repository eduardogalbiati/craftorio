// #225 The Artifacts panel (src/renderer/artifacts-panel.js) leads with what the run produced and
// filters by category. Rendered in Node with test/artifacts-panel-helpers.js (vm sandbox, fake root).
//
// Interface under test (rendered HTML of the panel's list, non-flat mode):
//   - the artifacts come from api.listArtifacts, each with `category` (runArtifacts, #225):
//     'result' | 'screenshots' | 'tests' | 'reports' | 'process' | 'internal';
//   - a "Produced" / "Show all" switch: two buttons with data-artifact-filter="produced" and
//     data-artifact-filter="all"; "produced" (the default) lists result, screenshots, tests and
//     reports only; "all" adds process (logs, handoffs, decisions); 'internal' is never listed;
//   - a filter chip per category present in the current view: data-artifact-category="<category>";
//     a click on a chip lists only that category;
//   - a listed file keeps its existing button `data-ap-file="<path>"`.
// Example runs from the issue: 20261003-140855-eca60379 (67 scratch/skills/*/SKILL.md, 11
// scratch/workflows/*.yaml, owner.json) and 20261003-131720-836db720 (16 logs/*.log, 4 handoffs/*.md,
// decisions.tsv, e2e/scenarios.feature, e2e/scenarios.json).
const test = require('node:test');
const assert = require('node:assert/strict');
const { closestTarget, fakeRoot, loadPanel, waitTick } = require('./artifacts-panel-helpers');

const entry = (rel, category, kind = 'other') => ({
  path: `/r/${rel}`, name: rel.split('/').pop(), rel, kind, category, size: 1, mtime: '2026-10-03T14:08:55Z', exists: true, location: 'run',
});

// run 20261003-140855-eca60379: the seeded scratch workspace and owner.json, plus its result
function run140855() {
  const files = [];
  for (let i = 0; i < 67; i++) files.push(entry(`scratch/skills/skill-${i}/SKILL.md`, 'internal', 'markdown'));
  for (let i = 0; i < 11; i++) files.push(entry(`scratch/workflows/workflow-${i}.yaml`, 'internal', 'text'));
  files.push(entry('owner.json', 'internal', 'json'));
  files.push(entry('result.md', 'result', 'markdown'));
  return files;
}

// run 20261003-131720-836db720: logs, handoffs, the decision log and the E2E scenarios
function run131720() {
  const files = [];
  for (let i = 1; i <= 16; i++) files.push(entry(`logs/step-${i}.log`, 'process', 'text'));
  for (const a of ['product-owner', 'developer', 'tester', 'reviewer']) files.push(entry(`handoffs/${a}.md`, 'process', 'markdown'));
  files.push(entry('decisions.tsv', 'process', 'table'));
  files.push(entry('e2e/scenarios.feature', 'tests', 'other'));
  files.push(entry('e2e/scenarios.json', 'tests', 'json'));
  return files;
}

async function mounted(files) {
  const { ArtifactsPanel } = loadPanel({ listArtifacts: async () => [{ artifacts: files }], runEvidence: async () => ({ images: [] }) });
  const { root, listeners } = fakeRoot();
  ArtifactsPanel.mount(root, { runId: 'r1' });
  await waitTick();
  return { root, listeners };
}
const listed = (html, rel) => html.includes(`data-ap-file="/r/${rel}"`);
const clickFilter = async (listeners, show) => { listeners.click({ target: closestTarget('[data-artifact-filter]', { artifactFilter: show }) }); await waitTick(); };

test('panel: run 140855 by default lists none of its 67 skills, 11 workflow YAMLs or owner.json, only its result', async () => {
  const { root } = await mounted(run140855());
  assert.ok(listed(root.innerHTML, 'result.md'));
  assert.doesNotMatch(root.innerHTML, /data-ap-file="\/r\/scratch\//);
  assert.ok(!listed(root.innerHTML, 'owner.json'));
});

test('panel: the Produced / Show all switch is rendered, Produced by default', async () => {
  const { root } = await mounted(run131720());
  assert.match(root.innerHTML, /data-artifact-filter="produced"/);
  assert.match(root.innerHTML, /data-artifact-filter="all"/);
});

test('panel: run 131720 by default lists only its E2E scenarios, no logs, handoffs or decisions', async () => {
  const { root } = await mounted(run131720());
  assert.ok(listed(root.innerHTML, 'e2e/scenarios.feature'));
  assert.ok(listed(root.innerHTML, 'e2e/scenarios.json'));
  assert.doesNotMatch(root.innerHTML, /data-ap-file="\/r\/logs\//);
  assert.doesNotMatch(root.innerHTML, /data-ap-file="\/r\/handoffs\//);
  assert.ok(!listed(root.innerHTML, 'decisions.tsv'));
  assert.match(root.innerHTML, /data-artifact-category="tests"/);
});

test('panel: Show all on run 131720 also lists the 16 logs, 4 handoffs and the decision log, with a process chip', async () => {
  const { root, listeners } = await mounted(run131720());
  await clickFilter(listeners, 'all');
  const html = root.innerHTML;
  assert.equal((html.match(/data-ap-file="\/r\/logs\//g) || []).length, 16);
  assert.equal((html.match(/data-ap-file="\/r\/handoffs\//g) || []).length, 4);
  assert.ok(listed(html, 'decisions.tsv'));
  assert.ok(listed(html, 'e2e/scenarios.json'));
  assert.match(html, /data-artifact-category="process"/);
  assert.match(html, /data-artifact-category="tests"/);
});

test('panel: Show all on run 140855 still lists no scratch file and no owner.json', async () => {
  const { root, listeners } = await mounted(run140855());
  await clickFilter(listeners, 'all');
  assert.doesNotMatch(root.innerHTML, /data-ap-file="\/r\/scratch\//);
  assert.ok(!listed(root.innerHTML, 'owner.json'));
  assert.ok(listed(root.innerHTML, 'result.md'));
});

test('panel: a category chip lists only that category', async () => {
  const { root, listeners } = await mounted(run131720());
  await clickFilter(listeners, 'all');
  listeners.click({ target: closestTarget('[data-artifact-category]', { artifactCategory: 'tests' }) });
  await waitTick();
  assert.ok(listed(root.innerHTML, 'e2e/scenarios.feature'));
  assert.doesNotMatch(root.innerHTML, /data-ap-file="\/r\/logs\//);
  assert.ok(!listed(root.innerHTML, 'decisions.tsv'));
});
