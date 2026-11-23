// #36 acceptance, written before the code: the refactor stage waiting for the owner's OK (#435) was always named
// "Refactor (waiting for your OK)" (packages/engine/domains/refactor/refactor-cadence.js WAITING_SUFFIX), whatever the
// interface language. Expected: a waiting stage created while the interface is pt-BR is named
// "Refactor (aguardando seu OK)"; in English it keeps its name; enabling a waiting stage still drops the suffix, in
// both languages and for a stage created before the change (the English suffix), whatever the interface is now.
//
// The interface language reaches the service through Settings › General › Language › Interface (settings:set
// { language: { interface } }, packages/engine/service/areas/interface-language.js sets the shared I18n), the way the
// app changes it. The stage is created through "Create issue and prioritize" (architecture:createIssue with
// prioritize), with the setup of refactor-waiting-stage-435.test.js (makeService, simulation only, a fake filer);
// enabling goes through packages/engine/domains/roadmap/roadmap.js cleanStages (the roadmap's save).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');
const arch = require('@craftorio/engine/domains/oracle/oracle-architecture');
const roadmaps = require('@craftorio/engine/domains/roadmap/roadmap');
const { makeService, gitRepo, roadmapIssue } = require('@craftorio/engine/test/service/helpers');

const PT_NAME = 'Refactor (aguardando seu OK)';
const EN_NAME = 'Refactor (waiting for your OK)';

test.afterEach(() => I18n.setLanguage('en'));

async function setup(t, lang) {
  let next = 432;
  const fileIssue = async () => { const number = next++; return { number, url: `https://github.com/o/r/issues/${number}` }; };
  const { service, api } = makeService(t, { fileIssue });
  const ws = service.workspace();
  const { dir } = gitRepo(t);
  const p = await api['projects:create']({ name: 'demo', folder: dir });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [5, 432, 433].map(roadmapIssue) }));
  api['settings:set']({ language: { interface: lang } });
  assert.equal(I18n.getLanguage(), lang, `the interface is ${lang}`);
  const reportId = arch.saveReport(path.join(ws.root, 'architecture'), p.id, {
    date: '2026-10-20T10:00:00.000Z', head: null, branch: 'main', costUsd: 0, simulated: true,
    report: { summary: 'A small project.', areas: [], findings: [{ kind: 'god-file', title: 'god-file in a.txt', severity: 'high', files: [{ path: 'a.txt' }], evidence: 'Evidence', refactor: 'Split a.txt' }] },
  }).id;
  await api['architecture:createIssue']({ projectId: p.id, reportId, findingIndex: 0, prioritize: true });
  return roadmaps.readRoadmap(ws.backlog, p.id);
}
const disabledNames = (r) => r.stages.filter((s) => s.disabled).map((s) => s.name);

test('#36 pt-BR: the waiting refactor stage is named "Refactor (aguardando seu OK)"', async (t) => {
  assert.deepEqual(disabledNames(await setup(t, 'pt-BR')), [PT_NAME]);
});

test('#36 English unchanged: the waiting refactor stage is named "Refactor (waiting for your OK)"', async (t) => {
  assert.deepEqual(disabledNames(await setup(t, 'en')), [EN_NAME]);
});

// ---- enabling drops the suffix --------------------------------------------------------------------------------
const item = (id, number) => ({ id, workflow: 'refactor.yaml', number, title: `Issue ${number}`, status: 'planned', files: [] });
const waitingRoadmap = (name) => ({ stages: [{ id: 's1', name: 'One', items: [item('i1', 1)] }, { id: 'sw', name, disabled: true, waiting: true, items: [item('i2', 2)] }] });
function enable(name) {
  const previous = waitingRoadmap(name);
  const saved = roadmaps.cleanStages(previous.stages.map((s) => (s.id === 'sw' ? { ...s, disabled: false } : s)), { previous });
  return saved.find((s) => s.id === 'sw').name;
}

test('#36 pt-BR: enabling a stage named "Refactor (aguardando seu OK)" names it "Refactor"', () => {
  I18n.setLanguage('pt-BR');
  assert.equal(enable(PT_NAME), 'Refactor');
});

test('#36 English interface: enabling a stage created in pt-BR also drops "(aguardando seu OK)"', () => {
  I18n.setLanguage('en');
  assert.equal(enable(PT_NAME), 'Refactor');
});

test('#36 pt-BR interface: a stage created before the change ("Refactor (waiting for your OK)") still drops its suffix once enabled', () => {
  I18n.setLanguage('pt-BR');
  assert.equal(enable(EN_NAME), 'Refactor');
});
