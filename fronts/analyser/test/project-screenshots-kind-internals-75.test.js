// #75 internals: how the Next steps card reads the detected kind (fronts/analyser/views/project/project.js
// loadNextStepKind, hasInterface): hidden while it reads, read again on the way back to the page, offered when the
// read fails, and drawn again when the record's kind changes; and the `detectedKind` of projects:inputHints.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { makeService } = require('@craftorio/engine/test/service/helpers');
const { pageMarkup } = require('./project-page-helpers');

const PID = 'p1';
const PROJECT = { id: PID, name: 'Cpf', repo: '', folder: 'C:/ws/repos/cpf', exists: true };

async function projectPage(projectInputHints) {
  const app = loadApp({
    api: {
      listProjects: async () => [{ ...PROJECT }],
      onboardingStatus: async () => null,
      refactorProposals: async () => [],
      getBacklog: async () => ({ issues: [] }),
      refactorCadence: async () => ({ on: false, every: 10, since: null }),
      listDiscoveryCards: async () => [],
      listDiscoveryWaiting: async () => [],
      projectInputHints,
    },
    storage: { 'craftorio.nextSteps': JSON.stringify({ [PID]: 'open' }) },
  });
  await app.boot();
  app.run(`openProjectView(${JSON.stringify(PID)})`);
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
