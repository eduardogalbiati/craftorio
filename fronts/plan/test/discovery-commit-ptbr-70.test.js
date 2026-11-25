// #70 acceptance, written before the code: Discovery in the pt-BR interface. The commit dialog
// (fronts/plan/views/discovery/discovery-commit.js: where the issues go, its notes), the card's history
// ("Moved to Triagem", discovery.js versionLabel) and the Clarity section and Grill me's question still
// read in English beside Portuguese text. The board harness (./discovery-board-harness.js), its own I18n
// in pt-BR. The rubric's texts come from the real engine (a card made while the engine's interface
// language is pt-BR): the engine or the screen may translate them, the test reads what the panel shows.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');
const { layout } = require('@craftorio/engine/domains/workspace/workspace');
const discovery = require('@craftorio/engine/domains/discovery/discovery');
const { card, openBoard, settle } = require('./discovery-board-harness');

const tid = (id) => `[data-testid="${id}"]`;
test.afterEach(() => I18n.setLanguage('en'));

async function board(language, opts, { settings = {}, simulationOnly = true } = {}) {
  const page = await openBoard({ ...opts, api: { appInfo: () => ({ simulationOnly }), getSettings: () => settings, ...opts.api } });
  page.run(`I18n.setLanguage('${language}'); if (typeof I18n.notify === 'function') I18n.notify(); showView('discovery')`);
  await settle(20);
  return page;
}

// ---- the commit dialog --------------------------------------------------------------------------------

const REAL = { simulationOnly: false, settings: { developerMode: false } };
const PREVIEW = { simulationOnly: false, settings: { developerMode: true } };
const SIMULATED = { simulationOnly: true };
const WHERE = [
  ['a real filing', REAL, 'They are filed on the project\'s repository. The card then leaves the board for the Committed list and never comes back.'],
  ['a developer mode preview', PREVIEW, 'Developer mode: File the issues only previews the commands. Nothing is filed and the card stays in Ready.'],
  ['a simulation', SIMULATED, 'Simulation: they only join this workspace\'s backlog, nothing reaches GitHub or GitLab. The card then leaves the board for the Committed list and never comes back.'],
];
const ENGLISH_WHERE = /They are filed|project's repository|The card then|leaves the board|Committed list|never comes back|Developer mode:|File the issues|Nothing is filed|stays in|Simulation:|they only join|nothing reaches/i;

async function commitDialog(language, mode, proposal = {}, commit = null) {
  const ready = card({ title: 'Exportar em CSV', column: 'ready', clarity: 90 });
  const page = await board(language, {
    cards: [ready],
    api: {
      proposeDiscoveryCommit: async () => ({ split: { issues: [{ title: 'Exportar a tabela', tasks: ['Escrever o CSV'], complexity: 2, workflow: 'feature.yaml', reason: '' }] }, model: 'm', costUsd: 0, ...proposal }),
      commitDiscoveryCard: commit || (async () => ({ issues: [] })),
    },
  }, mode);
  const detail = await page.openCard(ready.id);
  detail.querySelector(tid('discovery-commit')).click();
  await settle(20);
  return { page, ready, what: page.text(page.$('#dsc-commit-what')), note: page.text(page.$(tid('discovery-commit-note'))) };
}

for (const [what, mode, english] of WHERE) {
  test(`#70 pt-BR: the commit dialog of ${what} says in Portuguese where the issues go`, { timeout: 30000 }, async () => {
    const out = await commitDialog('pt-BR', mode);
    assert.equal(ENGLISH_WHERE.test(out.what), false, out.what);
    assert.equal(out.what.includes(out.ready.title), true, out.what);
  });

  test(`#70 English unchanged: the commit dialog of ${what}`, { timeout: 30000 }, async () => {
    const out = await commitDialog('en', mode);
    assert.equal(out.what.includes(english), true, out.what);
  });
}

test('#70 pt-BR: a real filing, a preview and a simulation are told apart in the commit dialog', { timeout: 30000 }, async () => {
  const texts = [];
  for (const [, mode] of WHERE) {
    const { what, ready } = await commitDialog('pt-BR', mode);
    texts.push(what.replaceAll(ready.id, ''));
  }
  assert.equal(new Set(texts).size, 3);
});

test('#70 pt-BR: the commit dialog\'s note on a split by the rules reads in Portuguese, with the error', { timeout: 30000 }, async () => {
  const simulated = await commitDialog('pt-BR', SIMULATED, { model: 'simulated' });
  assert.notEqual(simulated.note, '');
  assert.equal(/Simulated|split by the rules|no model was called/.test(simulated.note), false, simulated.note);
  const fallback = await commitDialog('pt-BR', REAL, { fallback: 'HTTP 529 OVERLOADED' });
  assert.equal(/could not be asked|this is the split/.test(fallback.note), false, fallback.note);
  assert.equal(fallback.note.includes('HTTP 529 OVERLOADED'), true, fallback.note);
});

test('#70 pt-BR: the commit dialog\'s preview note reads in Portuguese, with the commands', { timeout: 30000 }, async () => {
  const { page } = await commitDialog('pt-BR', PREVIEW, {}, async () => ({ preview: true, commands: ['gh issue create --title X'] }));
  const { Event } = page.dom.classes;
  page.$('#dsc-commit-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle(30);
  const note = page.text(page.$(tid('discovery-commit-note')));
  assert.equal(note.includes('gh issue create --title X'), true, note);
  assert.equal(/developer mode|nothing was filed|The app would run/.test(note), false, note);
});

// what went wrong after the commit, told in the toast
async function toastAfter(language, out, { roadmap = false, api = {} } = {}) {
  const ready = card({ title: 'Exportar em CSV', column: 'ready', clarity: 90 });
  const page = await board(language, {
    cards: [ready],
    api: {
      proposeDiscoveryCommit: async () => ({ split: { issues: [{ title: 'Exportar a tabela', tasks: ['Escrever o CSV'], complexity: 2, workflow: 'feature.yaml', reason: '' }] }, model: 'm', costUsd: 0 }),
      commitDiscoveryCard: async () => ({ issues: [{ number: 101, title: 'Exportar a tabela', workflow: 'feature.yaml' }], card: { ...ready, column: 'committed' }, ...out }),
      ...api,
    },
  }, REAL);
  const detail = await page.openCard(ready.id);
  detail.querySelector(tid('discovery-commit')).click();
  await settle(20);
  page.$(tid('discovery-commit-roadmap')).checked = roadmap;
  const { Event } = page.dom.classes;
  page.$('#dsc-commit-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle(30);
  return page.text(page.$('#toast'));
}
const ENGLISH_PROBLEM = /Not filed|from the Backlog|Labels the|left out|backlog sync failed|Not planned|sync the backlog/i;
const PROBLEMS = [
  ['an issue not filed', { failed: [{ title: 'Documentar', error: 'HTTP 502' }] }, {}, ['Documentar', 'HTTP 502'], 'Not filed: Documentar (HTTP 502). File it from the Backlog.'],
  ['two issues not filed', { failed: [{ title: 'Documentar', error: 'HTTP 502' }, { title: 'Testar', error: 'x' }] }, {}, ['Documentar; Testar', 'HTTP 502'], 'Not filed: Documentar; Testar (HTTP 502). File them from the Backlog.'],
  ['labels left out', { skippedLabels: ['bug', 'area:ui'] }, {}, ['bug, area:ui'], 'Labels the repository does not have were left out: bug, area:ui.'],
  ['a failed sync, the roadmap waiting for it', { syncError: 'gh: offline' }, { roadmap: true }, ['gh: offline', 'roadmap'], 'The backlog sync failed: gh: offline Not planned in the roadmap: sync the backlog, then add the issues to it.'],
  ['a roadmap that refused them', {}, { roadmap: true, api: { proposeRoadmap: async () => { throw new Error('E-ROADMAP'); } } }, ['E-ROADMAP', 'roadmap'], 'Not planned in the roadmap: E-ROADMAP'],
];
for (const [what, out, opts, facts, english] of PROBLEMS) {
  test(`#70 after a commit, ${what}: told in the interface language, English unchanged`, { timeout: 30000 }, async () => {
    const pt = await toastAfter('pt-BR', out, opts);
    assert.equal(ENGLISH_PROBLEM.test(pt), false, pt);
    assert.deepEqual(['#101', ...facts].filter((f) => !pt.includes(f)), [], pt);
    // what was not planned is never also said to be planned
    assert.equal(/planned in the roadmap\./.test(pt), false, pt);
    const en = await toastAfter('en', out, opts);
    assert.equal(en.includes(english), true, en);
  });
}

// ---- the card's history -------------------------------------------------------------------------------

const REASONS = ['move-triage', 'move-shape', 'automation-shape', 'result-write-review', 'merge', 'before-automation', 'before-grill', 'before-restore', 'before-result'];
async function history(language) {
  const c = card({ title: 'Exportar', column: 'shape', document: 'agora' });
  const versions = REASONS.map((reason, n) => ({ name: `2026-11-${10 + n}T12-00-00-000Z-${reason}.md`, ts: `2026-11-${10 + n}T12:00:00.000Z`, reason }));
  const page = await board(language, { cards: [c], versions: { [c.id]: versions } });
  const detail = await page.openCard(c.id);
  const labels = detail.querySelectorAll('.dsc-version-label').map((el) => [REASONS.find((r) => String(el.getAttribute('title')).endsWith(`Z-${r}.md`)), page.text(el)]);
  assert.equal(labels.length, REASONS.length);
  return Object.fromEntries(labels);
}

test('#70 pt-BR: a move in the card\'s history reads in Portuguese, with the column\'s Portuguese title', { timeout: 30000 }, async () => {
  const labels = await history('pt-BR');
  assert.equal(/Moved|Triage\b/.test(labels['move-triage']), false, labels['move-triage']);
  assert.match(labels['move-triage'], /Triagem/);
  assert.equal(/Moved|Shape/.test(labels['move-shape']), false, labels['move-shape']);
  assert.match(labels['move-shape'], /Modelagem/);
});

test('#70 pt-BR: the other lines of the card\'s history are not in English', { timeout: 30000 }, async () => {
  const labels = await history('pt-BR');
  const english = Object.entries(labels).filter(([r]) => !r.startsWith('move-')).filter(([, l]) => /\b(Before|result|automation|answer|restore|run's|Shape)\b/.test(l)).map(([r, l]) => `${r}: ${l}`);
  assert.deepEqual(english, []);
  assert.match(labels['result-write-review'], /Write & Review/);
  assert.equal(new Set(Object.values(labels)).size, REASONS.length, 'each line says something else');
});

test('#70 English unchanged: the card\'s history', { timeout: 30000 }, async () => {
  assert.deepEqual(await history('en'), {
    'move-triage': 'Moved to Triage',
    'move-shape': 'Moved to Shape',
    'automation-shape': 'Shape automation result',
    'result-write-review': 'Write & Review result',
    merge: 'Before a merge',
    'before-automation': 'Before an automation\'s result',
    'before-grill': 'Before a Grill me answer',
    'before-restore': 'Before a restore',
    'before-result': 'Before a run\'s result',
  });
});

// ---- the rubric and Grill me --------------------------------------------------------------------------

async function grilled(t, language, type) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-70-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = layout(root).discovery;
  I18n.setLanguage(language);
  const { id } = discovery.createCard(dir, 'p1', { title: 'Exportar', type, column: 'triage' });
  discovery.grillCard(dir, 'p1', id);
  const c = discovery.readCard(dir, 'p1', id);
  const page = await board(language, { cards: [c], threads: { [id]: discovery.readConversation(dir, 'p1', id) } });
  const detail = await page.openCard(id);
  return {
    scored: page.text(detail.querySelector(tid('clarity-scored'))),
    missing: detail.querySelectorAll(`${tid('clarity-missing')} li`).map((li) => page.text(li)),
    thread: page.text(detail.querySelector(tid('card-thread'))),
  };
}
const ENGLISH_RUBRIC = /Problem:|\bGoal:|Users:|Steps to reproduce|Observed:|Expected:|\bScope:|Non-goals|Alternatives considered|Acceptance criteria|Success metrics|Decisions:|Open questions|Dependencies:|Evidence:|\bwhat\b|\bwho\b|\bwhich\b|\bhow\b|nothing verifiable/i;

for (const [type, points] of [['idea', 9], ['bug', 12], ['prd', 11], ['rfc', 10]]) {
  test(`#70 pt-BR: the points a ${type} still misses read in Portuguese, one line each`, { timeout: 30000 }, async (t) => {
    const { missing } = await grilled(t, 'pt-BR', type);
    assert.equal(missing.length, points);
    assert.deepEqual(missing.filter((m) => ENGLISH_RUBRIC.test(m)), []);
    assert.equal(new Set(missing).size, points);
  });
}

test('#70 pt-BR: the card does not name who scored it "Clarity rubric"', { timeout: 30000 }, async (t) => {
  const { scored } = await grilled(t, 'pt-BR', 'idea');
  assert.notEqual(scored, '');
  assert.equal(/Clarity rubric/i.test(scored), false, scored);
});

test('#70 pt-BR: Grill me\'s question reads in Portuguese in the card\'s thread', { timeout: 30000 }, async (t) => {
  const { thread } = await grilled(t, 'pt-BR', 'idea');
  assert.match(thread, /\?/);
  assert.equal(/Problem:|What is wrong|who feels it/i.test(thread), false, thread);
});

test('#70 English unchanged: the panel shows the rubric, the gaps and the question', { timeout: 30000 }, async (t) => {
  const { scored, missing, thread } = await grilled(t, 'en', 'idea');
  assert.match(scored, /Clarity rubric/);
  assert.equal(missing[0], 'Problem: what is wrong or missing today, and for whom');
  assert.equal(thread.includes('Problem: What is wrong or missing today, and who feels it?'), true, thread);
});
