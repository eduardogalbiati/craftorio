// #75 internals: how the Next steps card reads the detected kind (fronts/analyser/views/project/project.js
// loadNextStepKind, hasInterface): hidden while it reads, read again on the way back to the page, offered when the
// read fails, the newest of several reads, and drawn again when the record's kind changes; and the `detectedKind` of
// projects:inputHints. Saving the kind in Ways of working: project-ways-of-working-run-defaults-735.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const oracleSeeds = require('@craftorio/engine/domains/oracle/oracle-seeds');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { makeService } = require('@craftorio/engine/test/service/helpers');
const { pageMarkup } = require('./project-page-helpers');

const PID = 'p1';
const PROJECT = { id: PID, name: 'Cpf', repo: '', folder: 'C:/ws/repos/cpf', exists: true };

// the page of ids[0], the Next steps card of every project open
async function projectPage(projectInputHints, ids = [PID]) {
  const app = loadApp({
    api: {
      listProjects: async () => ids.map((id) => ({ ...PROJECT, id })),
      onboardingStatus: async () => null,
      refactorProposals: async () => [],
      getBacklog: async () => ({ issues: [] }),
      refactorCadence: async () => ({ on: false, every: 10, since: null }),
      listDiscoveryCards: async () => [],
      listDiscoveryWaiting: async () => [],
      projectInputHints,
    },
    storage: { 'craftorio.nextSteps': JSON.stringify(Object.fromEntries(ids.map((id) => [id, 'open']))) },
  });
  await app.boot();
  app.run(`openProjectView(${JSON.stringify(ids[0])})`);
  await app.settle(30);
  return app;
}

const has = (app, testid) => H.findEl(pageMarkup(app, { defs: false }), (e) => e.attrs['data-testid'] === testid) !== null;
const offered = (app) => {
  assert.equal(has(app, 'project-next-steps'), true, 'the Next steps card is drawn');
  return has(app, 'next-step-screenshots');
};

test('#75 the entry is left out while the kind is read, then follows it', { timeout: 30000 }, async () => {
  let answer;
  const app = await projectPage(() => new Promise((resolve) => { answer = resolve; }));
  assert.equal(offered(app), false, 'while reading');
  answer({ detectedKind: 'frontend' });
  await app.settle(30);
  assert.equal(offered(app), true, 'once read');
});

test('#75 a user interface added while the page was away is seen on the way back', { timeout: 30000 }, async () => {
  let kind = 'backend';
  const app = await projectPage(async () => ({ detectedKind: kind }));
  assert.equal(offered(app), false, 'backend');
  kind = 'frontend';
  app.run('showView("inbox")');
  await app.settle(10);
  app.run('showView("project")');
  await app.settle(30);
  assert.equal(offered(app), true, 'frontend, with no reload');
});

test('#75 a kind that cannot be read keeps the entry', { timeout: 30000 }, async () => {
  const app = await projectPage(async () => { throw new Error('folder unreadable'); });
  assert.equal(offered(app), true);
});

test('#75 the picked kind decides over the one read', { timeout: 30000 }, async () => {
  const app = await projectPage(async () => ({ detectedKind: 'backend' }));
  assert.equal(offered(app), false, 'detected backend');
  app.run('state.pv.project = { ...state.pv.project, kind: "frontend" }; renderProjectView()');
  assert.equal(offered(app), true, 'picked frontend');
});

// ---- several reads in flight ------------------------------------------------------------------------------

// each read waits for its answer: answers[i]({ detectedKind })
function heldReads() {
  const answers = [];
  return { answers, read: () => new Promise((resolve) => { answers.push(resolve); }) };
}

async function leaveAndReturn(app) {
  app.run('showView("inbox")');
  await app.settle(10);
  app.run('showView("project")');
  await app.settle(30);
}

test('#75 of two reads in flight the newest one wins, whichever answers last', { timeout: 30000 }, async () => {
  const { answers, read } = heldReads();
  const app = await projectPage(read);
  await leaveAndReturn(app);
  assert.equal(answers.length, 2, 'read again on the way back');
  answers[1]({ detectedKind: 'frontend' });
  await app.settle(30);
  assert.equal(offered(app), true, 'the newest read');
  answers[0]({ detectedKind: 'backend' });
  await app.settle(30);
  app.run('renderProjectView()');
  assert.equal(offered(app), true, 'the older answer, arrived last, changes nothing');
});

test('#75 the kind read before stays while it is read again on the way back', { timeout: 30000 }, async () => {
  const { answers, read } = heldReads();
  const app = await projectPage(read);
  answers[0]({ detectedKind: 'frontend' });
  await app.settle(30);
  await leaveAndReturn(app);
  assert.equal(answers.length, 2, 'read again');
  assert.equal(offered(app), true, 'while reading again');
  answers[1]({ detectedKind: 'backend' });
  await app.settle(30);
  assert.equal(offered(app), false, 'once read again');
});

test('#75 a kind that arrives while another project\'s page is open does not reach it', { timeout: 30000 }, async () => {
  const held = {};
  const app = await projectPage((id) => new Promise((resolve) => { held[id] = resolve; }), ['p1', 'p2']);
  app.run('openProjectView("p2")');
  await app.settle(30);
  assert.equal(app.run('state.pv.id'), 'p2');
  held.p2({ detectedKind: 'backend' });
  await app.settle(30);
  held.p1({ detectedKind: 'frontend' });
  await app.settle(30);
  app.run('renderProjectView()');
  assert.equal(offered(app), false, 'p2 stays a backend');
});

// ---- the channel ------------------------------------------------------------------------------------------

test('#75 the detected kind follows the files, not the kind a saved Ways of working analysis found', { timeout: 60000 }, async (t) => {
  const { service, api } = makeService(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'detected-kind-75-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.writeFileSync(path.join(folder, 'README.md'), '# Field Notes\n');
  const { id } = await api['projects:create']({ name: 'Notes', folder });
  // the analysis run and saved; a simulated one saves no profile, so the one a real run saves is written over it
  await api['workflows:interview']({ projectId: id });
  const root = path.join(service.workspace().root, 'architecture');
  const [{ date }] = oracleSeeds.listSeedRuns(root, id, 'ways-of-working');
  const model = path.join(oracleSeeds.seedRunsDir(root, id, 'ways-of-working'), date, 'model.json');
  fs.writeFileSync(model, JSON.stringify({ profile: { kind: 'backend' }, evidence: {} }));
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0' } }));
  const hints = await api['projects:inputHints'](id);
  assert.equal(hints.runDefaults.kind, 'backend', 'the saved analysis still says backend');
  assert.equal(hints.detectedKind, 'frontend', 'the files have a user interface now');
});

test('#75 projects:inputHints answers the kind of the files, whatever was picked, and null with no project', async (t) => {
  const { api } = makeService(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'detected-kind-75-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.writeFileSync(path.join(folder, 'README.md'), '# Field Notes\n');
  const { id } = await api['projects:create']({ name: 'Notes', folder, kind: 'frontend' });
  const hints = await api['projects:inputHints'](id);
  assert.deepEqual([hints.detectedKind, hints.runDefaults.kind], ['backend', 'frontend']);
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0' } }));
  assert.equal((await api['projects:inputHints'](id)).detectedKind, 'frontend');
  assert.equal((await api['projects:inputHints'](null)).detectedKind, null);
});
