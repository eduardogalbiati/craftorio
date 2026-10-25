// #465 a live terminal on the deterministic steps: the base check (packages/engine/domains/project/base-health.js, its service
// area packages/engine/service/areas/base-health.js) tells the screens when it starts and ends, so its log can be
// followed live. Acceptance tests written before the code.
// Seam: the area built from a small ctx, as test/service/base-health-wiring-405.test.js builds it,
// with `events` (the service's push emitter): what it emits is recorded.
// Assumption (the channel's name is the change's to choose; `baseCheck:changed` is the expected one):
// the start is one push whose payload names the project, the base commit checked and the check's
// log path (a string), and says it started (`started`: a time, or a status such as 'running'); the
// end is a later push on the same channel carrying the result's status (`result.status` or `status`).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeService, gitRepo } = require('./helpers');

const loadArea = () => require('../../service/areas/base-health');

// #536: the check takes the `suite` slot (#527) in MULTIAGENT_LOCKS_DIR; each test gets its own
// folder, so it never waits for a whole suite holding the machine's slot (the one running this file)
let savedSlot;
test.beforeEach(() => {
  savedSlot = { locks: process.env.MULTIAGENT_LOCKS_DIR, inherit: process.env.MULTIAGENT_SUITE_SLOT };
  delete process.env.MULTIAGENT_SUITE_SLOT;
  const locks = fs.mkdtempSync(path.join(os.tmpdir(), 'bh465-locks-'));
  process.env.MULTIAGENT_LOCKS_DIR = locks;
  savedSlot.dir = locks;
});
test.afterEach(() => {
  for (const [k, v] of [['MULTIAGENT_LOCKS_DIR', savedSlot.locks], ['MULTIAGENT_SUITE_SLOT', savedSlot.inherit]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  fs.rmSync(savedSlot.dir, { recursive: true, force: true, maxRetries: 3 });
});

async function setup(t) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const repo = gitRepo(t);
  const project = await api['projects:create']({ name: 'bh465', folder: repo.dir });
  const pushes = [];
  const ctx = {
    ws, active: new Map(), isReleaseRun: () => false, notify: () => {},
    events: { emit: (channel, payload) => pushes.push({ channel, payload: JSON.parse(JSON.stringify(payload ?? null)) }) },
  };
  const area = loadArea()(ctx);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir }).toString().trim();
  return { project, area, pushes, head };
}

const logOf = (p) => p?.log ?? p?.logPath ?? p?.log_path ?? p?.path ?? null;
const startedOf = (p) => p?.started ?? p?.startedAt ?? p?.started_at ?? (p?.status === 'running' ? true : null);
const statusOf = (p) => p?.result?.status ?? p?.status ?? null;

test('#465 the base check pushes its start: the project, the base commit and the log path', async (t) => {
  const { project, area, pushes, head } = await setup(t);
  const r = await area.afterBaseMerge({ projectId: project.id, runId: 'run-1', mock: false }, { base: 'main', tested: 'not green' });
  assert.equal(r.commit, head, 'the check ran (fixture check)');
  const start = pushes.find((x) => x.payload?.projectId === project.id && x.payload?.commit === head && typeof logOf(x.payload) === 'string' && startedOf(x.payload));
  assert.ok(start, `a push with { projectId, commit, log, started }: ${JSON.stringify(pushes)}`);
  assert.notEqual(start.channel, 'run:event', 'its own channel, not a run\'s events');
});

test('#465 the base check pushes its end with the result, after its start, on the same channel', async (t) => {
  const { project, area, pushes, head } = await setup(t);
  const r = await area.afterBaseMerge({ projectId: project.id, runId: 'run-1', mock: false }, { base: 'main' });
  await new Promise((res) => setTimeout(res, 50));
  const at = pushes.findIndex((x) => x.payload?.projectId === project.id && x.payload?.commit === head && startedOf(x.payload));
  assert.ok(at >= 0, `the start was pushed: ${JSON.stringify(pushes)}`);
  const end = pushes.slice(at + 1).find((x) => x.channel === pushes[at].channel && x.payload?.projectId === project.id && statusOf(x.payload) === r.status);
  assert.ok(end, `a later push with the result's status "${r.status}": ${JSON.stringify(pushes)}`);
});
