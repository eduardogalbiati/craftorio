// Acceptance tests for #605 / #446 (written before the code): a chain whose target is the old Backlog
// queue (then: { action: 'queue', workflow }) plans a roadmap stage at the end instead, as the
// Product Owner's roadmap target does: its produced issues become one new planned stage for
// `workflow`, nothing is queued (no backlog/<project>.queue.json) and nothing starts. A chain file
// written by an older version with that target (chain.json of a paused chain) still works on resume.
// The issue tracker's "Create and queue" choice reads "Create and plan" (workflows/issue.yaml).
// Assumption: like the Product Owner's target, a simulated run plans too (its items simulated), since
// the issues it produced are in the synced backlog here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ISSUE_WORKFLOW, makeService, roadmapIssue, untilTrue } = require('@multiagent/engine/test/service/helpers');

const ROOT = path.join(__dirname, '..', '..', '..', '..');

const SOURCE_WORKFLOW = `apiVersion: multiagent/v1
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
  - id: review
    type: human_approval
    message: "Accept the result?"
    choices:
      - { id: accept, label: Accept }
      - { id: fail, label: Fail }
    transitions:
      - when: "choice == 'fail'"
        goto: end
        status: failed
      - when: "true"
        goto: end
outputs:
  issues:
    type: array
    description: "The issues this fixture produced (number, url, title)."
    value: "{{ steps.work.output.filed | to_json }}"
`;

function autoApprove(service, runId, stepId, answer) {
  const onEv = (ev) => {
    if (ev.run_id === runId && ev.type === 'approval.requested' && ev.step_id === stepId) {
      service.events.off('run:event', onEv);
      service.api['approval:resolve']({ runId, id: ev.approval_id, answer });
    }
  };
  service.events.on('run:event', onEv);
}

// a project whose synced backlog has #101 (the source's produced issue) and #102, with #102 planned
async function planProject(t, api, ws, name) {
  fs.writeFileSync(path.join(ws.workflows, 'fixture-chain-source.yaml'), SOURCE_WORKFLOW);
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name, folder });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({
    projectId: p.id, platform: 'github', repo: 'https://github.com/o/r',
    issues: [{ ...roadmapIssue(101), body: 'x'.repeat(130) }, { ...roadmapIssue(102), body: 'x'.repeat(130) }],
  }));
  await api['roadmap:save']({ projectId: p.id, stages: [{ name: 'Planned before', items: [{ workflow: 'fixture-issue.yaml', number: 102, mock: true }] }] });
  return { p, folder };
}

const issueNumbers = (item) => (item.issues || [item]).map((i) => i.number);

test('#446 a chain to the old Backlog-queue target plans the produced issues as a new roadmap stage at the end; nothing is queued or started', { timeout: 60000 }, async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const { p, folder } = await planProject(t, api, ws, 'chain-plan-446');
  const started = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'workflow.started') started.push(ev); });

  const { runId } = await api['run:start']({
    file: 'fixture-chain-source.yaml', inputs: { task: 'Do the work', repo_path: folder }, mock: true, mockSequences: { number: [101] }, projectId: p.id,
    then: { action: 'queue', workflow: 'fixture-issue.yaml' },
  });
  autoApprove(service, runId, 'review', 'accept');

  await untilTrue(() => api['chain:get']({ runId })?.state === 'done');
  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.stages.length, 2, 'one new stage');
  assert.deepEqual(issueNumbers(roadmap.stages[0].items[0]), [102], 'after the stage already planned');
  assert.deepEqual(roadmap.stages[1].items.flatMap(issueNumbers), [101]);
  assert.deepEqual(roadmap.stages[1].items.map((x) => x.workflow), ['fixture-issue.yaml']);
  assert.deepEqual(roadmap.stages[1].items.map((x) => x.status), ['planned']);
  assert.equal(started.length, 1, 'only the source ran: planning starts nothing');
  assert.equal(fs.existsSync(path.join(ws.backlog, `${p.id}.queue.json`)), false, 'nothing queued');
});

test('#446 an older chain.json with the Backlog-queue target still works: resumed, it plans the roadmap stage', { timeout: 60000 }, async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const { p, folder } = await planProject(t, api, ws, 'chain-plan-old-446');

  const { runId } = await api['run:start']({
    file: 'fixture-chain-source.yaml', inputs: { task: 'Do the work', repo_path: folder }, mock: true, mockSequences: { number: [101] }, projectId: p.id,
    then: { action: 'queue', workflow: 'fixture-issue.yaml' },
  });
  autoApprove(service, runId, 'review', 'fail');
  await untilTrue(() => api['chain:get']({ runId })?.state === 'paused');
  assert.equal(api['chain:get']({ runId }).then.action, 'queue', 'the chain file keeps the old target');

  const resumed = await api['chain:resume']({ runId });
  assert.equal(resumed.state, 'done');
  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.stages.length, 2);
  assert.deepEqual(roadmap.stages[1].items.flatMap(issueNumbers), [101]);
  assert.equal(fs.existsSync(path.join(ws.backlog, `${p.id}.queue.json`)), false);
});

test('#446 a chain to the Backlog-queue target whose produced issues are not open in the synced backlog ends done with "nothing planned" (never paused)', { timeout: 60000 }, async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const { p, folder } = await planProject(t, api, ws, 'chain-plan-unknown-446');
  const before = api['roadmap:get']({ projectId: p.id });

  const { runId } = await api['run:start']({
    file: 'fixture-chain-source.yaml', inputs: { task: 'Do the work', repo_path: folder }, mock: true, mockSequences: { number: [555] }, projectId: p.id,
    then: { action: 'queue', workflow: 'fixture-issue.yaml' },
  });
  autoApprove(service, runId, 'review', 'accept');

  await untilTrue(() => ['done', 'paused'].includes(api['chain:get']({ runId })?.state));
  const ch = api['chain:get']({ runId });
  assert.equal(ch.state, 'done', 'the chain is not paused');
  assert.match(String(ch.reason || ''), /nothing planned/);
  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.stages.length, 1, 'no stage was added');
  assert.deepEqual(roadmap.stages[0].items.flatMap(issueNumbers), [102]);
  assert.equal(roadmap.updatedAt, before.updatedAt, 'the roadmap was not rewritten');
  assert.equal(fs.existsSync(path.join(ws.backlog, `${p.id}.queue.json`)), false);
});

test('#446 the issue tracker\'s "Create and queue" choice reads "Create and plan"', () => {
  const yaml = fs.readFileSync(path.join(ROOT, 'workflows', 'issue.yaml'), 'utf8');
  const line = yaml.split('\n').find((l) => /id:\s*create_assign\b/.test(l) && /label:/.test(l));
  assert.ok(line, 'the create_assign choice is still offered');
  const label = /label:\s*"([^"]*)"/.exec(line)?.[1] || '';
  assert.match(label, /^Create and plan\b/);
  assert.doesNotMatch(yaml, /Create and queue/);
});
