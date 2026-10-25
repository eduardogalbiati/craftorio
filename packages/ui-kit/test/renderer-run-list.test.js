// packages/ui-kit/run-list.js: nestChildRuns and childRunBadges (#174), the run list's view of a
// `type: workflow` step's parent/child runs. The file has no module.exports (it runs as a global
// script in the renderer), so the two pure functions are pulled out and run in a sandbox, the way
// test/renderer-run-replay.test.js checks app.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'run-list.js'), 'utf8');

const PATTERNS = {
  nestChildRuns: /function nestChildRuns\(list\) \{[\s\S]*?\n\}/,
  childRunBadges: /function childRunBadges\(r\) \{[\s\S]*?\n\}/,
  groupArtifacts: /function groupArtifacts\(files\) \{[\s\S]*?\n\}/,
};

function loadHelpers() {
  const code = {};
  for (const [name, re] of Object.entries(PATTERNS)) {
    const m = re.exec(src);
    assert.ok(m, `${name} not found in run-list.js: the source moved`);
    code[name] = m[0];
  }
  const sandbox = { esc: (s) => s };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(Object.values(code).join('\n') + '\nthis.helpers = { nestChildRuns, childRunBadges, groupArtifacts };', sandbox);
  return sandbox.helpers;
}

const run = (id, extra = {}) => ({ runId: id, startedAt: '2026-09-27T10:00:00Z', ...extra });

test('nestChildRuns orders children by their item index right under their parent', () => {
  const { nestChildRuns } = loadHelpers();
  const parent = run('p1');
  const c1 = run('c1', { parentRun: { run_id: 'p1', index: 1 }, startedAt: '2026-09-27T10:00:01Z' });
  const c0 = run('c0', { parentRun: { run_id: 'p1', index: 0 }, startedAt: '2026-09-27T10:00:02Z' });
  const other = run('other');
  const out = nestChildRuns([other, parent, c1, c0]);
  assert.deepEqual(Array.from(out, (r) => r.runId), ['other', 'p1', 'c0', 'c1']);
  assert.equal(out.find((r) => r.runId === 'p1').nested, undefined);
  assert.equal(out.find((r) => r.runId === 'c0').nested, 1);
  assert.equal(out.find((r) => r.runId === 'c1').nested, 1);
});

test('nestChildRuns keeps an orphan child (its parent is not in the list) in place, unnested', () => {
  const { nestChildRuns } = loadHelpers();
  const orphan = run('c1', { parentRun: { run_id: 'missing-parent', index: 0 } });
  const other = run('other');
  const out = nestChildRuns([orphan, other]);
  assert.deepEqual(Array.from(out, (r) => r.runId), ['c1', 'other']);
  assert.equal(out[0].nested, undefined);
});

test('childRunBadges shows the parent badge with its item number, and the count of child runs with how many are running', () => {
  const { childRunBadges } = loadHelpers();
  const child = run('c1', { parentRun: { run_id: 'p1', workflow: 'child.yaml', step_id: 'child', index: 2 } });
  const childHtml = childRunBadges(child);
  assert.match(childHtml, /Started by run p1 \(child\.yaml\), step child/);
  assert.match(childHtml, /item 3/); // index 2 shown as "item 3" (1-based)

  const parent = run('p1', { childRuns: [{ run_id: 'c1', status: 'success' }, { run_id: 'c2', status: 'running' }] });
  const parentHtml = childRunBadges(parent);
  assert.match(parentHtml, /2 child runs/);
  assert.match(parentHtml, /1 running/);
});

test('childRunBadges is empty for a run with neither a parent nor child runs', () => {
  const { childRunBadges } = loadHelpers();
  assert.equal(childRunBadges(run('solo')), '');
});

// #200: groupArtifacts groups an open row's (or the Artifacts screen's) files for display.
const art = (step, location, name) => ({ step, location, name, rel: name });

test('groupArtifacts: steps come first, in the order they first appear, each keeping its files in order', () => {
  const { groupArtifacts } = loadHelpers();
  const files = [
    art('review', 'run', 'r1.md'),
    art('develop', 'run', 'd1.md'),
    art('review', 'run', 'r2.md'),
    art('develop', 'run', 'd2.md'),
  ];
  const groups = Array.from(groupArtifacts(files), ([label, group]) => [label, Array.from(group, (f) => f.name)]);
  assert.deepEqual(groups, [['review', ['r1.md', 'r2.md']], ['develop', ['d1.md', 'd2.md']]]);
});

test('groupArtifacts: a step-less file inside the run folder is "Other files", outside it (a project copy) is "Project copies", both after every step', () => {
  const { groupArtifacts } = loadHelpers();
  const files = [
    art(null, 'external', 'prd.md'),
    art('plan', 'run', 'plan.md'),
    art(null, 'run', 'notes.txt'),
  ];
  const labels = Array.from(groupArtifacts(files), ([label]) => label);
  assert.deepEqual(labels, ['plan', 'Other files', 'Project copies']);
});

// #437: a run card's title, next to its status pill, truncates with "…" and keeps its full text in a
// title (the hover). The row (runListRow) is rendered with the real StatusPill and run-meta.js
// (runTitleHtml), and style.css is cascaded onto it with test/css-layout.js (no browser here).
const { parseHtml, styleSheet, layoutOf, elements, textOf } = require('./css-layout.js');

const LONG_TITLE = 'Implementar o fluxo de pagamento com cartão salvo e reembolso parcial para pedidos antigos #437';

function runCardRow(r) {
  const fn = /function runListRow\(r, pv\) \{[\s\S]*?\n\}/.exec(src);
  const badges = [/function issueFallbackBadge\(r\) \{[\s\S]*?\n\}/.exec(src), PATTERNS.childRunBadges.exec(src)];
  assert.ok(fn && badges.every(Boolean), 'runListRow not found in run-list.js: the source moved');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const sandbox = {
    esc, console,
    state: { runMeta: new Map() },
    RunBadges: { defaultTitle: () => '', prBadgeHtml: () => '' },
    StatusPill: require('../status-pill.js'),
    stepName: (id) => String(id || ''), runProgressStrip: () => '',
    fmtDur: () => '1m', fmtTok: () => '10', fmtUsd: () => '$0.10', dateOf: (s) => String(s).slice(0, 10),
  };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'run-meta.js'), 'utf8'), sandbox);
  vm.runInContext(`${fn[0]}\n${badges.map((m) => m[0]).join('\n')}\nthis.runListRow = runListRow;`, sandbox);
  return String(sandbox.runListRow(r, { expanded: new Set(), id: null }));
}

function titleOfRunCard() {
  const html = runCardRow(run('r437', { title: LONG_TITLE, status: 'success', workflow: 'software-development.yaml', task: 'Implement it' }));
  const all = elements(parseHtml(`<div class="pr-list" style="width: 720px">${html}</div>`));
  const main = all.find((e) => e.classes.has('pr-main'));
  assert.ok(main, 'no .pr-main in the run card');
  // the elements inside .pr-main that show the title alone, innermost first
  const holders = all.filter((e) => textOf(e).trim() === LONG_TITLE).reverse();
  assert.ok(holders.length, 'the run card does not show its title alone in an element');
  return { all, main, holders };
}

test('#437 run card: the title next to the pill keeps its full text in a title (the hover)', () => {
  const { holders, main } = titleOfRunCard();
  const line = [];
  for (let e = holders[holders.length - 1]; e && e !== main; e = e.parent) line.push(e);
  assert.ok([...holders, ...line].some((e) => e.attrs.title === LONG_TITLE), 'no element around the run title carries title="<the full title>"');
});

test('#437 run card: the title truncates with "…" (overflow hidden, text-overflow: ellipsis, nowrap) inside .pr-main', () => {
  const { holders, main } = titleOfRunCard();
  const L = layoutOf(styleSheet(['style.css']));
  // the title text or an element around it, up to the line in .pr-main, ends in "…"
  const chain = [];
  for (let e = holders[0]; e && e !== main; e = e.parent) chain.push(e);
  const cut = chain.find((e) => L.truncates(e));
  assert.ok(cut, `the run title is not truncated: none of ${chain.map((e) => `<${e.tag} class="${e.attrs.class || ''}">`).join(' < ')} has overflow: hidden + text-overflow: ellipsis + white-space: nowrap on a non-inline box`);
  for (let e = cut; e !== main; e = e.parent) assert.ok(L.canShrink(e), `<${e.tag} class="${e.attrs.class || ''}"> cannot be narrower than its content (inline, or min-width: auto as a flex/grid item)`);
});

// #437: runTitleHtml (run-meta.js) also heads the Run screen's summary (views/run/run.js, the side
// column) and the run chat (views/runchat/runchat.js #rc-title): a long title that now stays on one
// line must end in "…" there too, not run past the header's box.
function runTitle437() {
  const sandbox = { esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]), console, state: { runMeta: new Map() }, RunBadges: { defaultTitle: () => '', prBadgeHtml: () => '' } };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'run-meta.js'), 'utf8'), sandbox);
  return String(sandbox.runTitleHtml(run('r437', { title: LONG_TITLE, workflow: 'software-development.yaml' })));
}

test('#437 the Run screen\'s summary: a long title stays inside the 260px side column (ends in "…")', () => {
  const html = `<aside class="panel config" style="width: 260px"><section><div class="run-summary"><div class="run-summary-name"><b>${runTitle437()}</b> <span class="pill pill-success">Sucesso</span></div></div></section></aside>`;
  const found = layoutOf(styleSheet(['style.css', 'views/run/run.css'])).overflows(elements(parseHtml(html))[0], 260);
  assert.deepEqual(found, [], `wider than their box:\n${found.join('\n')}`);
});

test('#437 the run chat\'s header: a long title stays inside a 420px header (ends in "…")', () => {
  const html = `<div id="rc-title" class="rc-title" style="width: 420px"><b>${runTitle437()}</b> <span class="muted small">software-development.yaml</span> <span class="muted small mono" data-testid="run-screen-id">20261021-233447-c7dbd4e7</span></div>`;
  const found = layoutOf(styleSheet(['style.css', 'views/runchat/runchat.css'])).overflows(elements(parseHtml(html))[0], 420);
  assert.deepEqual(found, [], `wider than their box:\n${found.join('\n')}`);
});
