// #792: the Pipeline of the run's 3D view (packages/ui-kit/run3d/hud.jsx) names the last group as the
// rest of the app does: a run's `Open PR` group reads "Abrir PR" in Portuguese, a local merge keeps
// "Merge". hud.jsx is an ES module of the 3D bundle: it is bundled here in memory (esbuild, as
// scripts/build-3d.js does) and the real Pipeline is rendered to markup with the real React, from a real
// Run3DPlayer fed with the engine's events. No WebGL: only the HUD is drawn, the scene is not.
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

// a server render needs a snapshot of its own: the view's hooks read the store on the client only
const reactStub = { ...React, useSyncExternalStore: (subscribe, get) => React.useSyncExternalStore(subscribe, get, get) };
function requireFor(id) {
  if (id === 'react') return reactStub;
  if (id === '@react-three/fiber') return { invalidate: () => {} };
  return require(id);
}

let hud = null;
async function loadHud(t) {
  if (hud) return hud;
  let esbuild;
  try { esbuild = require('esbuild'); } catch { t.skip('esbuild is not installed'); return null; }
  const out = await esbuild.build({
    stdin: { contents: "export { Pipeline } from './hud.jsx'; export { begin, end } from './view.js';", resolveDir: RUN3D, loader: 'js' },
    bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', loader: { '.jsx': 'jsx' },
    external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@react-three/*'], logLevel: 'silent',
  });
  // the page's globals the bundle reads: window.* and the catalog's t, at load and at call time
  // (Robots: a station's look, which a group's name does not depend on)
  globalThis.window = { Run3DTheme, Run3DModel, Run3DReplay: R, RunProgress, Robots: { variantFor: () => 'default' } };
  globalThis.t = I18n.t;
  const m = new Module(path.join(RUN3D, 'hud.bundle.js'));
  m.require = requireFor;
  m._compile(out.outputFiles[0].text, m.id);
  hud = m.exports;
  return hud;
}

const T0 = Date.parse('2026-11-06T10:00:00.000Z');
const STEPS = [{ id: 'develop', type: 'agent', agent: 'developer' }, { id: 'pr_open', type: 'agent', agent: 'developer' }];
function events(lastGroup) {
  let seq = 0;
  const ev = (s, type, fields = {}) => ({ seq: ++seq, ts: new Date(T0 + s * 1000).toISOString(), run_id: 'run-1', type, ...fields });
  return [
    ev(0, 'workflow.started', { workflow: 'w', file: 'w.yaml', inputs: { task: 'x' }, steps: STEPS, groups: [{ name: 'Develop', steps: ['develop'] }, { name: lastGroup, steps: ['pr_open'] }] }),
    ev(1, 'step.started', { step_id: 'develop', visit: 1, step_type: 'agent' }),
  ];
}

// the names of the Pipeline's stations, as drawn, for a run whose last group is `lastGroup`
async function stationNames(t, language, lastGroup) {
  const h = await loadHud(t);
  if (!h) return null;
  I18n.setLanguage(language);
  t.after(() => I18n.setLanguage('en'));
  const player = new R.Run3DPlayer();
  player.add(events(lastGroup));
  h.begin({ player, root: null });
  t.after(() => h.end());
  const html = renderToStaticMarkup(React.createElement(h.Pipeline, { shown: null, onSelect: () => {} }));
  return [...html.matchAll(/<button[^>]*class="r3d-mile[^>]*>.*?<b>(.*?)<\/b>/g)].map((m) => m[1]);
}

test('#792 the 3D Pipeline shows a run that opens a pull request as Abrir PR, in Portuguese', async (t) => {
  const names = await stationNames(t, 'pt-BR', 'Open PR');
  if (names) assert.deepEqual(names, ['Desenvolver', 'Abrir PR']); // #36: Develop from the catalog too
});

test('#792 the 3D Pipeline shows it as Open PR, in English', async (t) => {
  const names = await stationNames(t, 'en', 'Open PR');
  if (names) assert.deepEqual(names, ['Develop', 'Open PR']);
});

test('#792 the 3D Pipeline keeps Merge for a local merge, in Portuguese too', async (t) => {
  const names = await stationNames(t, 'pt-BR', 'Merge');
  if (names) assert.deepEqual(names, ['Desenvolver', 'Merge']);
});
