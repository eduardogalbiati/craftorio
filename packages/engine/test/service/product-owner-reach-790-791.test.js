// #790, #791: a chain and the Oracle reach the Product Owner with the project's workflows, its default and
// its kinds, as po:ask does (product-owner-default-790.test.js, product-owner-kinds-791.test.js). Seams: a run
// chained to the Product Owner (roadmap:get afterwards) and oracle:delegate (po:history afterwards), both
// simulated: no model.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const productOwner = require('../../domains/po/product-owner');
const { ISSUE_WORKFLOW, makeService, roadmapIssue, untilTrue } = require('./helpers');

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

// a run that produces one issue, chained like apps/desktop/test/service/chain.test.js
const SOURCE_WORKFLOW = `apiVersion: craftorio/v1
kind: Workflow
metadata:
  name: fixture-chain-source
inputs:
  task: { type: string, required: true }
  repo_path: { type: string, default: "" }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "{{ inputs.task }}"
    output_schema:
      type: object
      required: [filed]
      properties:
        filed:
          type: array
          items:
            type: object
            required: [number, url, title]
            properties:
              number: { type: integer }
              url: { type: string }
              title: { type: string }
outputs:
  issues:
    type: array
    description: "The issues this fixture produced (number, url, title)."
    value: "{{ steps.work.output.filed | to_json }}"
`;

const issue = (number, ...labels) => ({ ...roadmapIssue(number), body: 'x'.repeat(130), labels: labels.map((name) => ({ name })) });

async function setup(t, issues) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-hero.yaml'), ISSUE_WORKFLOW.replace('name: fixture-issue', 'name: fixture-hero'));
  fs.writeFileSync(path.join(ws.workflows, 'fixture-unrelated.yaml'), ISSUE_WORKFLOW.replace('name: fixture-issue', 'name: fixture-unrelated'));
  fs.writeFileSync(path.join(ws.workflows, 'fixture-chain-source.yaml'), SOURCE_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'po-reach-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.mkdirSync(path.join(folder, '.multiagent'));
  fs.writeFileSync(path.join(folder, '.multiagent', 'project.yaml'), MANIFEST);
  const p = await api['projects:create']({ name: 'po-reach', folder });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues }));
  return { api, p, folder };
}

async function chainedItem(api, p, folder, number) {
  const { runId } = await api['run:start']({
    file: 'fixture-chain-source.yaml', inputs: { task: 'Do the work', repo_path: folder }, mock: true, mockSequences: { number: [number] },
    then: { action: 'product_owner' },
  });
  await untilTrue(() => api['chain:get']({ runId })?.state === 'done');
  const item = api['roadmap:get']({ projectId: p.id }).stages[0].items[0];
  return [item.workflow, item.inputs?.mode ?? null];
}

const delegate = (api, p) => api['oracle:delegate']({ to: 'product-owner', question: 'Analyze the backlog and propose runs', projectId: p.id, mock: true });

async function delegatedGroups(api, p) {
  await delegate(api, p);
  const answers = (await api['po:history']({ projectId: p.id })).filter((m) => m.answer);
  return answers[answers.length - 1].answer.groups.map((g) => [g.kind, g.workflow, g.inputs?.mode ?? null]);
}

// what the area hands to the Product Owner, stubbed at its edge as product-owner-kinds-791.test.js does
function capture(t) {
  const real = productOwner.ask;
  t.after(() => { productOwner.ask = real; });
  const calls = [];
  productOwner.ask = async (opts) => { calls.push(opts); return { message: { role: 'po', text: 'ok', answer: { summary: 'ok', groups: [] } }, messages: [] }; };
  return calls;
}

test('#790 a chain to the Product Owner places a feature on the project\'s default', { timeout: 60000 }, async (t) => {
  const { api, p, folder } = await setup(t, [issue(101)]);
  assert.deepEqual(await chainedItem(api, p, folder, 101), ['fixture-hero.yaml', null]);
});

test('#791 a chain to the Product Owner places a bug on the project\'s Fix workflow, in its mode', { timeout: 60000 }, async (t) => {
  const { api, p, folder } = await setup(t, [issue(101, 'bug')]);
  assert.deepEqual(await chainedItem(api, p, folder, 101), ['fix.yaml', 'remote']);
});

test('#790 a plan asked by the Oracle puts a feature on the project\'s default', { timeout: 60000 }, async (t) => {
  const { api, p } = await setup(t, [issue(1)]);
  assert.deepEqual(await delegatedGroups(api, p), [['feature', 'fixture-hero.yaml', null]]);
});

test('#791 a plan asked by the Oracle gives a bug the project\'s Fix workflow, in its mode', { timeout: 60000 }, async (t) => {
  const { api, p } = await setup(t, [issue(1, 'bug')]);
  assert.deepEqual(await delegatedGroups(api, p), [['fix', 'fix.yaml', 'remote']]);
});

test('#791 the Oracle offers the Product Owner only the project\'s workflows', { timeout: 60000 }, async (t) => {
  const { api, p } = await setup(t, [issue(1)]);
  const calls = capture(t);
  await delegate(api, p);
  assert.deepEqual(calls[0].workflows.map((w) => w.file).sort(), ['fix.yaml', 'fixture-hero.yaml']);
});

test('#791 a chain offers the Product Owner only the project\'s workflows', { timeout: 60000 }, async (t) => {
  const { api, p, folder } = await setup(t, [issue(101)]);
  const calls = capture(t);
  const { runId } = await api['run:start']({
    file: 'fixture-chain-source.yaml', inputs: { task: 'Do the work', repo_path: folder }, mock: true, mockSequences: { number: [101] },
    then: { action: 'product_owner' },
  });
  await untilTrue(() => calls.length === 1 || ['done', 'failed'].includes(api['chain:get']({ runId })?.state));
  assert.deepEqual(calls[0].workflows.map((w) => w.file).sort(), ['fix.yaml', 'fixture-hero.yaml']);
});
