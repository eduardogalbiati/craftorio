// #671 CurrentProject.resolve() (packages/ui-kit/current-project.js): the header's project read before
// the app's start has listed the projects (the Documents screen opened first, a seeded screenshot). The
// page loaded in the renderer harness without its start (no DOMContentLoaded).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

const PROJECTS = [
  { id: 'p2', name: 'No repo', folder: 'C:/two' },
  { id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/repo' },
];

test('#671 resolve lists the projects and picks the first with a repository when none was chosen', async () => {
  const app = loadApp({ storage: {}, api: { listProjects: async () => PROJECTS } });
  assert.equal(app.run('CurrentProject.get()'), null);
  assert.equal(await app.run('CurrentProject.resolve()'), 'p1');
  assert.equal(app.run('CurrentProject.get()'), 'p1');
});

test('#671 resolve keeps the remembered project while it still exists', async () => {
  const app = loadApp({ storage: { 'multiagent.currentProject': 'p2' }, api: { listProjects: async () => PROJECTS } });
  assert.equal(await app.run('CurrentProject.resolve()'), 'p2');
});

test('#671 resolve drops a remembered project that no longer exists', async () => {
  const app = loadApp({ storage: { 'multiagent.currentProject': 'gone' }, api: { listProjects: async () => PROJECTS } });
  assert.equal(await app.run('CurrentProject.resolve()'), 'p1');
});

test('#671 resolve answers the remembered project when the projects cannot be listed', async () => {
  const app = loadApp({ storage: { 'multiagent.currentProject': 'p1' }, api: { listProjects: async () => { throw new Error('offline'); } } });
  assert.equal(await app.run('CurrentProject.resolve()'), 'p1');
});

test('#671 resolve reads the list once: after the start it answers without listing again', async () => {
  const app = loadApp({ storage: {}, api: { listProjects: async () => PROJECTS, getSettings: async () => ({}) } });
  await app.boot();
  const before = app.callsTo('listProjects').length;
  assert.equal(await app.run('CurrentProject.resolve()'), 'p1');
  assert.equal(app.callsTo('listProjects').length, before);
});

test('#671 resolve answers null when the app has no project', async () => {
  const app = loadApp({ storage: {}, api: { listProjects: async () => [] } });
  assert.equal(await app.run('CurrentProject.resolve()'), null);
});
