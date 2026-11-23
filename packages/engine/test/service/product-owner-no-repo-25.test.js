// #25 acceptance, written before the code: packages/engine/service/channels/product-owner.js for a project created
// without a repository. Today po:ask answers "Sync the backlog first: the Product Owner reads the synced issues."
// (askOptions) and po:file "Sync the backlog first: the Product Owner writes to the synced repository." (target),
// though no sync can ever help. Expected (decision of #25: "add a repository"): the refusal says the project has no
// repository; a project with a synced backlog is answered as today.
//
// Seams: the service's api['po:ask'] / api['po:file'] (as product-owner.test.js), a project made with
// api['projects:create'] without `repo`; simulation-only (no model call).
process.env.CRAFTORIO_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService, roadmapProject } = require('./helpers');

const ASK = { question: 'Create an issue for the login page', mock: true, mode: 'auto', attachments: [], issues: [] };

async function noRepoProject(api, t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'service-no-repo-25-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return api['projects:create']({ name: 'field notes', folder });
}

// the error a call rejects with, as a string ('' when it did not reject)
async function errorOf(call) {
  try { await call(); } catch (e) { return String(e?.message || e); }
  return '';
}

test('#25 po:ask on a project with no repository no longer says "Sync the backlog first"', async (t) => {
  const { api } = makeService(t);
  const p = await noRepoProject(api, t);
  const error = await errorOf(() => api['po:ask']({ ...ASK, projectId: p.id }));
  assert.equal(/Sync the backlog first/i.test(error), false, `the refusal: ${error}`);
});

test('#25 po:ask on a project with no repository says the project has no repository', async (t) => {
  const { api } = makeService(t);
  const p = await noRepoProject(api, t);
  const error = await errorOf(() => api['po:ask']({ ...ASK, projectId: p.id }));
  assert.equal(/no repository/i.test(error), true, `the refusal: ${error}`);
});

test('#25 po:file on a project with no repository says the project has no repository, not "Sync the backlog first"', async (t) => {
  const { api } = makeService(t);
  const p = await noRepoProject(api, t);
  const error = await errorOf(() => api['po:file']({ projectId: p.id, at: 0, action: 'create', preview: true }));
  assert.equal(/no repository/i.test(error), true, `the refusal: ${error}`);
  assert.equal(/Sync the backlog first/i.test(error), false, `the refusal: ${error}`);
});

test('#25 with a synced repository po:ask answers as today', async (t) => {
  const { service, api } = makeService(t);
  const p = await roadmapProject(api, service.workspace(), t, [1, 2], 'po-repo-25');
  const out = await api['po:ask']({ ...ASK, projectId: p.id, mode: 'plan' });
  assert.equal(typeof out?.message, 'object');
});
