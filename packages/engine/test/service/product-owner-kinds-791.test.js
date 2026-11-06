// #791: po:ask gives the Product Owner the project's kinds and only the project's workflows, and a
// simulated plan comes back classified. Acceptance tests, written before the code.
// Seams: what the channel hands to productOwner.ask (stubbed at the channel's edge, as
// product-owner-785.test.js does) and po:ask's simulated answer (no model).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const productOwner = require('../../domains/po/product-owner');
const { ISSUE_WORKFLOW, makeService, roadmapIssue } = require('./helpers');

const MANIFEST = `version: 1
default: fixture-hero
workflows:
  - name: fixture-hero
    category: solo
  - name: fix
    category: fix
kinds:
  feature: { name: fixture-hero }
  fix: { name: fix, mode: remote }
`;
const ASK = { question: 'Analyze the backlog and propose runs', mock: true, attachments: [], issues: [] };
const issue = (number, ...labels) => ({ ...roadmapIssue(number), body: 'x'.repeat(130), labels: labels.map((name) => ({ name })) });

async function setup(t, { manifest = MANIFEST, issues = [issue(1)], extra = {} } = {}) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-hero.yaml'), ISSUE_WORKFLOW.replace('name: fixture-issue', 'name: fixture-hero'));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'po-791-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  if (manifest) {
    fs.mkdirSync(path.join(folder, '.multiagent'));
    fs.writeFileSync(path.join(folder, '.multiagent', 'project.yaml'), manifest);
  }
  const p = await api['projects:create']({ name: 'po-791', folder, ...extra });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues }));
  return { api, p };
}

// the options po:ask gives the Product Owner
async function asked(t, options) {
  const { api, p } = await setup(t, options);
  const real = productOwner.ask;
  t.after(() => { productOwner.ask = real; });
  const calls = [];
  productOwner.ask = async (opts) => { calls.push(opts); return { message: { role: 'po', text: 'ok', answer: { summary: 'ok', groups: [] } }, messages: [] }; };
  await api['po:ask']({ ...ASK, projectId: p.id, mode: 'auto' });
  return calls[0];
}

test('#791 po:ask gives the Product Owner the project\'s kinds, already resolved', async (t) => {
  const { workflowKinds } = await asked(t, {});
  assert.deepEqual(JSON.parse(JSON.stringify(workflowKinds ?? null)), { feature: { name: 'fixture-hero', inputs: {} }, fix: { name: 'fix', inputs: { mode: 'remote' } } });
});

test('#791 po:ask offers only the project\'s workflows', async (t) => {
  const workflows = [{ name: 'feature', origin: 'bundled', category: 'build' }, { name: 'fix', origin: 'bundled', category: 'build' }];
  const out = await asked(t, { manifest: null, extra: { workflows } });
  assert.deepEqual(out.workflows.map((w) => w.file).sort(), ['feature.yaml', 'fix.yaml']);
});

test('#791 a simulated plan gives a bug the project\'s fix workflow in its mode', { timeout: 60000 }, async (t) => {
  const { api, p } = await setup(t, { issues: [issue(1, 'bug')] });
  const out = await api['po:ask']({ ...ASK, projectId: p.id, mode: 'plan' });
  const g = out.message.answer.groups[0];
  assert.deepEqual([g.kind, g.workflow, g.inputs.mode], ['fix', 'fix.yaml', 'remote']);
});

test('#791 a simulated plan never leaves a bug and a feature of one area in one run', { timeout: 60000 }, async (t) => {
  const { api, p } = await setup(t, { issues: [issue(1, 'bug', 'area:cart'), issue(2, 'area:cart')] });
  const out = await api['po:ask']({ ...ASK, projectId: p.id, mode: 'plan' });
  const runs = out.message.answer.groups.map((g) => `${g.kind}:${g.issues.join(',')}`).sort();
  assert.deepEqual(runs, ['feature:2', 'fix:1']);
});
