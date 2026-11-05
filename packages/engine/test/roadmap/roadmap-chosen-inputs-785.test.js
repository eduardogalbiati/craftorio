// #785: adding a plan to the roadmap stores only chosen inputs: empty strings are never stored, on
// either way in (roadmap.propose: "Add all to the roadmap"; roadmap.saveStages: one group's "Add to
// roadmap", through api.saveRoadmap). An old item is not rewritten by reading it. Acceptance tests
// written before the code. The roadmap's store is packages/engine/domains/roadmap/roadmap.js (the
// issue names backlog.js, which only reads the items for a run).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const roadmaps = require('../../domains/roadmap/roadmap');

const PROJECT = 'ai-memory';
const ISSUES = [{ number: 1887, state: 'open', title: 'Index the notes', url: 'https://example.test/1887' }];

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-785-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const stagesWith = (inputs) => [{ name: 'Stage 1', note: '', items: [{ workflow: 'feature.yaml', issues: [1887], inputs }] }];
const saved = (dir) => ({ ...roadmaps.readRoadmap(dir, PROJECT).stages[0].items[0].inputs });

test('#785 a plan with no chosen inputs stores none', (t) => {
  const dir = tmp(t);
  roadmaps.propose(dir, PROJECT, { stages: stagesWith({}) }, { issues: ISSUES });
  assert.deepEqual(saved(dir), {});
});

test('#785 a plan with one chosen input stores only that key', (t) => {
  const dir = tmp(t);
  roadmaps.propose(dir, PROJECT, { stages: stagesWith({ e2e_tests: 'off' }) }, { issues: ISSUES });
  assert.deepEqual(saved(dir), { e2e_tests: 'off' });
});

test('#785 a proposal never stores an empty string', (t) => {
  const dir = tmp(t);
  roadmaps.propose(dir, PROJECT, { stages: stagesWith({ test_command: '', check_command: '  ', e2e_tests: 'off' }) }, { issues: ISSUES });
  assert.deepEqual(saved(dir), { e2e_tests: 'off' });
});

test('#785 a group added on its own never stores an empty string', (t) => {
  const dir = tmp(t);
  roadmaps.saveStages(dir, PROJECT, stagesWith({ e2e_command: '', screenshots: 'off' }), { issues: ISSUES });
  assert.deepEqual(saved(dir), { screenshots: 'off' });
});

test('#785 reading an old item leaves its file as it was', (t) => {
  const dir = tmp(t);
  roadmaps.propose(dir, PROJECT, { stages: stagesWith({ mode: 'local' }) }, { issues: ISSUES });
  const file = path.join(dir, `${PROJECT}.roadmap.json`);
  const old = JSON.parse(fs.readFileSync(file, 'utf8'));
  old.stages[0].items[0].inputs = { mode: 'local', test_order: 'e2e_first', e2e_tests: 'write_and_run', screenshots: 'all', test_command: '' };
  fs.writeFileSync(file, JSON.stringify(old));
  const before = fs.readFileSync(file, 'utf8');
  roadmaps.readRoadmap(dir, PROJECT);
  assert.equal(fs.readFileSync(file, 'utf8') === before, true);
});

test('#785 an old item keeps its saved values when read', (t) => {
  const dir = tmp(t);
  roadmaps.propose(dir, PROJECT, { stages: stagesWith({ mode: 'local', test_order: 'e2e_first', e2e_tests: 'write_and_run' }) }, { issues: ISSUES });
  assert.deepEqual(saved(dir), { mode: 'local', test_order: 'e2e_first', e2e_tests: 'write_and_run' });
});
