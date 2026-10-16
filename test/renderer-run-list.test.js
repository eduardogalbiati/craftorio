// src/renderer/run-list.js: nestChildRuns and childRunBadges (#174), the run list's view of a
// `type: workflow` step's parent/child runs. The file has no module.exports (it runs as a global
// script in the renderer), so the two pure functions are pulled out and run in a sandbox, the way
// test/renderer-run-replay.test.js checks app.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('./i18n-sandbox.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'run-list.js'), 'utf8');

const PATTERNS = {
  nestChildRuns: /function nestChildRuns\(list\) \{[\s\S]*?\n\}/,
  childRunBadges: /function childRunBadges\(r\) \{[\s\S]*?\n\}/,
  groupArtifacts: /function groupArtifacts\(files\) \{[\s\S]*?\n\}/,
};

function loadHelpers() {
  const code = {};
  for (const [name, re] of Object.entries(PATTERNS)) {
    const m = re.exec(src);
    assert.ok(m, `${name} not found in run-list.js: the source moved`);
    code[name] = m[0];
  }
  const sandbox = { esc: (s) => s };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(Object.values(code).join('\n') + '\nthis.helpers = { nestChildRuns, childRunBadges, groupArtifacts };', sandbox);
  return sandbox.helpers;
}

const run = (id, extra = {}) => ({ runId: id, startedAt: '2026-09-27T10:00:00Z', ...extra });

test('nestChildRuns orders children by their item index right under their parent', () => {
  const { nestChildRuns } = loadHelpers();
  const parent = run('p1');
  const c1 = run('c1', { parentRun: { run_id: 'p1', index: 1 }, startedAt: '2026-09-27T10:00:01Z' });
  const c0 = run('c0', { parentRun: { run_id: 'p1', index: 0 }, startedAt: '2026-09-27T10:00:02Z' });
  const other = run('other');
  const out = nestChildRuns([other, parent, c1, c0]);
  assert.deepEqual(Array.from(out, (r) => r.runId), ['other', 'p1', 'c0', 'c1']);
  assert.equal(out.find((r) => r.runId === 'p1').nested, undefined);
  assert.equal(out.find((r) => r.runId === 'c0').nested, 1);
  assert.equal(out.find((r) => r.runId === 'c1').nested, 1);
});

test('nestChildRuns keeps an orphan child (its parent is not in the list) in place, unnested', () => {
  const { nestChildRuns } = loadHelpers();
  const orphan = run('c1', { parentRun: { run_id: 'missing-parent', index: 0 } });
  const other = run('other');
  const out = nestChildRuns([orphan, other]);
  assert.deepEqual(Array.from(out, (r) => r.runId), ['c1', 'other']);
  assert.equal(out[0].nested, undefined);
});

test('childRunBadges shows the parent badge with its item number, and the count of child runs with how many are running', () => {
  const { childRunBadges } = loadHelpers();
  const child = run('c1', { parentRun: { run_id: 'p1', workflow: 'child.yaml', step_id: 'child', index: 2 } });
  const childHtml = childRunBadges(child);
  assert.match(childHtml, /Started by run p1 \(child\.yaml\), step child/);
  assert.match(childHtml, /item 3/); // index 2 shown as "item 3" (1-based)

  const parent = run('p1', { childRuns: [{ run_id: 'c1', status: 'success' }, { run_id: 'c2', status: 'running' }] });
  const parentHtml = childRunBadges(parent);
  assert.match(parentHtml, /2 child runs/);
  assert.match(parentHtml, /1 running/);
});

test('childRunBadges is empty for a run with neither a parent nor child runs', () => {
  const { childRunBadges } = loadHelpers();
  assert.equal(childRunBadges(run('solo')), '');
});

// #200: groupArtifacts groups an open row's (or the Artifacts screen's) files for display.
const art = (step, location, name) => ({ step, location, name, rel: name });

test('groupArtifacts: steps come first, in the order they first appear, each keeping its files in order', () => {
  const { groupArtifacts } = loadHelpers();
  const files = [
    art('review', 'run', 'r1.md'),
    art('develop', 'run', 'd1.md'),
    art('review', 'run', 'r2.md'),
    art('develop', 'run', 'd2.md'),
  ];
  const groups = Array.from(groupArtifacts(files), ([label, group]) => [label, Array.from(group, (f) => f.name)]);
  assert.deepEqual(groups, [['review', ['r1.md', 'r2.md']], ['develop', ['d1.md', 'd2.md']]]);
});

test('groupArtifacts: a step-less file inside the run folder is "Other files", outside it (a project copy) is "Project copies", both after every step', () => {
  const { groupArtifacts } = loadHelpers();
  const files = [
    art(null, 'external', 'prd.md'),
    art('plan', 'run', 'plan.md'),
    art(null, 'run', 'notes.txt'),
  ];
  const labels = Array.from(groupArtifacts(files), ([label]) => label);
  assert.deepEqual(labels, ['plan', 'Other files', 'Project copies']);
});
