// #71 The base check of a project with no tests says nothing was tested, it does not fail.
// Acceptance tests written before the code.
//
// Seams: the service area (packages/engine/service/areas/base-health.js) built from a small ctx, as
// test/service/base-health-deps-598.test.js builds it: afterBaseMerge's result, ctx.notify and the
// store file. Contract chosen here: the check ends with status `no_tests` (result and store's
// lastCheck). Test files with no command found still end in `error` (test files exist: something is
// missing), which base-health-deps-598.test.js covers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService, gitRepo } = require('./helpers');

// the check takes the machine's `suite` slot in CRAFTORIO_LOCKS_DIR: each test gets its own folder
let saved;
test.beforeEach(() => {
  saved = { locks: process.env.CRAFTORIO_LOCKS_DIR, inherit: process.env.CRAFTORIO_SUITE_SLOT };
  delete process.env.CRAFTORIO_SUITE_SLOT;
  saved.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh71-locks-'));
  process.env.CRAFTORIO_LOCKS_DIR = saved.dir;
});
test.afterEach(() => {
  for (const [k, v] of [['CRAFTORIO_LOCKS_DIR', saved.locks], ['CRAFTORIO_SUITE_SLOT', saved.inherit]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  fs.rmSync(saved.dir, { recursive: true, force: true, maxRetries: 3 });
});

test('#71 base check: a project with no test command and no test file ends no_tests, with no failure notice', async (t) => {
  const { service, api } = makeService(t);
  // #85: the base check is off by default; this test needs it on
  api['settings:set']({ baseCheck: { onRed: 'fix' } });
  const ws = service.workspace();
  const project = await api['projects:create']({ name: 'bh71', folder: gitRepo(t).dir });
  const notices = [];
  const ctx = { ws, active: new Map(), isReleaseRun: (r) => !!r.release, notify: (n) => notices.push(n) };
  const area = require('../../service/areas/base-health')(ctx);

  const r = await area.afterBaseMerge({ projectId: project.id, runId: 'run-1', mock: false }, { base: 'main' });
  assert.equal(r.status, 'no_tests');
  assert.deepEqual(r.issues || [], []);
  assert.equal(notices.filter((n) => n.event === 'failed').length, 0, 'nothing failed: no "could not run" notice');

  const store = JSON.parse(fs.readFileSync(path.join(ws.root, 'backlog', 'base-health', `${project.id}.json`), 'utf8'));
  assert.equal(store.lastCheck?.status, 'no_tests');
  assert.equal(store.lastGreen || null, null, 'nothing was tested: not a green check');
});
