// #72: the run's 3D view counts a turn of unknown cost by the CLI's figure and marks the cost that
// includes one: the model (run3d-model.js cost, costApprox, the kept turns' filter) and the HUD's cost
// card (run3d/hud.jsx Kpis, bundled in memory and rendered as run3d-hud-group-name-792.test.js does).
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const I18n = require('@craftorio/shared/i18n.js');
const RunProgress = require('@craftorio/shared/run-progress-model');
const Run3DModel = require('../run3d-model');
const R = require('../run3d-replay');
const Run3DTheme = require('../run3d-theme');

const RUN3D = path.join(__dirname, '..', 'run3d');
const T0 = Date.parse('2026-11-25T10:00:00.000Z');
const UNKNOWN = { cost_usd: null, cost_source: 'unknown', cli_cost_usd: 0.24 };
const KNOWN = { cost_usd: 0.24 };

// develop costs $0.93; the review's turn is `review`
function events(review) {
  let seq = 0;
  const ev = (s, type, fields = {}) => ({ seq: ++seq, ts: new Date(T0 + s * 1000).toISOString(), run_id: 'run-1', type, ...fields });
  const steps = [{ id: 'develop', type: 'agent', agent: 'developer' }, { id: 'review', type: 'agent', agent: 'reviewer' }];
  const turn = (s, session, step, fields) => [
    ev(s, 'session.message_sent', { session_id: session, step_id: step, turn: 1 }),
    ev(s + 5, 'session.message_received', { session_id: session, step_id: step, turn: 1, text: 'done', usage: { input: 1000, output: 100 }, ...fields }),
  ];
  return [
    ev(0, 'workflow.started', { workflow: 'w', file: 'w.yaml', inputs: { task: 'x' }, steps, groups: [{ name: 'Develop', steps: ['develop', 'review'] }] }),
    ev(1, 'session.opened', { session_id: 's-dev', session: { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' } }),
    ev(1, 'session.opened', { session_id: 's-rev', session: { agent: 'reviewer', provider: 'claude', model: 'x' } }),
    ev(2, 'step.started', { step_id: 'develop', visit: 1, step_type: 'agent' }),
    ...turn(3, 's-dev', 'develop', { cost_usd: 0.93 }),
    ev(10, 'step.started', { step_id: 'review', visit: 1, step_type: 'agent' }),
    ...turn(11, 's-rev', 'review', review),
  ];
}

function model(review) {
  const m = new Run3DModel.Run3DModel({ mainGates: [] });
  m.applyAll(events(review));
  return m;
}

test('#72 the 3D model counts an unknown turn by the CLI\'s figure and marks only the costs that include it', () => {
  const m = model(UNKNOWN);
  assert.ok(Math.abs(m.cost() - 1.17) < 1e-9, `${m.cost()}`);
  assert.equal(m.costApprox(), true);
  assert.equal(m.costApprox((x) => x.step === 'review'), true);
  assert.equal(m.costApprox((x) => x.step === 'develop'), false);
});

test('#72 the 3D model leaves a run whose costs are all known unmarked', () => {
  assert.equal(model(KNOWN).costApprox(), false);
});

// a server render needs a snapshot of its own: the view's hooks read the store on the client only
const reactStub = { ...React, useSyncExternalStore: (subscribe, get) => React.useSyncExternalStore(subscribe, get, get) };
function requireFor(id) {
  if (id === 'react') return reactStub;
  if (id === '@react-three/fiber') return { invalidate: () => {} };
  return require(id);
}

async function costCard(t, review) {
  let esbuild;
  try { esbuild = require('esbuild'); } catch { t.skip('esbuild is not installed'); return null; }
  const out = await esbuild.build({
    stdin: { contents: "export { Kpis } from './hud.jsx'; export { begin, end } from './view.js';", resolveDir: RUN3D, loader: 'js' },
    bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', loader: { '.jsx': 'jsx' },
    external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@react-three/*'], logLevel: 'silent',
  });
  globalThis.window = { Run3DTheme, Run3DModel, Run3DReplay: R, RunProgress, Robots: { variantFor: () => 'default' } };
  globalThis.t = I18n.t;
  const m = new Module(path.join(RUN3D, 'hud.bundle.js'));
  m.require = requireFor;
  m._compile(out.outputFiles[0].text, m.id);
  const player = new R.Run3DPlayer();
  player.add(events(review));
  m.exports.begin({ player, root: null });
  t.after(() => m.exports.end());
  const html = renderToStaticMarkup(React.createElement(m.exports.Kpis));
  return /data-testid="run3d-card-cost".*?<b>(.*?)<\/b>/.exec(html)[1];
}

test('#72 the 3D HUD\'s cost card is marked when the run includes an unknown cost', async (t) => {
  const text = await costCard(t, UNKNOWN);
  if (text != null) assert.match(text, /^≈ .*1[.,]17/);
});

test('#72 the 3D HUD\'s cost card of known costs is not marked', async (t) => {
  const text = await costCard(t, KNOWN);
  if (text != null) assert.match(text, /^[^≈]*1[.,]17/);
});
