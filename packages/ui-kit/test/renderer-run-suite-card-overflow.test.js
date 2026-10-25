// #443: text stays inside its card in narrow panels, the Run screen's suite card first. The suite
// card (views/run/run.js suiteCardsHtml) and the scratch workspace line under it (scratchHtml) are
// rendered in a vm sandbox (as test/renderer-suite-scope-304.test.js does) in pt-BR, with long test
// file paths, inside the side column's markup (aside.panel.config > section > .run-summary) 260px wide.
// No browser here: test/css-layout.js cascades style.css and views/run/run.css onto the markup and
// estimates which element comes out wider than its box (what scrollWidth > clientWidth catches), the
// way test/renderer-backlog-po-overflow.test.js reads the CSS that causes an overflow. A path ends in
// "…" with the whole path in its title, a reason wraps, the scope badge wraps or truncates, the log
// buttons wrap; the truncation of a path comes from a shared rule of style.css (#443 b).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pageDirs, pageFile, pageFiles } = require('../../../scripts/source-tree');
const PAGE_ROOT = path.join(__dirname, '..', '..', '..');
// a page file by its page-relative name, wherever its layer is (phase 3 of the reorganisation study)
const page = (rel) => pageFile(PAGE_ROOT, rel);
void pageDirs; void pageFiles; void page;
const vm = require('vm');
const I18n = require('@multiagent/shared/i18n.js');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');
const { displayName } = require('@multiagent/shared/display-name.js');
const { parseHtml, styleSheet, layoutOf, elements, textOf } = require('./css-layout.js');

const RUN_JS = page('views/run/run.js');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SHEETS = ['style.css', 'views/run/run.css'];
const COLUMN = 260; // px: a narrow side column

// long pt-BR text: test files whose paths have no break opportunity, reasons as prose
const LONG_PATH = 'features/checkout_e_pagamentos_com_cartao/versao_do_motor_de_execucao_e_rollback.feature';
const LONG_TEST = 'test/renderer_run_suite_card_overflow_guard_with_a_long_name.test.js';
const REASONS = {
  [LONG_PATH]: 'falhou na rodada 2 e continua falhando depois da correção do agente',
  [LONG_TEST]: 'listado pela verificação de aceitação desta execução',
};
const OUTPUT = {
  kind: 'suite', status: 'fail', round: 2, scope: 'full', log: 'logs/suite-2-full.log',
  selection: { mode: 'affected', files: Object.keys(REASONS), reasons: REASONS, why: 'os 2 arquivos de teste afetados falharam; a suíte inteira roda uma vez antes da mesclagem' },
  affected: { log: 'logs/suite-2.log', files: Object.keys(REASONS), passed: 3, failed: 1 },
};
const STEP_NAMES = { suite_affected: 'Suíte de aceitação afetada pela mudança' };

function withPtBr(t) {
  I18n.setLanguage('pt-BR');
  t.after(() => I18n.setLanguage('en'));
}

function loadRunParts() {
  const src = fs.readFileSync(RUN_JS, 'utf8');
  const parts = [
    /const SUITE_REASONS_SHOWN = [^\n]+/.exec(src),
    /function suiteCardsHtml\(runId, stepNames\) \{[\s\S]*?\n\}/.exec(src),
    /const scratchOfRun = new Map\(\);/.exec(src),
    /function scratchHtml\(runId\) \{[\s\S]*?\n\}/.exec(src),
  ];
  assert.ok(parts.every(Boolean), 'suiteCardsHtml / scratchHtml not found in views/run/run.js: the source moved');
  const sandbox = { esc, displayName, agentLabel: (slug, names) => displayName(slug, names), fmtSize: () => '924 KB', state: { runs: new Map() } };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(`${parts.map((m) => m[0]).join('\n')}\nthis.suiteCardsHtml = suiteCardsHtml; this.scratchHtml = scratchHtml; this.scratchOfRun = scratchOfRun;`, sandbox);
  return sandbox;
}

// the side column with the run's suite card and its scratch workspace line, parsed
function sideColumn() {
  const sb = loadRunParts();
  sb.state.runs.set('r1', { events: [{ type: 'step.finished', step_id: 'suite_affected', visit: 1, output: OUTPUT }] });
  sb.scratchOfRun.set('r1', { info: { dir: 'C:/Users/dev/multiagent-workspace/runs/20261021-233447-c7dbd4e7/scratch', files: 106, bytes: 946176 }, at: Date.now() });
  const card = String(sb.suiteCardsHtml('r1', STEP_NAMES));
  const scratch = String(sb.scratchHtml('r1'));
  assert.match(card, /data-testid="run-suite-card"/, 'no suite card rendered');
  assert.match(scratch, /run-scratch/, 'no scratch workspace line rendered');
  const doc = parseHtml(`<aside class="panel config" style="width: ${COLUMN}px"><section><div id="run-summary" class="run-summary">${card}${scratch}</div></section></aside>`);
  const all = elements(doc);
  return {
    aside: all.find((e) => e.tag === 'aside'),
    card: all.find((e) => e.attrs['data-testid'] === 'run-suite-card'),
    scratch: all.find((e) => e.classes.has('run-scratch')),
    all,
  };
}

// the element that shows `text` alone (the innermost one, then its ancestors with the same text)
function holdersOf(all, text) {
  return all.filter((e) => textOf(e).trim() === text);
}
const textNodes = (el) => (el.children || []).flatMap((c) => (c.text != null ? [c] : textNodes(c)));

test('#443 guard: in a 260px column, no element of the pt-BR suite card is wider than its box', (t) => {
  withPtBr(t);
  const { aside, card } = sideColumn();
  assert.ok(card, 'no suite card');
  const L = layoutOf(styleSheet(SHEETS));
  const found = L.overflows(aside, COLUMN).filter((x) => !/run-scratch/.test(x));
  assert.deepEqual(found, [], `wider than their box:\n${found.join('\n')}`);
});

test('#443 guard: in a 260px column, the scratch workspace line and its Open button are not wider than their box', (t) => {
  withPtBr(t);
  const { scratch } = sideColumn();
  const L = layoutOf(styleSheet(SHEETS));
  const found = L.overflows(scratch, COLUMN - 32); // the panel's padding
  assert.deepEqual(found, [], `wider than their box:\n${found.join('\n')}`);
});

test('#443 (a) the suite card\'s items (a grid) can shrink to the column: min-width 0 or minmax(0, 1fr)', (t) => {
  withPtBr(t);
  const { card } = sideColumn();
  const L = layoutOf(styleSheet(SHEETS));
  const rigid = card.children.filter((c) => c.tag && !L.canShrink(c)).map((c) => `<${c.tag} class="${c.attrs.class || ''}">`);
  assert.deepEqual(rigid, [], `card items with min-width: auto (they grow to their longest line):\n${rigid.join('\n')}`);
});

test('#443 (a) a test file path ends in "…" (overflow hidden, text-overflow: ellipsis, nowrap) and keeps the whole path in its title', (t) => {
  withPtBr(t);
  const { all, card } = sideColumn();
  const L = layoutOf(styleSheet(SHEETS));
  for (const file of [LONG_PATH, LONG_TEST]) {
    const holders = holdersOf(all, file);
    assert.ok(holders.length, `no element shows ${file} alone`);
    assert.ok(holders.some((e) => e.attrs.title === file), `${file}: no title with the whole path`);
    const cut = holders.find((e) => L.truncates(e));
    assert.ok(cut, `${file}: not truncated with "…" (overflow: hidden, text-overflow: ellipsis, white-space: nowrap on a non-inline box)`);
    for (let e = cut; e !== card; e = e.parent) assert.ok(L.canShrink(e), `${file}: <${e.tag} class="${e.attrs.class || ''}"> cannot be narrower than its content`);
  }
});

test('#443 (a) a file\'s reason wraps (prose), it is not cut on one line', (t) => {
  withPtBr(t);
  const { card } = sideColumn();
  const L = layoutOf(styleSheet(SHEETS));
  for (const why of Object.values(REASONS)) {
    const node = textNodes(card).find((n) => n.text.includes(why));
    assert.ok(node, `the reason "${why}" is not shown`);
    for (let e = node.parent; e !== card.parent; e = e.parent) {
      assert.notEqual(L.computed(e).wrap, 'nowrap', `the reason "${why}" sits in <${e.tag} class="${e.attrs.class || ''}"> with white-space: nowrap`);
    }
  }
});

test('#443 (a) the scope badge wraps or truncates with "…" and its title', (t) => {
  withPtBr(t);
  const { all } = sideColumn();
  const L = layoutOf(styleSheet(SHEETS));
  const badge = all.find((e) => e.attrs['data-testid'] === 'run-suite-scope');
  assert.ok(badge, 'no scope badge');
  assert.equal(textOf(badge).trim(), 'Testes afetados, depois a suíte inteira');
  const wraps = L.computed(badge).wrap !== 'nowrap';
  const cut = L.truncates(badge) && L.canShrink(badge) && !!badge.attrs.title;
  assert.ok(wraps || cut, 'the scope badge neither wraps nor truncates');
});

test('#443 (a) the log buttons\' row wraps (flex-wrap: wrap)', (t) => {
  withPtBr(t);
  const { all } = sideColumn();
  const L = layoutOf(styleSheet(SHEETS));
  const btn = all.find((e) => e.attrs['data-testid'] === 'run-suite-affected-log');
  assert.ok(btn, 'no log button');
  const row = btn.parent;
  const s = L.computed(row);
  assert.ok(!/flex/.test(s.display) || s.flexWrap === 'wrap', `the log buttons' row (${row.attrs.class}) is a flex row without flex-wrap: wrap`);
});

test('#443 (b) the path\'s "…" comes from a shared rule of style.css (long text in cards), not only from run.css', (t) => {
  withPtBr(t);
  const { all, card } = sideColumn();
  const L = layoutOf(styleSheet(['style.css']));
  const holders = holdersOf(all, LONG_PATH);
  assert.ok(holders.length, 'no element shows the path alone');
  assert.ok(holders.some((e) => L.truncates(e)), 'with style.css alone, the path is not truncated with "…": no shared rule for paths in cards');
  assert.ok(card, 'no suite card');
});
