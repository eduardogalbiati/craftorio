// #117: the run's 3D HUD (run3d/hud.jsx) with a Codex agent that has no price: its agent row, its step's
// cost and the Supervisor's cost read "unknown" ("desconhecido" in pt-BR), the cost card of a run mixing
// priced and unpriced turns reads "≈ $x (partial)", and a run with no price at all reads "unknown" with
// no $/M. Bundled in memory and rendered on the server as run3d-unknown-cost-72.test.js does.
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
const T0 = Date.parse('2026-11-27T10:00:00.000Z');
const NO_COST = { cost_usd: null };

test.afterEach(() => I18n.setLanguage('en'));

// develop (Claude) costs `dev`; review (Codex, no price) and a Supervisor call on it have no cost
function events(dev) {
  let seq = 0;
  const ev = (s, type, fields = {}) => ({ seq: ++seq, ts: new Date(T0 + s * 1000).toISOString(), run_id: 'run-117', type, ...fields });
  const steps = [{ id: 'develop', type: 'agent', agent: 'developer' }, { id: 'review', type: 'agent', agent: 'reviewer' }];
  const turn = (s, session, step, fields) => [
    ev(s, 'session.message_sent', { session_id: session, step_id: step, turn: 1 }),
    ev(s + 5, 'session.message_received', { session_id: session, step_id: step, turn: 1, text: 'done', usage: { input: 1000, output: 100 }, ...fields }),
  ];
  return [
    ev(0, 'workflow.started', { workflow: 'w', file: 'w.yaml', inputs: { task: 'x' }, steps, groups: [{ name: 'Develop', steps: ['develop', 'review'] }] }),
    ev(1, 'session.opened', { session_id: 's-dev', session: { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' } }),
    ev(1, 'session.opened', { session_id: 's-rev', session: { agent: 'reviewer', provider: 'codex', model: 'gpt-6-luna' } }),
    ev(1, 'session.opened', { session_id: 's-sup', session: { agent: 'supervisor', provider: 'codex', model: 'gpt-6-luna' } }),
    ev(2, 'step.started', { step_id: 'develop', visit: 1, step_type: 'agent' }),
    ...turn(3, 's-dev', 'develop', dev),
    ev(10, 'step.started', { step_id: 'review', visit: 1, step_type: 'agent' }),
    ...turn(11, 's-rev', 'review', NO_COST),
    ...turn(20, 's-sup', 'review:supervisor', NO_COST),
  ];
}

// a server render needs a snapshot of its own; the List starts on its agents tab
const reactStub = {
  ...React,
  useSyncExternalStore: (subscribe, get) => React.useSyncExternalStore(subscribe, get, get),
  useState: (init) => (init === 'steps' ? ['agents', () => {}] : React.useState(init)),
};
function requireFor(id) {
  if (id === 'react') return reactStub;
  if (id === '@react-three/fiber') return { invalidate: () => {} };
  return require(id);
}

async function hud(t, dev) {
  let esbuild;
  try { esbuild = require('esbuild'); } catch { t.skip('esbuild is not installed'); return null; }
  const out = await esbuild.build({
    stdin: { contents: "export { Kpis, Detail, List } from './hud.jsx'; export { begin, end } from './view.js';", resolveDir: RUN3D, loader: 'js' },
    bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', loader: { '.jsx': 'jsx' },
    external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@react-three/*'], logLevel: 'silent',
  });
  globalThis.window = { Run3DTheme, Run3DModel, Run3DReplay: R, RunProgress, Robots: { variantFor: () => 'default', plaqueFor: (m) => m, svg: () => '' } };
  globalThis.t = I18n.t;
  const m = new Module(path.join(RUN3D, 'hud117.bundle.js'));
  m.require = requireFor;
  m._compile(out.outputFiles[0].text, m.id);
  const player = new R.Run3DPlayer();
  player.add(events(dev));
  m.exports.begin({ player, root: null });
  t.after(() => m.exports.end());
  const render = (name, props = {}) => renderToStaticMarkup(React.createElement(m.exports[name], props));
  return { render };
}

const visible = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const between = (html, testid) => visible((new RegExp(`data-testid="${testid}"[^>]*>(.*?)</(b|em)>`).exec(html) || [])[1] || '');
// the <dd> after a Detail panel's "Cost" <dt>
const detailCost = (html) => {
  const rows = [...html.matchAll(/<dt[^>]*>(.*?)<\/dt>\s*<dd[^>]*>(.*?)<\/dd>/g)];
  const row = rows.find((x) => visible(x[1]) === I18n.t('run3d.cost'));
  return row ? visible(row[2]) : '';
};
// the agents tab's row of an agent label: its cost is the last <small>
const agentRowCost = (html, label) => {
  const row = [...html.matchAll(/<button[^>]*class="r3d-row[^"]*"[^>]*>(.*?)<\/button>/g)].map((x) => x[1]).find((x) => visible(x).includes(label));
  return row ? visible([...row.matchAll(/<small[^>]*>(.*?)<\/small>/g)].at(-1)[1]) : null;
};

for (const [lang, word, partial] of [['en', /unknown/i, /partial/i], ['pt-BR', /desconhecido/i, /parcial/i]]) {
  test(`#117 3D HUD (${lang}): a mixed run's cost card reads "≈ $x (${lang === 'en' ? 'partial' : 'parcial'})"`, async (t) => {
    I18n.setLanguage(lang);
    const h = await hud(t, { cost_usd: 0.93 });
    if (!h) return;
    const kpis = h.render('Kpis');
    const card = /data-testid="run3d-card-cost".*?<b>(.*?)<\/b>/.exec(kpis)[1];
    assert.match(card, /^≈ .*0[.,]93/);
    assert.match(card, partial);
  });

  test(`#117 3D HUD (${lang}): the Codex agent with no price, its step and the Supervisor read unknown`, async (t) => {
    I18n.setLanguage(lang);
    const h = await hud(t, { cost_usd: 0.93 });
    if (!h) return;
    const step = detailCost(h.render('Detail', { shown: 'review', onOpenGate: () => {}, canAnswer: false }));
    assert.match(step, word);
    assert.doesNotMatch(step, /\$/);
    const sup = detailCost(h.render('Detail', { shown: 'supervisor', onOpenGate: () => {}, canAnswer: false }));
    assert.match(sup, word);
    assert.doesNotMatch(sup, /\$/);
    const list = h.render('List', { shown: null, onSelect: () => {}, query: '' });
    const reviewer = agentRowCost(list, 'gpt-6-luna');
    assert.notEqual(reviewer, null, 'the agents tab lists the Codex agent');
    assert.match(reviewer, word);
    assert.doesNotMatch(reviewer, /\$/);
  });
}

test('#117 3D HUD: a run with no price at all reads unknown and has no $/M', async (t) => {
  const h = await hud(t, NO_COST);
  if (!h) return;
  const kpis = h.render('Kpis');
  const card = visible(/data-testid="run3d-card-cost".*?<b>(.*?)<\/b>/.exec(kpis)[1]);
  assert.match(card, /unknown/i);
  assert.doesNotMatch(card, /\$/);
  assert.equal(between(kpis, 'run3d-cost-per-m'), '—');
});
