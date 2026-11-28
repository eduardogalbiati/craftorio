// #128 screenshot demo (`npm run screenshot -- --view roadmap --roadmap memory`): scripts/screenshot/channels.js
// demoMemoryHold swaps the answers of backlog:get, backlog:state and roadmap:get so the Roadmap shows
// running with its next real start held for memory, the engine's own text (memoryProblem). Pure: no
// Electron is started here.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const load = () => require('../scripts/screenshot/channels');

test('#128 demoMemoryHold: only --roadmap memory swaps answers', () => {
  const { demoMemoryHold } = load();
  assert.deepEqual([demoMemoryHold(ROOT, 'off'), demoMemoryHold(ROOT, null), demoMemoryHold(ROOT, 'test')], [null, null, null]);
});

test('#128 demoMemoryHold: the three answers show the roadmap running, held for memory with the Settings hint', () => {
  const { demoMemoryHold } = load();
  const swap = demoMemoryHold(ROOT, 'memory');
  const roadmap = { state: 'planned', stages: [] };
  const answers = [
    swap['backlog:get']({ roadmap }).roadmap,
    swap['backlog:state']({ projectId: 'p1', roadmap }).roadmap,
    swap['roadmap:get'](roadmap),
  ];
  for (const r of answers) {
    assert.equal(r.state, 'running');
    // memoryProblem rounds to one decimal: 0.06 GB reads "0.1 GB free"
    assert.match(String(r.memoryHold), /\b0\.\d+ GB free\b/);
    for (const part of ['Waiting for memory', 'floor of 1.6 GB', 'Settings › Execution › Memory guard']) {
      assert.equal(String(r.memoryHold).includes(part), true, `"${part}" is not in: ${r.memoryHold}`);
    }
  }
  assert.equal(roadmap.state, 'planned', 'the stored answer is not changed in place');
});

test('#128 demoMemoryHold: an empty answer stays empty', () => {
  const { demoMemoryHold } = load();
  const swap = demoMemoryHold(ROOT, 'memory');
  assert.deepEqual([swap['backlog:get'](null), swap['backlog:state'](null), swap['roadmap:get'](null)], [null, null, null]);
});
