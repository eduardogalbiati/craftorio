// #732: "Analyze this project" (fronts/analyser/views/project/project-architecture.js) on a project the
// onboarding just made. The action read the folder from the renderer's cached Projects list
// (state.projects), which the onboarding does not refresh, so a project with a folder got "The project
// has no folder: there is nothing to analyse.". Now:
// - the folder is the project's own: a project absent from state.projects, or there without its folder,
//   whose project page holds it (state.pv.project, as the Overview reads it) starts the analyze-project
//   run on that folder; a fresh api.listProjects at the click wins (a folder with exists: false is none);
// - a project really without a folder gets a translated message (pt-BR "O projeto não tem pasta nesta
//   máquina…", saying to clone again or point the folder from the Overview), in both catalogs, and no
//   cost estimate ("≈ US$") next to the "Analyze again" of that error.
// Loaded as project-architecture-action-381.test.js loads the tab (a vm sandbox with the mini DOM); #730: the
// action lives in the City tab's notes (project-city-analyze), no Facts / City switch any more.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const I18n = require('@craftorio/shared/i18n.js');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');
const { createDom } = require('@craftorio/ui-kit/test/mini-dom');
const { buildModel } = require('@craftorio/shared/architecture-model');
const { buildCity } = require('@craftorio/shared/city-model');

const ROOT = path.join(__dirname, '..', '..', '..');
const CATALOGS = path.join(ROOT, 'packages', 'shared', 'i18n');
const hash = '11'.repeat(20);
const FOLDER = 'C:/fixture';
const FILES = [{ path: 'src/engine/run.js', lines: 100 }, { path: 'src/engine/queue.js', lines: 40 }];
const factsModel = () => buildModel({
  head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
});

// projects: state.projects (the cached list); pvProject: the project page's own project (state.pv.project);
// fresh: what a fresh read of the project answers (api.getProject); apiExtra: more of the api (e.g. a
// listProjects the action reads fresh at the click)
function loadWindow({ projects, pvProject, fresh = pvProject, estimate = { usd: 0.4, basis: 3 }, apiExtra = {} }) {
  const calls = { startRun: [] };
  const api = {
    architectureFacts: async () => ({ state: 'ok', model: factsModel(), exclude: [], gate: [] }),
    architectureReport: async () => ({ report: null, findings: [], gone: [], runsSince: 0 }),
    listArchitectureReports: async () => [],
    architectureEstimate: async () => ({ estimate }),
    architectureCity: async () => ({ state: 'ok', ...buildCity({ plan: null, facts: factsModel() }), refresh: { suggested: false, unmatchedShare: 0, newFolders: [] }, mapRun: null }),
    chainEstimate: async () => null,
    getProject: async (id) => (fresh && fresh.id === id ? JSON.parse(JSON.stringify(fresh)) : null),
    startRun: async (spec) => { calls.startRun.push(spec); return { runId: 'run-1' }; },
    onEvent: () => () => {},
    ...apiExtra,
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {} }, sessionStorage: { getItem: () => null, setItem: () => {} },
    api,
    state: { projects, pv: pvProject ? { id: pvProject.id, project: pvProject, tab: 'architecture' } : null, view: 'project', simulationOnly: true },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e), fmtNum: (n) => String(n), fmtUsd: (n) => `US$ ${n}`, showToast: () => {},
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = () => null;
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'architecture-facts-view.js', 'city-model.js', 'city-layout.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  vm.runInContext(fs.readFileSync(pageFileOf('date-range.js'), 'utf8'), sandbox, { filename: 'date-range.js' });
  for (const f of ['project-city-notes.js', 'project-city-cards.js', 'project-city.js', 'project-architecture.js']) {
    vm.runInContext(fs.readFileSync(pageFileOf(`views/project/${f}`), 'utf8'), sandbox, { filename: f });
  }
  dom.document.addEventListener('click', (e) => sandbox.ProjectArchitecture.onClick(e));
  const box = dom.document.createElement('div');
  dom.document.body.appendChild(box);
  const click = (el) => el.dispatchEvent(new dom.classes.MouseEvent('click', { bubbles: true, cancelable: true }));
  const cachedFolders = () => JSON.stringify((sandbox.state.projects || []).map((p) => [p.id, p.folder ?? null]));
  return { PA: sandbox.ProjectArchitecture, box, calls, click, cachedFolders };
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const q = (box, id) => box.querySelector(`[data-testid="${id}"]`);
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const OLD_MESSAGE = 'The project has no folder: there is nothing to analyse.';

function inLanguage(t, lang) {
  const was = I18n.getLanguage();
  I18n.setLanguage(lang);
  t.after(() => I18n.setLanguage(was));
}

async function analyzeFacts(w) {
  w.PA.show('p1', w.box);
  await settle();
  w.click(q(w.box, 'project-city-analyze'));
  await settle();
}

function assertStartedOnFolder(w) {
  assert.equal(text(q(w.box, 'project-city-analysis-error')).includes(OLD_MESSAGE), false, 'not the "no folder" error');
  assert.equal(q(w.box, 'project-city-analysis-error') === null, true, 'no error at all');
  assert.equal(w.calls.startRun.length, 1, 'the analyze-project run is started');
  const [spec] = w.calls.startRun;
  assert.equal(spec.file, 'analyze-project.yaml');
  assert.equal(spec.inputs.repo_path, FOLDER, 'on the project\'s folder');
  assert.equal(spec.inputs.project_id, 'p1');
}

const WITH_FOLDER = { id: 'p1', name: 'fixture', folder: FOLDER };
const NO_FOLDER = { id: 'p1', name: 'fixture', folder: null };

test('#732 a project absent from the cached Projects list (just made by the onboarding) is analysed on its own folder', async (t) => {
  inLanguage(t, 'en');
  const w = loadWindow({ projects: [], pvProject: { ...WITH_FOLDER } });
  await analyzeFacts(w);
  assertStartedOnFolder(w);
});

test('#732 a project in the cached list without its folder (cached before the clone) is analysed on the folder the project has now', async (t) => {
  inLanguage(t, 'en');
  const w = loadWindow({ projects: [{ ...NO_FOLDER }], pvProject: { ...WITH_FOLDER } });
  await analyzeFacts(w);
  assertStartedOnFolder(w);
});

test('#732 the City view\'s "Analyze this project" finds the folder the same way', async (t) => {
  inLanguage(t, 'en');
  const w = loadWindow({ projects: [{ ...NO_FOLDER }], pvProject: { ...WITH_FOLDER } });
  w.PA.show('p1', w.box);
  await settle();
  w.click(q(w.box, 'project-city-analyze'));
  await settle();
  assert.equal(q(w.box, 'project-city-analysis-error') === null, true, 'no "no folder" error on the city');
  assert.equal(w.calls.startRun.length, 1);
  assert.equal(w.calls.startRun[0].inputs.repo_path, FOLDER);
});

// the catalog key of the "no folder on this machine" message: found by its pt-BR text, which starts with the
// sentence (#725's onboarding.job_failed_no_folder, "Falhou: o projeto não tem pasta…", is another message)
function noFolderKey() {
  const pt = JSON.parse(fs.readFileSync(path.join(CATALOGS, 'pt-BR.json'), 'utf8'));
  const key = Object.keys(pt).find((k) => /^O projeto não tem pasta nesta máquina/.test(String(pt[k])));
  return { key: key || null, pt };
}

test('#732 both catalogs carry the "no folder on this machine" message, pt-BR translated', () => {
  const { key, pt } = noFolderKey();
  assert.equal(typeof key, 'string', 'a pt-BR value reads "…não tem pasta nesta máquina…"');
  assert.match(String(pt[key]), /^O projeto não tem pasta nesta máquina/);
  assert.match(String(pt[key]), /Visão geral|clon/i, 'it says what to do: clone again or point the folder from the Overview');
  const en = JSON.parse(fs.readFileSync(path.join(CATALOGS, 'en.json'), 'utf8'));
  assert.equal(typeof en[key], 'string', `en.json has ${key}`);
  assert.notEqual(en[key], pt[key], 'the pt-BR text is not the English one');
  assert.match(en[key], /folder/i);
});

test('#732 a project really without a folder: pt-BR says "O projeto não tem pasta nesta máquina" and what to do; nothing starts', async (t) => {
  inLanguage(t, 'pt-BR');
  const w = loadWindow({ projects: [{ ...NO_FOLDER }], pvProject: { ...NO_FOLDER } });
  await analyzeFacts(w);
  const error = text(q(w.box, 'project-city-analysis-error'));
  assert.match(error, /O projeto não tem pasta nesta máquina/);
  assert.match(error, /Visão geral|clon/i, 'says what to do');
  assert.equal(error.includes(OLD_MESSAGE), false, 'not the old English sentence');
  assert.equal(w.calls.startRun.length, 0, 'no run without a folder');
});

test('#732 a project without a folder in English: the message comes from the catalog, not the old sentence', async (t) => {
  inLanguage(t, 'en');
  const { key } = noFolderKey();
  const w = loadWindow({ projects: [], pvProject: { ...NO_FOLDER } });
  await analyzeFacts(w);
  const error = text(q(w.box, 'project-city-analysis-error'));
  assert.equal(error.includes(OLD_MESSAGE), false, 'not the old hard-coded sentence');
  assert.equal(typeof key, 'string', 'the message has a catalog key');
  assert.equal(error.includes(I18n.t(key)), true, 'the English catalog text is shown');
  assert.equal(w.calls.startRun.length, 0);
});

test('#732 the "no folder" error on the City view shows no cost estimate next to "Analyze again"', async (t) => {
  inLanguage(t, 'pt-BR');
  const w = loadWindow({ projects: [{ ...NO_FOLDER }], pvProject: { ...NO_FOLDER }, estimate: { usd: 0.4, basis: 3 } });
  w.PA.show('p1', w.box);
  await settle();
  w.click(q(w.box, 'project-city-analyze'));
  await settle();
  const card = text(q(w.box, 'project-city-analysis-error'));
  assert.match(card, /pasta nesta máquina/, 'the error card shows the translated message');
  assert.equal(/≈\s*US\$/.test(card), false, 'no "≈ US$" estimate next to the retry of a folder error');
  assert.equal(w.calls.startRun.length, 0);
});

// --- review round 1: the fresh read at the click (api.listProjects) ---

test('#732 the fresh project list says the folder is gone from this machine (exists: false): translated message, no run, no estimate', async (t) => {
  inLanguage(t, 'pt-BR');
  const gone = { ...WITH_FOLDER, exists: false };
  const w = loadWindow({
    projects: [{ ...WITH_FOLDER }], pvProject: { ...WITH_FOLDER },
    apiExtra: { listProjects: async () => [JSON.parse(JSON.stringify(gone))] },
  });
  w.PA.show('p1', w.box);
  await settle();
  w.click(q(w.box, 'project-city-analyze'));
  await settle();
  const card = text(q(w.box, 'project-city-analysis-error'));
  assert.match(card, /O projeto não tem pasta nesta máquina/, 'the fresh read wins over the cached copies that still hold the folder');
  assert.equal(/≈\s*US\$/.test(card), false, 'no estimate next to the retry');
  assert.equal(w.calls.startRun.length, 0, 'no run on a folder that is gone');
});

test('#732 the fresh project list gives the folder the cached copies lack: the run starts on it and state.projects is updated', async (t) => {
  inLanguage(t, 'en');
  const w = loadWindow({
    projects: [], pvProject: { ...NO_FOLDER },
    apiExtra: { listProjects: async () => [{ ...WITH_FOLDER, exists: true }] },
  });
  await analyzeFacts(w);
  assertStartedOnFolder(w);
  assert.equal(w.cachedFolders(), JSON.stringify([['p1', FOLDER]]), 'state.projects holds the fresh list');
});

test('#732 when the fresh read fails, the project page\'s own project gives the folder', async (t) => {
  inLanguage(t, 'en');
  const w = loadWindow({
    projects: [], pvProject: { ...WITH_FOLDER },
    apiExtra: { listProjects: async () => { throw new Error('ipc down'); } },
  });
  await analyzeFacts(w);
  assertStartedOnFolder(w);
});

test('#732 a "no folder" error is cleared, and the estimate comes back, when an analysis run starts from elsewhere', async (t) => {
  inLanguage(t, 'en');
  const w = loadWindow({ projects: [{ ...NO_FOLDER }], pvProject: { ...NO_FOLDER } });
  await analyzeFacts(w);
  assert.equal(q(w.box, 'project-city-analysis-error') === null, false, 'the "no folder" error is shown');
  assert.equal(w.box.querySelector('.pc-estimate') === null, true, 'no estimate next to the action while that error stands');
  w.PA.onRunEvent({ type: 'workflow.started', run_id: 'run-ext', project_id: 'p1', workflow: 'analyze-project' });
  await settle();
  assert.equal(q(w.box, 'project-city-analysis-error') === null, true, 'the error is gone once a run started');
  w.PA.onRunEvent({ type: 'workflow.finished', run_id: 'run-ext', status: 'success' });
  await settle();
  assert.equal(q(w.box, 'project-city-analysis-error') === null, true, 'no error after the run');
  assert.match(text(w.box.querySelector('.pc-estimate')), /US\$/, 'the estimate is back next to the action');
});
