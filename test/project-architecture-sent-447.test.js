// #447 acceptance (and #435's "where it went" on screen): the Architecture tab's findings
// (src/renderer/views/project/project-architecture.js) and the Refactor tab's proposals
// (src/renderer/views/project/project-refactor.js) in a mini DOM, loaded as
// test/project-architecture-action-381.test.js loads them. After Send to Refactor the finding keeps
// the same button (`btn sm`), disabled, reading "Sent to Refactor", its title saying where it went;
// no "Sent to Refactor" badge; a link to the issue and its stage sits next to the button. The new /
// kept badges speak the interface language (pt-BR "novo" / "mantido").
// The service's answers carry where a sent finding went (architecture:report findings[].sentTo:
// { issue, issueUrl, stage, waiting }) and a proposal's waiting stage (refactor:proposals
// roadmapStage, roadmapWaiting). Test ids as features/steps/architecture.steps.js reads them:
// architecture-refactor-where (the link), architecture-finding-status (the new / kept badge),
// refactor-proposal-where (the Refactor tab's row).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const I18n = require('@multiagent/shared/i18n.js');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');
const { createDom } = require('./mini-dom');
const { buildModel } = require('@multiagent/shared/architecture-model');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const hash = '33'.repeat(20);
const ISSUE_URL = 'https://github.com/o/r/issues/432';
const FILES = [{ path: 'src/engine/run.js', lines: 100 }, { path: 'src/engine/queue.js', lines: 40 }];
const factsModel = () => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
});

const FINDINGS = [
  {
    kind: 'god-file', title: 'The run loop does too much.', severity: 'high', status: 'new', files: [{ path: 'src/engine/run.js', lines: '1-90' }],
    evidence: 'It changes in every commit.', refactor: 'Split the loop.',
    sent: true, sentTo: { issue: 432, issueUrl: ISSUE_URL, stage: 117, waiting: true },
  },
  {
    kind: 'duplicated-rule', title: 'The queue repeats the rule.', severity: 'medium', status: 'kept', files: [{ path: 'src/engine/queue.js' }],
    evidence: 'Two copies of the rule.', refactor: 'Keep one copy.', sent: false,
  },
];

function reportView() {
  return {
    report: { id: 'r1', date: '2026-10-20T10:00:00Z', head: { commit: hash }, simulated: true, report: { summary: 'A small engine.', areas: [], findings: FINDINGS.map(({ status, sent, sentTo, ...f }) => f) } },
    previousId: 'r0', gone: [], runsSince: 0, findings: FINDINGS,
  };
}

function sandboxOf(api) {
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {} }, sessionStorage: { getItem: () => null, setItem: () => {} },
    api, state: { projects: [{ id: 'p1', name: 'fixture', folder: 'C:/fixture' }], simulationOnly: true },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e), fmtNum: (n) => String(n), fmtUsd: (n) => `US$ ${n}`, showToast: () => {},
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = () => null;
  withI18n(sandbox);
  vm.createContext(sandbox);
  const box = dom.document.createElement('div');
  dom.document.body.appendChild(box);
  return { sandbox, box };
}

function loadArchitecture() {
  const api = {
    architectureFacts: async () => ({ state: 'ok', model: factsModel(), exclude: [], gate: [] }),
    architectureReport: async () => JSON.parse(JSON.stringify(reportView())),
    listArchitectureReports: async () => [],
    architectureEstimate: async () => ({ estimate: null }),
    architectureCity: async () => ({ state: 'not-git', model: null, validation: null }),
    chainEstimate: async () => null,
    startRun: async () => ({ runId: 'run-1' }),
    sendFindingToRefactor: async () => ({ proposal: {} }),
    onEvent: () => () => {},
  };
  const { sandbox, box } = sandboxOf(api);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'architecture-facts-view.js', 'city-model.js', 'city-layout.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  vm.runInContext(fs.readFileSync(path.join(RENDERER, 'date-range.js'), 'utf8'), sandbox, { filename: 'date-range.js' });
  for (const f of ['project-city-notes.js', 'project-city-cards.js', 'project-city.js', 'project-architecture.js']) {
    vm.runInContext(fs.readFileSync(path.join(RENDERER, 'views', 'project', f), 'utf8'), sandbox, { filename: f });
  }
  return { PA: sandbox.ProjectArchitecture, box };
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const q = (root, id) => root.querySelector(`[data-testid="${id}"]`);
const qa = (root, id) => Array.from(root.querySelectorAll(`[data-testid="${id}"]`));
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const classes = (el) => String(el?.getAttribute('class') || '').split(/\s+/).filter(Boolean);
const findingOf = (box, file) => qa(box, 'architecture-finding').find((el) => text(el).includes(file));
const badgeTexts = (row) => Array.from(row.querySelectorAll('.badge')).map(text);

async function openArchitecture(t, lang = 'en') {
  const was = I18n.getLanguage();
  I18n.setLanguage(lang);
  t.after(() => I18n.setLanguage(was));
  const w = loadArchitecture();
  w.PA.show('p1', w.box);
  await settle();
  return w;
}

test('#447 a sent finding keeps its button: btn sm, disabled, reading "Sent to Refactor"', async (t) => {
  const w = await openArchitecture(t);
  const row = findingOf(w.box, 'src/engine/run.js');
  const button = q(row, 'architecture-send-refactor');
  assert.equal(button?.localName, 'button');
  assert.equal(classes(button).includes('btn') && classes(button).includes('sm'), true, `classes: ${classes(button).join(' ')}`);
  assert.equal(button.disabled, true);
  assert.equal(text(button), 'Sent to Refactor');
});

test('#447 the sent button\'s title says where the finding went', async (t) => {
  const w = await openArchitecture(t);
  const button = q(findingOf(w.box, 'src/engine/run.js'), 'architecture-send-refactor');
  const title = String(button?.getAttribute('title') || '');
  assert.equal(title.includes('#432'), true, `title: ${title}`);
  assert.equal(title.includes('stage 117'), true, `title: ${title}`);
});

test('#447 no "Sent to Refactor" badge any more', async (t) => {
  const w = await openArchitecture(t);
  const row = findingOf(w.box, 'src/engine/run.js');
  const badges = Array.from(row.querySelectorAll('span.badge')).filter((el) => text(el) === 'Sent to Refactor');
  assert.equal(badges.length, 0);
});

test('#435 #447 a link next to the disabled button names the issue and the waiting stage', async (t) => {
  const w = await openArchitecture(t);
  const row = findingOf(w.box, 'src/engine/run.js');
  const button = q(row, 'architecture-send-refactor');
  const link = q(row, 'architecture-refactor-where');
  assert.equal(link?.localName, 'a');
  assert.equal(link.getAttribute('href'), ISSUE_URL);
  assert.equal(text(link).includes('#432 · stage 117, waiting for your OK'), true, `link: ${text(link)}`);
  assert.equal(link.parentNode === button.parentNode, true, 'the link sits next to the button');
});

test('#447 an unsent finding keeps its enabled Send to Refactor button and no link', async (t) => {
  const w = await openArchitecture(t);
  const row = findingOf(w.box, 'src/engine/queue.js');
  const button = q(row, 'architecture-send-refactor');
  assert.equal(button?.localName, 'button');
  assert.equal(button.disabled, false);
  assert.equal(text(button), 'Send to Refactor');
  assert.equal(q(row, 'architecture-refactor-where'), null);
});

test('#447 in pt-BR the new / kept badges read "novo" / "mantido" and the sent button "Enviado à Refatoração"', async (t) => {
  const w = await openArchitecture(t, 'pt-BR');
  assert.equal(text(q(findingOf(w.box, 'src/engine/run.js'), 'architecture-finding-status')), 'novo');
  assert.equal(text(q(findingOf(w.box, 'src/engine/queue.js'), 'architecture-finding-status')), 'mantido');
  const badges = [...badgeTexts(findingOf(w.box, 'src/engine/run.js')), ...badgeTexts(findingOf(w.box, 'src/engine/queue.js'))];
  assert.equal(badges.includes('new') || badges.includes('kept'), false, `badges: ${badges.join(' | ')}`);
  assert.equal(text(q(findingOf(w.box, 'src/engine/run.js'), 'architecture-send-refactor')), 'Enviado à Refatoração');
});

test('#435 the Refactor tab says per proposal its issue and its stage waiting for the owner', async (t) => {
  const was = I18n.getLanguage();
  I18n.setLanguage('en');
  t.after(() => I18n.setLanguage(was));
  const proposal = {
    id: 'architecture-1', source: 'architecture', status: 'proposed', title: 'The run loop does too much.', kind: 'god-file', files: [{ path: 'src/engine/run.js' }],
    issue: 432, issueUrl: ISSUE_URL, issueState: 'open', roadmapStatus: 'planned', roadmapStage: 117, roadmapWaiting: true, roadmapUnfinished: true, targetFiles: ['src/engine/run.js'],
  };
  const api = {
    refactorProposals: async () => [proposal],
    refactorCadence: async () => ({ on: false, every: 10, nextIn: 10, ready: false }),
    listArchitectureReports: async () => [{ id: 'r1', date: '2026-10-20T10:00:00Z' }],
  };
  const { sandbox, box } = sandboxOf(api);
  vm.runInContext(fs.readFileSync(path.join(RENDERER, 'views', 'project', 'project-refactor.js'), 'utf8'), sandbox, { filename: 'project-refactor.js' });
  sandbox.ProjectRefactor.show('p1', box);
  await settle();
  const where = text(q(q(box, 'refactor-proposal'), 'refactor-proposal-where'));
  assert.equal(where.includes('#432 · stage 117, waiting for your OK'), true, `where: ${where}`);
});
