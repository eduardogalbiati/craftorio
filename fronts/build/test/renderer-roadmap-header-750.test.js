// #750 The Roadmap header rebuilt in four bands: one card `rm-head` with, in order, the state and
// actions row (rm-head-row), four stat columns (rm-head-stats), the background-task band
// (rm-head-activity, only while something runs or warns) and the filters (rm-head-filters).
// Acceptance tests written before the code.
//
// Harness: fronts/build/views/backlog/backlog-roadmap.js whole in its vm sandbox
// (test/roadmap-status-helpers.js loadRoadmap), with what the page loads beside it: the terminal
// buttons (packages/ui-kit/term-dock.js termButtons), the base check card (backlog-live.js, #465) and
// the summary (packages/shared/roadmap-summary.js, #421). The seam is BacklogRoadmap.html(data,
// rerender, view) read as markup, and BacklogRoadmap.onClick for the menus. Interface language: the
// real catalogs, pt-BR unless a test says otherwise (I18n.setLanguage, back to English after).
//
// Assumed (chosen here):
// - the bands are elements whose class holds rm-head, rm-head-row, rm-head-stats, rm-head-activity,
//   rm-head-filters; a stat column is a direct child element of rm-head-stats whose visible text
//   nodes read [label, value, detail];
// - the coloured state pill carries data-testid="roadmap-state-pill"; its colour is a class word:
//   running/done success|green, paused warn|amber, paused by a failure error|danger|red|failed,
//   planned idle|muted|grey|gray|neutral;
// - the controls keep their data-rm ids (start = Iniciar/Retomar, pause, stop) and [data-rm-menu] (⋮);
//   Parar shows when RoadmapModel.allowedActions says stop (running or paused: today's rule), so a
//   planned or done roadmap has Iniciar and ⋮ only;
// - the Simulated choice (dev only) is an entry of the ⋮ menu while the roadmap can start or resume;
// - "Ver terminal" keeps the base check's terminal action: a button data-term="base-check" (the
//   action term-dock.js termAction runs today for "Live terminal"); the ↗ button is gone from the band;
// - the activity band also shows with no task when there is a warning line (known base failures,
//   the pause note): the design says those lines "use this band";
// - money in the stat columns follows the interface's locale: in English "$4,215.96", "≈ $301.71";
//   the pt-BR tests only read the digits of money.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./roadmap-status-helpers');

const ROOT = path.join(__dirname, '..', '..', '..');
const SUMMARY = ['..', '..', '..', 'packages', 'shared', 'roadmap-summary.js'];
const VIEW = { showAll: true, since: '24h' };

function load({ dev = false } = {}) {
  const out = H.loadRoadmap();
  out.sandbox.navigator = { platform: 'linux' };
  out.sandbox.api.platform = 'linux';
  out.sandbox.devMode = () => dev;
  vm.runInContext(H.read('term-dock.js'), out.sandbox);
  vm.runInContext(H.read('views', 'backlog', 'backlog-live.js'), out.sandbox);
  if (H.exists(...SUMMARY)) vm.runInContext(H.read(...SUMMARY), out.sandbox);
  return out;
}
// the interface language for one test (English again after it)
function lang(t, out, code) {
  out.sandbox.I18n.setLanguage(code);
  t.after(() => out.sandbox.I18n.setLanguage('en'));
}

const recent = H.iso(H.NOW - H.HOUR);
const est = (usd, minutes) => ({ usd, minutes, runs: 3, basis: 'From 3 past runs' });
const it = (id, status, n, extra = {}) => H.item(id, status, n, `Issue ${n}`, { origin: recent, ...extra });
const stage = (id, items, extra = {}) => ({ id, name: '', note: '', items, ...extra });

// The worked example: 6 stages (2 disabled); spent $4,000 + $215.96 = $4,215.96 on two done items;
// left: stage 3 ($100.50 / 60 min and $1.21 / 30 min: longest 60 min), stage 4 ($200 / 1035 min):
// 3 items in 2 stages, ≈ $301.71, ≈ 18 h 15 min. 5 enabled items (all shown), 2 in the disabled stages.
function example(roadmap = {}, extra = {}) {
  return {
    roadmap: {
      state: 'running',
      stages: [
        stage('st1', [it('i1', 'done', 1, { actualUsd: 4000 })]),
        stage('st2', [it('i2', 'done', 2, { actualUsd: 215.96 })]),
        stage('st3', [it('i3', 'planned', 3, { estimate: est(100.5, 60) }), it('i4', 'planned', 4, { estimate: est(1.21, 30) })]),
        stage('st4', [it('i5', 'planned', 5, { estimate: est(200, 1035) })]),
        stage('st5', [it('i6', 'planned', 6, { estimate: est(50, 50) })], { disabled: true }),
        stage('st6', [it('i7', 'planned', 7)], { disabled: true }),
      ],
      ...roadmap,
    },
    issues: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ number: n, title: `Issue ${n}`, labels: [] })),
    epics: [{ id: '#10', title: 'Auth', members: [1] }],
    ...extra,
  };
}
const BASE_CHECK = { status: 'running', commit: 'abcdef1234567890', startedAt: H.iso(H.NOW - 5 * H.MIN) };
const FAILURE = { test: 'cart totals include tax', file: 'test/cart.test.js', first_seen: recent, last_seen: recent, runs: ['r1'], issue: { url: 'https://github.com/o/r/issues/501' } };

// ---- markup readers (primitives only leave them) ----
const classes = (e) => String(e.attrs.class || '').split(/\s+/).filter(Boolean);
const hasClass = (e, c) => classes(e).includes(c);
const byClass = (html, c) => H.findAll(html, (e) => hasClass(e, c));
function headOf(html) {
  const heads = byClass(html, 'rm-head');
  assert.equal(heads.length, 1, 'one rm-head card');
  return heads[0].outer;
}
function band(html, c) {
  const el = byClass(headOf(html), c)[0];
  assert.ok(el, `a ${c} band inside rm-head`);
  return el.outer;
}
const bandCount = (html, c) => byClass(html, c).length;
// the direct child elements of the markup's first element (its outer html)
const children = (outer) => H.elements(outer).filter((e) => e.parent && e.parent.start === 0 && e.start > 0);
const stats = (html) => children(band(html, 'rm-head-stats')).map((e) => H.textNodes(e.inner));
const controlId = (e) => ('data-rm-menu' in e.attrs ? 'menu' : ['start', 'pause', 'stop'].includes(e.attrs['data-rm']) ? e.attrs['data-rm'] : null);
const controls = (row) => H.findAll(row, (e) => e.name === 'button' && controlId(e));
const html = (out, d, view = VIEW) => out.R.html(d, () => {}, view);

// ---------- the card and its bands ----------

test('#750 one rm-head card holds the bands in order: row, stats, activity (a task runs), filters', (t) => {
  const out = load();
  lang(t, out, 'pt-BR');
  const head = headOf(html(out, example({}, { baseCheck: BASE_CHECK })));
  const at = ['rm-head-row', 'rm-head-stats', 'rm-head-activity', 'rm-head-filters'].map((c) => byClass(head, c)[0]?.start ?? -1);
  assert.deepEqual(at.map((x) => x >= 0), [true, true, true, true], 'all four bands');
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in that order');
});

test('#750 the old bar is gone: no rm-bar row, no inline "Planejado ≈" sentence, nothing of it in the title row', (t) => {
  const out = load();
  lang(t, out, 'pt-BR');
  const page = html(out, example({}, { baseCheck: BASE_CHECK, baseFailures: [FAILURE] }));
  assert.equal(bandCount(page, 'rm-bar'), 0, 'no rm-bar element');
  assert.equal(/Planejado ≈/.test(H.visibleText(page)), false, 'no "Planejado ≈ $X · ≈ T" sentence');
  const row = band(page, 'rm-head-row');
  const inRow = ['roadmap-summary', 'roadmap-count', 'base-failures', 'base-check-card']
    .filter((id) => H.findEl(row, (e) => e.attrs['data-testid'] === id));
  assert.deepEqual(inRow, [], 'summary, counts, base failures and base check are not in the title row');
});

// ---------- band 1: state and actions ----------

const STATES = [
  ['running', { state: 'running' }, 'Rodando', /success|green/],
  ['paused', { state: 'paused' }, 'Pausado', /warn|amber/],
  ['paused by a failure', { state: 'paused', pausedBy: 'i3', error: 'Run run-42 failed: tests failed' }, 'Pausado por falha', /error|danger|red|failed/],
  ['planned', { state: 'planned' }, 'Planejado', /idle|muted|gr[ae]y|neutral/],
  ['done', { state: 'done' }, 'Concluído', /success|green/],
];

test('#750 band 1: the state dot, "Roadmap" and a coloured state pill for each of the five states (pt-BR)', (t) => {
  const out = load();
  lang(t, out, 'pt-BR');
  const got = STATES.map(([, r]) => {
    const row = band(html(out, example(r)), 'rm-head-row');
    const pill = H.findEl(row, (e) => e.attrs['data-testid'] === 'roadmap-state-pill');
    return [!!H.findEl(row, (e) => hasClass(e, 'rm-state-dot')), /\bRoadmap\b/.test(H.visibleText(row)), pill ? H.visibleText(pill.inner) : null, pill ? String(pill.attrs.class || '') : ''];
  });
  assert.deepEqual(got.map(([dot, title, text]) => [dot, title, text]), STATES.map(([, , label]) => [true, true, label]));
  STATES.forEach(([name, , , colour], k) => assert.match(got[k][3], colour, `${name}: pill class "${got[k][3]}"`));
});

test('#750 band 1: a stage run on its own keeps its scope badge, parked items their badge, both in the row', (t) => {
  const out = load();
  lang(t, out, 'pt-BR');
  const d = example({ state: 'running', scope: { stage: 'st3' } });
  d.roadmap.stages[3].items.push(it('i8', 'parked', 8));
  const row = band(html(out, d), 'rm-head-row');
  assert.match(H.visibleText(row), /só a etapa 3/);
  assert.ok(H.findEl(row, (e) => e.attrs['data-testid'] === 'roadmap-parked-count'), 'the parked badge');
});

test('#750 band 1: the controls per state, last in the row: running Pausar Parar ⋮, paused Retomar Parar ⋮, planned/done Iniciar ⋮', (t) => {
  const out = load();
  lang(t, out, 'pt-BR');
  const cases = [
    [{ state: 'running' }, ['pause', 'stop', 'menu'], 'Pausar Parar ⋮'],
    [{ state: 'paused' }, ['start', 'stop', 'menu'], 'Retomar Parar ⋮'],
    [{ state: 'planned' }, ['start', 'menu'], 'Iniciar ⋮'],
    [{ state: 'done' }, ['start', 'menu'], 'Iniciar ⋮'],
  ];
  const got = cases.map(([r]) => {
    const row = band(html(out, example(r)), 'rm-head-row');
    const list = controls(row);
    // from the first control to the end of the row: only the controls are read
    const tail = list.length ? H.visibleText(row.slice(list[0].start)) : '';
    return [list.map(controlId), tail];
  });
  assert.deepEqual(got, cases.map(([, ids, text]) => [ids, text]));
});

test('#750 band 1: Iniciar / Retomar is the primary button, Parar the red outline one', (t) => {
  const out = load();
  lang(t, out, 'pt-BR');
  const start = controls(band(html(out, example({ state: 'paused' })), 'rm-head-row')).find((e) => e.attrs['data-rm'] === 'start');
  const stop = controls(band(html(out, example({ state: 'paused' })), 'rm-head-row')).find((e) => e.attrs['data-rm'] === 'stop');
  assert.deepEqual([!!start && hasClass(start, 'primary'), !!stop && hasClass(stop, 'danger')], [true, true]);
});

test('#750 band 1: no Simulated checkbox in the row; in dev mode it is an entry of the ⋮ menu', async (t) => {
  const out = load({ dev: true });
  lang(t, out, 'pt-BR');
  const d = example({ state: 'planned' });
  const row = band(html(out, d), 'rm-head-row');
  assert.equal(!!H.findEl(row, (e) => e.attrs.id === 'rm-simulate' || (e.name === 'input' && e.attrs.type === 'checkbox')), false, 'no checkbox in band 1');
  assert.equal(/Simulado/.test(H.visibleText(row)), false, 'no "Simulado" label in band 1');
  const { ctx } = H.makeCtx();
  await out.R.onClick(H.clickOn(row, (e) => 'data-rm-menu' in e.attrs), ctx, d);
  const menu = H.findEl(html(out, d), (e) => e.attrs['data-testid'] === 'roadmap-menu');
  assert.ok(menu, 'the ⋮ menu opened');
  assert.match(H.visibleText(menu.inner), /Simulado/);
});

test('#750 band 1: Pausar keeps its menu (pause after this stage, or now)', async (t) => {
  const out = load();
  lang(t, out, 'pt-BR');
  const d = example({ state: 'running' });
  const { ctx } = H.makeCtx();
  await out.R.onClick(H.clickOn(band(html(out, d), 'rm-head-row'), (e) => e.attrs['data-rm'] === 'pause'), ctx, d);
  const row = band(html(out, d), 'rm-head-row');
  const menu = H.findEl(row, (e) => e.attrs['data-testid'] === 'roadmap-pause-menu');
  assert.ok(menu, 'the pause menu opens in band 1');
  assert.deepEqual(['roadmap-pause-after-stage', 'roadmap-pause-now'].map((id) => !!H.findEl(menu.outer, (e) => e.attrs['data-testid'] === id)), [true, true]);
});

// ---------- band 2: the four stats ----------

test('#750 stats (pt-BR): four columns Etapas, Falta, Previsão, Gasto with their values and details', (t) => {
  const out = load();
  lang(t, out, 'pt-BR');
  const cols = stats(html(out, example()));
  assert.equal(cols.length, 4, JSON.stringify(cols));
  assert.deepEqual(cols.map((c) => c[0]), ['Etapas', 'Falta', 'Previsão', 'Gasto']);
  assert.deepEqual(cols.map((c) => c.length), [3, 3, 3, 3], JSON.stringify(cols));
  assert.deepEqual([cols[0][1], cols[0][2]], ['6', '2 desativadas']);
  assert.deepEqual([cols[1][1], cols[1][2]], ['3 itens', 'em 2 etapas']);
  assert.match(cols[2][1], /^≈\s*18\s*h\s*15\s*min$/, cols[2][1]);
  assert.match(cols[2][2], /^≈\s*\D*301[.,]71\D*$/, cols[2][2]);
  assert.match(cols[3][1], /4[.,]215[.,]96/, cols[3][1]);
  assert.equal(cols[3][2], 'até agora');
});

test('#750 stats (English): money in the interface locale: spent "$4,215.96", planned "≈ $301.71"', () => {
  const out = load();
  const cols = stats(html(out, example()));
  assert.equal(cols.length, 4, JSON.stringify(cols));
  assert.equal(cols[3][1], '$4,215.96');
  assert.equal(cols[2][2], '≈ $301.71');
});

test('#750 stats: an unknown value (no estimate, nothing spent) reads "—" and the four columns stay', (t) => {
  const out = load();
  lang(t, out, 'pt-BR');
  const d = example({ stages: [stage('st1', [it('i1', 'planned', 1), it('i2', 'planned', 2)])] });
  const cols = stats(html(out, d));
  assert.equal(cols.length, 4, JSON.stringify(cols));
  assert.deepEqual(cols.map((c) => c[0]), ['Etapas', 'Falta', 'Previsão', 'Gasto']);
  assert.deepEqual([cols[2][1], cols[3][1]], ['—', '—'], JSON.stringify(cols));
});

// ---------- band 3: the background task ----------

test('#750 activity: while the base check runs, "Checagem da base", "desde HH:MM" and the short commit in <code>', (t) => {
  const out = load();
  lang(t, out, 'pt-BR');
  const act = band(html(out, example({}, { baseCheck: BASE_CHECK })), 'rm-head-activity');
  const text = H.visibleText(act);
  assert.match(text, /Checagem da base/);
  assert.match(text, /desde \d{2}:\d{2}/);
  const code = H.findEl(act, (e) => e.name === 'code');
  assert.ok(code, 'a <code> in the band');
  const commit = H.visibleText(code.outer.replace(/^<code[^>]*>|<\/code>$/g, ''));
  assert.ok(commit.length >= 7 && commit.length <= 12 && BASE_CHECK.commit.startsWith(commit), `short commit "${commit}"`);
});

test('#750 activity: "Ver terminal" opens the base check\'s log (data-term="base-check"); no "Live terminal", no ↗', (t) => {
  const out = load();
  lang(t, out, 'pt-BR');
  const act = band(html(out, example({}, { baseCheck: BASE_CHECK })), 'rm-head-activity');
  const buttons = H.findAll(act, (e) => e.name === 'button').map((e) => [H.visibleText(e.inner), e.attrs['data-term'] || '']);
  assert.deepEqual(buttons.filter(([label]) => label === 'Ver terminal'), [['Ver terminal', 'base-check']]);
  assert.equal(/Live terminal|↗/.test(H.visibleText(act)), false, H.visibleText(act));
});

test('#750 activity: with no task and no warning the band is absent (no rm-head-activity element)', (t) => {
  const out = load();
  lang(t, out, 'pt-BR');
  for (const extra of [{}, { baseCheck: null }, { baseFailures: [] }]) {
    const page = html(out, example({}, extra));
    headOf(page);
    assert.equal(bandCount(page, 'rm-head-activity'), 0, JSON.stringify(extra));
  }
});

// Assumption: a warning line alone (no task running) brings the band.
test('#750 activity: the known base failures are an amber line of the band, with their link', (t) => {
  const out = load();
  lang(t, out, 'pt-BR');
  const act = band(html(out, example({}, { baseFailures: [FAILURE] })), 'rm-head-activity');
  const line = H.findEl(act, (e) => e.attrs['data-testid'] === 'base-failures');
  assert.ok(line, 'base-failures inside rm-head-activity');
  assert.ok(H.findEl(line.outer, (e) => e.attrs['data-testid'] === 'base-failures-link'), 'its link');
  assert.ok(H.findEl(line.outer, (e) => /warn|amber/.test(String(e.attrs.class || ''))), 'an amber (warn) line');
});

test('#750 activity: the pause note (budget cap) is an amber line of the band with its buttons', (t) => {
  const out = load();
  lang(t, out, 'pt-BR');
  const d = example({ state: 'paused', error: 'Daily budget reached', budget: { period: 'day' } });
  const page = html(out, d);
  const act = band(page, 'rm-head-activity');
  const line = H.findEl(act, (e) => H.visibleText(e.inner).includes('Daily budget reached') && /warn|amber/.test(String(e.attrs.class || '')));
  assert.ok(line, 'an amber line with the pause note');
  assert.deepEqual(['budget-raise', 'budget-resume'].map((id) => !!H.findEl(act, (e) => e.attrs['data-rm'] === id)), [true, true]);
  assert.equal(H.visibleText(band(page, 'rm-head-row')).includes('Daily budget reached'), false, 'not in the title row');
});

// ---------- band 4: the filters ----------

test('#750 filters: By release, date range, Planejados | Todos and Group by epic on the left of the band', (t) => {
  const out = load();
  lang(t, out, 'pt-BR');
  const d = example();
  d.roadmap.stages[2].release = { name: '1.0.0' }; // a cut line: the By release choice shows
  const f = band(html(out, d), 'rm-head-filters');
  const has = (pred) => !!H.findEl(f, pred);
  assert.deepEqual([
    has((e) => ['roadmap-summary-by-release', 'roadmap-release-filter'].includes(e.attrs['data-testid'])),
    has((e) => 'data-rm-since' in e.attrs || e.attrs['data-testid'] === 'roadmap-date-filter'),
    has((e) => e.attrs['data-rm-view'] === 'planned') && has((e) => e.attrs['data-rm-view'] === 'all'),
    has((e) => 'data-rm-by-epic' in e.attrs),
  ], [true, true, true, true]);
});

test('#750 filters: on the right "5 de 5 itens" and a "2 desativadas à parte" link', (t) => {
  const out = load();
  lang(t, out, 'pt-BR');
  const f = band(html(out, example()), 'rm-head-filters');
  assert.match(H.visibleText(f), /\b5 de 5 itens\b/);
  const link = H.findEl(f, (e) => ['a', 'button'].includes(e.name) && /desativadas à parte/.test(H.visibleText(e.inner)));
  assert.ok(link, 'a link (button or a) reading "… desativadas à parte"');
  assert.match(H.visibleText(link.inner), /^2\b/);
});

test('#750 pt-BR: the header reads "Últimas 24h", never "last 24 hours"', (t) => {
  const out = load();
  lang(t, out, 'pt-BR');
  const text = H.visibleText(headOf(html(out, example())));
  assert.match(text, /Últimas 24h/);
  assert.equal(/last 24 hours/i.test(text), false, text);
});

test('#750 pt-BR: no English left in the header', (t) => {
  const out = load();
  lang(t, out, 'pt-BR');
  const d = example({}, { baseCheck: BASE_CHECK });
  d.roadmap.stages[2].release = { name: '1.0.0' };
  const text = H.visibleText(headOf(html(out, d)));
  const english = /\b(Running|Paused|Planned|All|Stages|Spent|Left|Forecast|items|stages|disabled|apart|since|so far|Live terminal|Last \d|last \d|Group by epic|By release|Next release|Base check|Simulated|Start|Resume|Pause|Stop)\b/;
  assert.equal(english.test(text), false, `English in "${text}": ${english.exec(text)?.[0]}`);
});

// ---------- the catalogs ----------

const catalog = (code) => JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', `${code}.json`), 'utf8'));
const values = (c) => Object.values(c).flatMap((v) => (v && typeof v === 'object' ? Object.values(v) : [v])).map(String);

test('#750 pt-BR catalog has the header\'s words as values', () => {
  const pt = values(catalog('pt-BR'));
  const words = ['Etapas', 'Falta', 'Previsão', 'Gasto', 'até agora', 'Ver terminal', 'Últimas 24h', 'desde'];
  assert.deepEqual(words.filter((w) => !pt.some((v) => v.includes(w))), []);
});

test('#750 every catalog key the roadmap view and its base check card use is in en.json and pt-BR.json', () => {
  const en = catalog('en');
  const pt = catalog('pt-BR');
  const src = ['backlog-roadmap.js', 'backlog-live.js'].map((f) => fs.readFileSync(path.join(ROOT, 'fronts', 'build', 'views', 'backlog', f), 'utf8')).join('\n');
  const keys = [...new Set([...src.matchAll(/\bt\(\s*'([a-z_]+\.[a-z0-9_]+)'/g)].map((m) => m[1]))];
  assert.ok(keys.length > 0);
  assert.deepEqual(keys.filter((k) => !(k in en) || !(k in pt)), []);
});

// ---------- narrow window ----------

test('#750 CSS: under ~900px the stats wrap two by two', () => {
  const css = fs.readFileSync(path.join(ROOT, 'fronts', 'build', 'views', 'backlog', 'backlog.css'), 'utf8');
  const blocks = [];
  for (const m of css.matchAll(/@media[^{]*max-width:\s*(\d+)px[^{]*\{/g)) {
    let depth = 1;
    let k = m.index + m[0].length;
    for (; k < css.length && depth; k++) depth += css[k] === '{' ? 1 : css[k] === '}' ? -1 : 0;
    blocks.push([Number(m[1]), css.slice(m.index + m[0].length, k)]);
  }
  const twoByTwo = blocks.filter(([px, body]) => px >= 860 && px <= 960
    && /\.rm-head-stats[^{]*\{[^}]*grid-template-columns:\s*(repeat\(\s*2\s*,|1fr\s+1fr\s*[;}])/.test(body));
  assert.equal(twoByTwo.length >= 1, true, 'a max-width 860-960px media query giving .rm-head-stats two columns');
});
