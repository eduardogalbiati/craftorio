// apps/desktop/renderer/run3d/view.js (#388): the run's 3D scene is drawn on demand. inMotion(player) says
// whether it keeps drawing (time moves on screen and someone is at work), sceneKey(player) changes
// when what the frames read changes (a frame is drawn then). view.js is an ES module of the 3D bundle:
// it is bundled here in memory (esbuild, as scripts/build-3d.js does) with React Three Fiber's
// invalidate stubbed, and driven with a real Run3DPlayer fed with the engine's events.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('../renderer/run3d-replay');

const ROOT = path.join(__dirname, '..', '..', '..');

let loaded = null;
async function loadView(t) {
  if (loaded) return loaded;
  let esbuild;
  try { esbuild = require('esbuild'); } catch { t.skip('esbuild is not installed'); return null; }
  const out = await esbuild.build({
    entryPoints: [path.join(ROOT, 'apps/desktop/renderer/run3d/view.js')],
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    plugins: [{
      name: 'stub-fiber',
      setup(b) {
        b.onResolve({ filter: /^@react-three\/fiber$/ }, () => ({ path: 'fiber', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const invalidate = () => {};', loader: 'js' }));
      },
    }],
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run3d-view-'));
  const file = path.join(dir, 'view.cjs');
  fs.writeFileSync(file, out.outputFiles[0].text);
  const hadWindow = 'window' in globalThis, before = globalThis.window;
  globalThis.window = { Run3DTheme: { pick: () => ({ status: {} }) } };
  try { loaded = require(file); } finally {
    if (hadWindow) globalThis.window = before; else delete globalThis.window;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return loaded;
}

const T0 = Date.parse('2026-10-15T10:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const STEPS = [
  { id: 'develop', type: 'agent', agent: 'developer' },
  { id: 'code_review', type: 'agent', agent: 'reviewer' },
  { id: 'approve_merge', type: 'human_approval', agent: null },
];
let seq = 0;
const ev = (s, type, fields = {}) => ({ seq: ++seq, ts: at(s), run_id: 'run-1', type, ...fields });
const started = (s) => ev(s, 'workflow.started', { workflow: 'software-development', file: 'software-development.yaml', inputs: { task: 'Add a /health endpoint' }, steps: STEPS, groups: [] });

// develop fails at 20 s, the supervisor works on it from 21 s to 60 s, develop runs again 61 → 80 s,
// code_review 81 → 100 s, the gate waits from 101 s; `finished`: approved at 110 s, finished at 120 s
function run({ upTo = Infinity, finished = true } = {}) {
  seq = 0;
  const all = [
    started(0),
    ev(1, 'session.opened', { session_id: 's-dev', session: { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' } }),
    ev(2, 'step.started', { step_id: 'develop', visit: 1, step_type: 'agent' }),
    ev(20, 'step.finished', { step_id: 'develop', visit: 1, error: 'tests failed' }),
    ev(21, 'supervisor.started', { step_id: 'develop', error: 'tests failed' }),
    ev(60, 'supervisor.decision', { action: 'retry', goto: 'develop', explanation: 'Try again.' }),
    ev(61, 'step.started', { step_id: 'develop', visit: 2, step_type: 'agent' }),
    ev(80, 'step.finished', { step_id: 'develop', visit: 2, output: { summary: 'Route added' } }),
    ev(81, 'step.started', { step_id: 'code_review', visit: 1, step_type: 'agent' }),
    ev(100, 'step.finished', { step_id: 'code_review', visit: 1, output: { results: { reviewer: { verdict: 'approved', findings: [] } } } }),
    ev(101, 'step.started', { step_id: 'approve_merge', visit: 1, step_type: 'human_approval' }),
    ...(finished ? [
      ev(110, 'step.finished', { step_id: 'approve_merge', visit: 1, output: { approved: true } }),
      ev(120, 'workflow.finished', { status: 'success' }),
    ] : []),
  ];
  return all.filter((e) => Date.parse(e.ts) - T0 <= upTo * 1000);
}
function player(events) {
  const p = new R.Run3DPlayer();
  p.add(events);
  return p;
}
// shows the replayed moment `s` seconds into the run
const showAt = (p, s) => p.seek(p.replayOf(T0 + s * 1000));

test('#388 inMotion: a finished run, shown at its end, is still', async (t) => {
  const v = await loadView(t); if (!v) return;
  assert.equal(v.inMotion(player(run())), false);
});

test('#388 inMotion: a live run with a step running keeps the scene drawing', async (t) => {
  const v = await loadView(t); if (!v) return;
  assert.equal(v.inMotion(player(run({ upTo: 85, finished: false }))), true);
});

test('#388 inMotion: a live run waiting only at its gate is still', async (t) => {
  const v = await loadView(t); if (!v) return;
  assert.equal(v.inMotion(player(run({ upTo: 105, finished: false }))), false);
});

test('#388 inMotion: a paused live run is still, though its step runs', async (t) => {
  const v = await loadView(t); if (!v) return;
  const p = player(run({ upTo: 85, finished: false }));
  assert.equal(p.pause(), true);
  assert.equal(v.inMotion(p), false);
});

test('#388 inMotion: a replay moves while it plays a moment with the supervisor at work, and is still once paused', async (t) => {
  const v = await loadView(t); if (!v) return;
  const p = player(run());
  assert.equal(p.play(), true);
  showAt(p, 40); // no step runs: develop failed, the supervisor works on it
  assert.equal(p.playing, true, 'the replay still plays after the jump');
  assert.equal(v.inMotion(p), true, 'the supervisor at work moves');
  p.pause();
  assert.equal(v.inMotion(p), false, 'a paused replay is still');
});

test('#388 inMotion: a playing replay of a moment with a step running moves', async (t) => {
  const v = await loadView(t); if (!v) return;
  const p = player(run());
  p.play();
  showAt(p, 70);
  assert.equal(v.inMotion(p), true);
});

test('#388 sceneKey: stays the same while nothing changes, so a still scene draws no frame', async (t) => {
  const v = await loadView(t); if (!v) return;
  const p = player(run({ upTo: 105, finished: false }));
  const key = v.sceneKey(p);
  p.notify(); // the overlay's clock ticks
  assert.equal(v.sceneKey(p), key);
});

test('#388 sceneKey: changes on a seek (the shown moment jumps)', async (t) => {
  const v = await loadView(t); if (!v) return;
  const p = player(run());
  const key = v.sceneKey(p);
  showAt(p, 70);
  const seeked = v.sceneKey(p);
  assert.notEqual(seeked, key);
  showAt(p, 70); // the same moment again: still a jump of the cart
  assert.notEqual(v.sceneKey(p), seeked);
});

test('#388 sceneKey: changes when the active step changes on a live run', async (t) => {
  const v = await loadView(t); if (!v) return;
  const p = player(run({ upTo: 70, finished: false }));
  const key = v.sceneKey(p);
  assert.equal(p.model.activeId, 'develop');
  p.add([ev(71, 'step.started', { step_id: 'code_review', visit: 1, step_type: 'agent' })]);
  assert.equal(p.model.activeId, 'code_review');
  assert.notEqual(v.sceneKey(p), key);
});
