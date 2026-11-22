// #730 acceptance: a project's Health tab (Saúde), written before the code, in a mini DOM as
// project-architecture-sent-447.test.js loads the Architecture tab. Health shows, on top, the git facts
// (architecture:facts) and below them the Oracle's latest report (its summary, the verdict per area) and
// its findings, the report picker as today, and an action to run the Oracle's report again with its
// estimate (architecture:estimate). No Facts / City switch. A finding becomes an issue: "Create issue"
// and "Create issue and prioritize" per finding, "Create issues" for the findings shown (the filters'
// selection, as "Send all to Refactor" sent the ones shown); once filed the finding shows its issue's
// link (and its roadmap stage when prioritized) instead of the buttons. A finding's existing Refactor
// proposal stays readable under it. No "Send to Refactor" any more.
//
// The contract assumed here (new seams of #730):
// - the view: window.ProjectHealth with show(projectId, box), onClick(e) and onChange(e) (routed from the
//   project page's listeners as ProjectArchitecture's are), in one of the page's views/project/ scripts
//   (this file loads every views/project/ script index.html lists, except project.js);
// - api.createFindingIssue(projectId, reportId, findingIndex, { prioritize }) (channel
//   architecture:createIssue) → { filed: { issue, issueUrl, stage, waiting } };
// - architecture:report's findings[] carry `filed` ({ issue, issueUrl, stage, waiting } or null) and
//   `proposal` (the finding's existing Refactor proposal { id, title, status, issue, issueUrl } or null);
// - test ids kept: architecture-facts, architecture-report, architecture-report-summary,
//   architecture-finding, architecture-filter-<key>, architecture-report-picker; new:
//   architecture-create-issue, architecture-create-issue-prioritize, architecture-create-issues,
//   architecture-finding-issue (the issue's link), architecture-finding-stage (its roadmap stage),
//   architecture-finding-proposal (the existing proposal), architecture-rerun-report (run the Oracle's
//   report again) with architecture-rerun-estimate inside or next to it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const I18n = require('@craftorio/shared/i18n.js');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');
const { createDom } = require('@craftorio/ui-kit/test/mini-dom');
const { pageScripts, scriptFile } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { buildModel } = require('@craftorio/shared/architecture-model');

const hash = '44'.repeat(20);
const URL_OF = (n) => `https://github.com/o/r/issues/${n}`;
const FILES = [{ path: 'src/engine/run.js', lines: 100 }, { path: 'src/engine/queue.js', lines: 40 }, { path: 'src/ui/menu.js', lines: 30 }];
const factsModel = () => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
});

const SUMMARY = 'A small engine with a busy run loop.';
const AREAS = [{ area: 'Engine', verdict: 'Stable core with small units.' }, { area: 'UI', verdict: 'Thin and tidy.' }];
// 0: high, not filed; 1: medium, not filed; 2: low, filed and prioritized
const FINDINGS = [
  { kind: 'god-file', title: 'The run loop does too much.', severity: 'high', status: 'new', files: [{ path: 'src/engine/run.js', lines: '1-90' }], evidence: 'It changes in every commit.', refactor: 'Split the loop.', filed: null, proposal: null },
  { kind: 'duplicated-rule', title: 'The queue repeats the rule.', severity: 'medium', status: 'kept', files: [{ path: 'src/engine/queue.js' }], evidence: 'Two copies of the rule.', refactor: 'Keep one copy.', filed: null, proposal: null },
  { kind: 'naming', title: 'The menu names are unclear.', severity: 'low', status: 'new', files: [{ path: 'src/ui/menu.js' }], evidence: 'Names like m1, m2.', refactor: 'Name them.', filed: { issue: 432, issueUrl: URL_OF(432), stage: 117, waiting: true }, proposal: null },
];
const REPORTS = [{ id: 'r1', date: '2026-10-20T10:00:00Z', findings: 3, simulated: true }, { id: 'r0', date: '2026-10-01T10:00:00Z', findings: 2, simulated: true }];

// the shared modules and the page's project scripts the views/project/ views use, as index.html lists them
const SHARED = /\/packages\/shared\/(globs|json-schema|architecture-[\w-]+|city-[\w-]+|findings-model|code-complexity)\.js$/;
function projectScripts() {
  return pageScripts().filter((name) => SHARED.test(name) || name === 'date-range.js' || (name.startsWith('views/project/') && name !== 'views/project/project.js'));
}

// `gate`: a promise createFindingIssue waits for before answering (an issue still being created)
function healthWindow({ findings = FINDINGS, estimate = { usd: 0.5, basis: 2 }, gate = null } = {}) {
  const calls = { create: [], analyze: [], startRun: [], report: [] };
  const filed = new Map(findings.map((f, i) => [i, f.filed]));
  const view = () => ({
    report: { id: 'r1', date: '2026-10-20T10:00:00Z', head: { commit: hash }, simulated: true, report: { summary: SUMMARY, areas: AREAS, findings: findings.map(({ status, filed: _f, proposal, ...f }) => f) } },
    previousId: 'r0', gone: [], runsSince: 0, running: null,
    findings: findings.map((f, i) => ({ ...f, filed: filed.get(i) || null, sent: false, sentTo: null })),
  });
  const api = {
    architectureFacts: async () => ({ state: 'ok', model: factsModel(), exclude: [], gate: [] }),
    architectureReport: async (projectId, opts) => { calls.report.push(opts?.reportId ?? null); return JSON.parse(JSON.stringify(view())); },
    listArchitectureReports: async () => JSON.parse(JSON.stringify(REPORTS)),
    architectureEstimate: async () => ({ estimate }),
    architectureCity: async () => ({ state: 'not-git', model: null, validation: null }),
    chainEstimate: async () => null,
    refactorProposals: async () => [],
    listProjects: async () => [{ id: 'p1', name: 'fixture', folder: 'C:/fixture', exists: true }],
    analyzeArchitecture: async (projectId) => { calls.analyze.push(String(projectId)); return { report: null }; },
    startRun: async (o) => { calls.startRun.push(o); return { runId: 'run-1' }; },
    createFindingIssue: async (projectId, reportId, findingIndex, opts) => {
      calls.create.push({ projectId: String(projectId), reportId: String(reportId), findingIndex: Number(findingIndex), prioritize: !!opts?.prioritize });
      const n = 500 + calls.create.length;
      if (gate) await gate;
      const out = { issue: n, issueUrl: URL_OF(n), stage: opts?.prioritize ? 4 : null, waiting: !!opts?.prioritize };
      filed.set(Number(findingIndex), out);
      return { filed: out };
    },
    onEvent: () => () => {},
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }), requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: (h) => clearTimeout(h),
    localStorage: { getItem: () => null, setItem: () => {} }, sessionStorage: { getItem: () => null, setItem: () => {} },
    api, state: { projects: [{ id: 'p1', name: 'fixture', folder: 'C:/fixture', exists: true }], simulationOnly: true, pv: { id: 'p1', project: { id: 'p1', folder: 'C:/fixture' } } },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e), fmtNum: (n) => String(n), fmtUsd: (n) => `US$ ${n}`, showToast: () => {}, openProjectView: () => {},
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = () => null;
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const name of projectScripts()) vm.runInContext(fs.readFileSync(scriptFile(name), 'utf8'), sandbox, { filename: path.basename(name) });
  const PH = sandbox.ProjectHealth;
  assert.equal(typeof PH?.show, 'function', 'window.ProjectHealth.show(projectId, box)');
  dom.document.addEventListener('click', (e) => sandbox.ProjectHealth.onClick(e));
  const box = dom.document.createElement('div');
  dom.document.body.appendChild(box);
  const click = (el) => el.dispatchEvent(new dom.classes.MouseEvent('click', { bubbles: true, cancelable: true }));
  return { PH, box, calls, click };
}

const settle = async () => { for (let i = 0; i < 15; i++) await new Promise((r) => setImmediate(r)); };
const q = (root, id) => root?.querySelector(`[data-testid="${id}"]`) || null;
const has = (root, id) => q(root, id) !== null;
const qa = (root, id) => Array.from(root?.querySelectorAll(`[data-testid="${id}"]`) || []);
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const findingOf = (box, file) => qa(box, 'architecture-finding').find((el) => text(el).includes(file)) || null;

async function openHealth(t, opts, lang = 'en') {
  const was = I18n.getLanguage();
  I18n.setLanguage(lang);
  t.after(() => I18n.setLanguage(was));
  const w = healthWindow(opts);
  w.PH.show('p1', w.box);
  await settle();
  return w;
}

// ---- the layout -------------------------------------------------------------------------------------

test('#730 Health shows the git facts on top and the Oracle\'s report below them', async (t) => {
  const w = await openHealth(t);
  const order = Array.from(w.box.querySelectorAll('[data-testid]')).map((el) => el.getAttribute('data-testid'));
  const facts = order.indexOf('architecture-facts');
  const report = order.indexOf('architecture-report');
  assert.equal(facts >= 0, true, 'the git facts (data-testid="architecture-facts")');
  assert.equal(report >= 0, true, 'the Oracle\'s report (data-testid="architecture-report")');
  assert.equal(facts < report, true, `the facts come first: facts at ${facts}, report at ${report}`);
});

test('#730 Health\'s report shows its summary and the verdict per area', async (t) => {
  const w = await openHealth(t);
  assert.equal(text(q(w.box, 'architecture-report-summary')), SUMMARY);
  const report = text(q(w.box, 'architecture-report'));
  for (const s of ['Engine', 'Stable core with small units.', 'UI', 'Thin and tidy.']) assert.equal(report.includes(s), true, `the report shows "${s}": ${report}`);
});

test('#730 Health has no Facts / City switch', async (t) => {
  const w = await openHealth(t);
  assert.equal(has(w.box, 'architecture-mode-facts'), false);
  assert.equal(has(w.box, 'architecture-mode-city'), false);
  assert.equal(w.box.querySelectorAll('[data-arch-mode]').length, 0);
});

test('#730 Health keeps the report picker: picking another report reads it', async (t) => {
  const w = await openHealth(t);
  const picker = q(w.box, 'architecture-report-picker');
  assert.equal(picker === null, false, 'the report picker');
  picker.value = 'r0';
  w.PH.onChange({ target: picker });
  await settle();
  assert.equal(w.calls.report.at(-1), 'r0');
});

test('#730 Health has an action to run the Oracle\'s report again, with its estimate', async (t) => {
  const w = await openHealth(t);
  const rerun = q(w.box, 'architecture-rerun-report');
  assert.equal(rerun?.localName, 'button', 'data-testid="architecture-rerun-report" is a button');
  assert.equal(rerun.disabled, false);
  const estimate = q(w.box, 'architecture-rerun-estimate');
  assert.equal(text(estimate).includes('0.50'), true, `the Oracle's estimate (US$ 0.50): "${text(estimate)}"`);
  w.click(rerun);
  await settle();
  const started = [...w.calls.analyze, ...w.calls.startRun.map((o) => String(o?.projectId ?? o?.inputs?.project_id))];
  assert.deepEqual(started, ['p1'], 'one report run for the project');
});

// ---- a finding becomes an issue -----------------------------------------------------------------------

test('#730 each finding not filed has "Create issue" and "Create issue and prioritize", and no "Send to Refactor"', async (t) => {
  const w = await openHealth(t);
  for (const file of ['src/engine/run.js', 'src/engine/queue.js']) {
    const row = findingOf(w.box, file);
    const create = q(row, 'architecture-create-issue');
    const prioritize = q(row, 'architecture-create-issue-prioritize');
    assert.equal(create?.localName, 'button', `${file}: Create issue`);
    assert.equal(text(create), 'Create issue');
    assert.equal(create.disabled, false);
    assert.equal(prioritize?.localName, 'button', `${file}: Create issue and prioritize`);
    assert.equal(text(prioritize), 'Create issue and prioritize');
    assert.equal(prioritize.disabled, false);
  }
  assert.equal(qa(w.box, 'architecture-send-refactor').length, 0, 'no Send to Refactor button');
  assert.equal(has(w.box, 'architecture-send-all'), false,'no Send all to Refactor');
  assert.equal(text(w.box).includes('Send to Refactor'), false);
});

test('#730 Create issue files the finding\'s issue (not prioritized), then the finding shows the issue\'s link instead of the buttons', async (t) => {
  const w = await openHealth(t);
  w.click(q(findingOf(w.box, 'src/engine/run.js'), 'architecture-create-issue'));
  await settle();
  assert.deepEqual(w.calls.create, [{ projectId: 'p1', reportId: 'r1', findingIndex: 0, prioritize: false }]);
  const row = findingOf(w.box, 'src/engine/run.js');
  const link = q(row, 'architecture-finding-issue');
  assert.equal(link?.localName, 'a', 'the issue\'s link');
  assert.equal(link.getAttribute('href'), URL_OF(501));
  assert.equal(text(link).includes('#501'), true, `the link: ${text(link)}`);
  assert.equal(has(row, 'architecture-create-issue'), false, 'no Create issue any more');
  assert.equal(has(row, 'architecture-create-issue-prioritize'), false, 'no Create issue and prioritize any more');
  assert.equal(has(row, 'architecture-finding-stage'), false,'not prioritized: no roadmap stage');
});

test('#730 Create issue and prioritize files and plans it, then the finding shows the issue\'s link and its roadmap stage', async (t) => {
  const w = await openHealth(t);
  w.click(q(findingOf(w.box, 'src/engine/queue.js'), 'architecture-create-issue-prioritize'));
  await settle();
  assert.deepEqual(w.calls.create, [{ projectId: 'p1', reportId: 'r1', findingIndex: 1, prioritize: true }]);
  const row = findingOf(w.box, 'src/engine/queue.js');
  assert.equal(q(row, 'architecture-finding-issue')?.getAttribute('href'), URL_OF(501));
  assert.equal(text(q(row, 'architecture-finding-stage')).includes('4'), true, `the stage: ${text(q(row, 'architecture-finding-stage'))}`);
  assert.equal(has(row, 'architecture-create-issue'), false);
  assert.equal(has(row, 'architecture-create-issue-prioritize'), false);
});

test('#730 while an issue is being created the finding buttons are disabled and more clicks file nothing more', async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const w = await openHealth(t, { gate });
  const run = () => findingOf(w.box, 'src/engine/run.js');
  const queue = () => findingOf(w.box, 'src/engine/queue.js');
  w.click(q(run(), 'architecture-create-issue'));
  await settle();
  assert.equal(q(run(), 'architecture-create-issue')?.disabled, true, 'Create issue is disabled while the issue is being created');
  assert.equal(q(run(), 'architecture-create-issue-prioritize')?.disabled, true, 'so is Create issue and prioritize');
  assert.equal(q(queue(), 'architecture-create-issue')?.disabled, true, 'and the other finding\'s buttons');
  assert.equal(q(w.box, 'architecture-create-issues')?.disabled, true, 'and Create issues');
  w.click(q(run(), 'architecture-create-issue'));
  w.click(q(run(), 'architecture-create-issue-prioritize'));
  w.click(q(queue(), 'architecture-create-issue'));
  w.click(q(w.box, 'architecture-create-issues'));
  release();
  await settle();
  assert.deepEqual(w.calls.create, [{ projectId: 'p1', reportId: 'r1', findingIndex: 0, prioritize: false }], 'one issue, for the first click only');
  assert.equal(q(run(), 'architecture-finding-issue')?.getAttribute('href'), URL_OF(501));
  assert.equal(q(queue(), 'architecture-create-issue')?.disabled, false, 'the other finding can be filed again afterwards');
});

test('#730 a finding already filed and prioritized shows its issue\'s link and its stage, no buttons', async (t) => {
  const w = await openHealth(t);
  const row = findingOf(w.box, 'src/ui/menu.js');
  const link = q(row, 'architecture-finding-issue');
  assert.equal(link?.getAttribute('href'), URL_OF(432));
  assert.equal(text(link).includes('#432'), true, `the link: ${text(link)}`);
  assert.equal(text(q(row, 'architecture-finding-stage')).includes('117'), true, `the stage: ${text(q(row, 'architecture-finding-stage'))}`);
  assert.equal(has(row, 'architecture-create-issue'), false);
  assert.equal(has(row, 'architecture-create-issue-prioritize'), false);
});

test('#730 "Create issues" files an issue for each finding shown and not filed yet, none prioritized', async (t) => {
  const w = await openHealth(t);
  const all = q(w.box, 'architecture-create-issues');
  assert.equal(all?.localName, 'button', 'data-testid="architecture-create-issues"');
  assert.equal(text(all), 'Create issues');
  w.click(all);
  await settle();
  const indexes = w.calls.create.map((c) => c.findingIndex).sort();
  assert.deepEqual(indexes, [0, 1], 'the two findings not filed; the filed one is not filed again');
  assert.equal(w.calls.create.some((c) => c.prioritize), false, 'none prioritized');
});

test('#730 "Create issues" follows the selection: with the High filter it files the high finding only', async (t) => {
  const w = await openHealth(t);
  w.click(q(w.box, 'architecture-filter-high'));
  await settle();
  w.click(q(w.box, 'architecture-create-issues'));
  await settle();
  assert.deepEqual(w.calls.create.map((c) => c.findingIndex), [0]);
});

test('#730 a finding\'s existing Refactor proposal stays readable under it', async (t) => {
  const proposal = { id: 'architecture-1', title: 'Split the run loop in two.', status: 'proposed', issue: 77, issueUrl: URL_OF(77) };
  const findings = FINDINGS.map((f, i) => (i === 0 ? { ...f, proposal } : f));
  const w = await openHealth(t, { findings });
  const shown = q(findingOf(w.box, 'src/engine/run.js'), 'architecture-finding-proposal');
  assert.equal(shown !== null, true, 'data-testid="architecture-finding-proposal" inside the finding');
  assert.equal(text(shown).includes('Split the run loop in two.'), true, `the proposal: ${text(shown)}`);
  assert.equal(has(findingOf(w.box, 'src/engine/queue.js'), 'architecture-finding-proposal'), false,'none under a finding without one');
});

test('#730 in pt-BR the finding\'s actions are translated', async (t) => {
  const w = await openHealth(t, undefined, 'pt-BR');
  const row = findingOf(w.box, 'src/engine/run.js');
  const labels = [text(q(row, 'architecture-create-issue')), text(q(row, 'architecture-create-issue-prioritize')), text(q(w.box, 'architecture-create-issues'))];
  for (const [label, en] of labels.map((l, i) => [l, ['Create issue', 'Create issue and prioritize', 'Create issues'][i]])) {
    assert.equal(label.length > 0 && label !== en, true, `translated, not "${en}": "${label}"`);
  }
});
