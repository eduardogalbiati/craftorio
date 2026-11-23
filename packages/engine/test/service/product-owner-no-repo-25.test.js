// #25, revised by #35: packages/engine/service/channels/product-owner.js for a project created without a repository.
// #25 made po:ask / po:file refuse it ("This project has no repository: add its URL in Projects › Edit to file
// issues."). #35's decision: "a project with no remote gets a local backlog", so the Product Owner reads and files
// into that local backlog like a synced repository's: po:ask answers, po:file in simulation shows its preview, and
// the "no repository" refusal is gone. A repository that was never synced is still told to sync (unchanged).
//
// Seams: the service's api['po:ask'] / api['po:file'] (as product-owner.test.js), a project made with
// api['projects:create'] without `repo`; simulation-only (no model call, po:file previews).
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

test('#35 po:ask on a project with no repository answers (its local backlog), no refusal', async (t) => {
  const { api } = makeService(t);
  const p = await noRepoProject(api, t);
  let out = null;
  const error = await errorOf(async () => { out = await api['po:ask']({ ...ASK, projectId: p.id }); });
  assert.equal(error, '');
  assert.equal(typeof out?.message, 'object');
});

test('#35 po:file on a project with no repository previews the draft in simulation, as for a repository', async (t) => {
  const { api } = makeService(t);
  const p = await noRepoProject(api, t);
  const asked = await api['po:ask']({ ...ASK, projectId: p.id, question: 'Login crashes every time I click save on the settings page', mode: 'issue' });
  assert.equal(typeof asked?.message?.issue?.draft?.title, 'string', 'the Product Owner drafted an issue');
  let out = null;
  const error = await errorOf(async () => { out = await api['po:file']({ projectId: p.id, at: asked.message.ts, action: 'create', preview: true }); });
  assert.equal(error, '');
  assert.equal(out?.preview, true);
  assert.equal(/no repository/i.test(JSON.stringify(out)), false, 'no "no repository" refusal in the answer');
});

test('#35 the po:file preview on a project with no repository names no gh / glab command', async (t) => {
  const { api } = makeService(t);
  const p = await noRepoProject(api, t);
  const asked = await api['po:ask']({ ...ASK, projectId: p.id, question: 'Login crashes every time I click save on the settings page', mode: 'issue' });
  const out = await api['po:file']({ projectId: p.id, at: asked.message.ts, action: 'create', preview: true });
  assert.equal(/\b(gh|glab) issue\b/.test(String(out?.message?.text || '')), false, `the preview: ${out?.message?.text}`);
});

// a repository that was never synced: syncing is the fix there, so the old message stays
test('#25 a project with a repository but no synced backlog: po:ask still says "Sync the backlog first"', async (t) => {
  const { api } = makeService(t);
  const p = await noRepoProject(api, t);
  await api['projects:update']({ id: p.id, patch: { repo: 'https://github.com/o/field-notes.git' } });
  const error = await errorOf(() => api['po:ask']({ ...ASK, projectId: p.id }));
  assert.equal(/Sync the backlog first/.test(error), true, `the refusal: ${error}`);
  assert.equal(/no repository/i.test(error), false, `the refusal: ${error}`);
});

test('#25 a project with a repository but no synced backlog: po:file still says "Sync the backlog first"', async (t) => {
  const { api } = makeService(t);
  const p = await noRepoProject(api, t);
  await api['projects:update']({ id: p.id, patch: { repo: 'https://github.com/o/field-notes.git' } });
  const error = await errorOf(() => api['po:file']({ projectId: p.id, at: 0, action: 'create', preview: true }));
  assert.equal(/Sync the backlog first/.test(error), true, `the refusal: ${error}`);
});

test('#25 with a synced repository po:ask answers as today', async (t) => {
  const { service, api } = makeService(t);
  const p = await roadmapProject(api, service.workspace(), t, [1, 2], 'po-repo-25');
  const out = await api['po:ask']({ ...ASK, projectId: p.id, mode: 'plan' });
  assert.equal(typeof out?.message, 'object');
});
