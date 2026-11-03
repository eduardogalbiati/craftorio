// Workflow chaining (#134): packages/engine/service/areas/chain.js wired through a live run via
// packages/engine/service/areas/runs.js (workflow.finished -> continueChain). The model alone
// (apps/desktop/renderer/chain-model.js: normalizeThen, nextInputs, queueBatches, blockedReason...) is
// unit-tested in test/chain-model.test.js; this file only checks that a real run, through the
// service, really starts (or pauses, or asks the Product Owner, or queues) as chain-model says.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ISSUE_WORKFLOW, makeService, roadmapIssue, until, untilTrue } = require('@multiagent/engine/test/service/helpers');

// Stands for the issue-tracker -> software-development-local-hero pair: an `issues` output of
// created issues (number, url, title), a human gate that decides success or failure, and a `task`
// input a chain can fill from the previous run's result (the real pair is end-to-end, but far
// slower and less deterministic to run in full for this wiring test).
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

const TARGET_WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-chain-target
inputs:
  task: { type: string, required: true }
  issues: { type: array, default: [] }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "{{ inputs.task }}"
`;

function writeFixtures(ws) {
  fs.writeFileSync(path.join(ws.workflows, 'fixture-chain-source.yaml'), SOURCE_WORKFLOW);
  fs.writeFileSync(path.join(ws.workflows, 'fixture-chain-target.yaml'), TARGET_WORKFLOW);
}

// Resolves the first `approval.requested` of `stepId` for `runId` with `answer`.
function autoApprove(service, runId, stepId, answer) {
  const onEv = (ev) => {
    if (ev.run_id === runId && ev.type === 'approval.requested' && ev.step_id === stepId) {
      service.events.off('run:event', onEv);
      service.api['approval:resolve']({ runId, id: ev.approval_id, answer });
    }
  };
  service.events.on('run:event', onEv);
}

test('a successful run starts the workflow its chain names, with the previous run\'s outputs mapped to its inputs; both ends are recorded', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  writeFixtures(ws);
  const started = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'workflow.started') started.push(ev); });

  const { runId: runId1, runDir: runDir1 } = await api['run:start']({
    file: 'fixture-chain-source.yaml', inputs: { task: 'Do the work' }, mock: true, mockSequences: { number: [42] },
    then: { action: 'workflow', workflow: 'fixture-chain-target.yaml', map: { issues: 'issues', task: 'issues' } },
  });
  autoApprove(service, runId1, 'review', 'accept');

  await until(() => started.some((e) => e.run_id === runId1));
  assert.equal(api['chain:get']({ runId: runId1 }).state, 'waiting');

  await untilTrue(() => !api['runs:active']().some((r) => r.runId === runId1)); // run1 finished
  await untilTrue(() => started.some((e) => e.file === 'fixture-chain-target.yaml'));
  const startedNext = started.find((e) => e.file === 'fixture-chain-target.yaml');
  assert.equal(startedNext.from.run_id, runId1);
  assert.equal(startedNext.from.workflow, 'fixture-chain-source');
  assert.deepEqual(startedNext.inputs.issues, ['(simulated) url']);
  assert.match(startedNext.inputs.task, /Implement #42/);

  await untilTrue(() => api['chain:get']({ runId: runId1 })?.state === 'started');
  const runId2 = api['chain:get']({ runId: runId1 }).nextRunId;
  assert.equal(runId2, startedNext.run_id);

  // outputs are written to summary.json (#134), read straight off disk
  const summary = JSON.parse(fs.readFileSync(path.join(runDir1, 'summary.json'), 'utf8'));
  assert.deepEqual(summary.outputs.issues, [{ number: 42, url: '(simulated) url', title: '(simulated) title' }]);
  assert.equal(summary.then.workflow, 'fixture-chain-target.yaml');
});

test('a failed run never starts the chain: it pauses with a reason, and the owner can resume or drop it', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  writeFixtures(ws);
  const started = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'workflow.started') started.push(ev); });

  const { runId: runId1 } = await api['run:start']({
    file: 'fixture-chain-source.yaml', inputs: { task: 'Do the work' }, mock: true,
    then: { action: 'queue', workflow: 'fixture-chain-target.yaml' },
  });
  autoApprove(service, runId1, 'review', 'fail');

  await untilTrue(() => api['chain:get']({ runId: runId1 })?.state === 'paused');
  const chain = api['chain:get']({ runId: runId1 });
  assert.match(chain.reason, /the run ended failed/);
  assert.equal(started.length, 1, 'no second run was started');

  // resumed: the owner says it goes on anyway; a run without a project has no roadmap to plan in (#446),
  // so the chain pauses again with that reason, and can still be dropped
  const resumed = await api['chain:resume']({ runId: runId1 });
  assert.equal(resumed.state, 'paused');
  assert.match(resumed.reason, /no roadmap to plan in/);
  assert.equal(started.length, 1, 'still no second run');
  assert.equal(api['chain:drop']({ runId: runId1 }).chain.state, 'dropped');
  await assert.rejects(api['chain:resume']({ runId: runId1 }), /only a paused chain resumes/);
});

test('a failed run\'s paused chain can instead be dropped: nothing follows it', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  writeFixtures(ws);

  const { runId: runId1 } = await api['run:start']({
    file: 'fixture-chain-source.yaml', inputs: { task: 'Do the work' }, mock: true,
    then: { action: 'queue', workflow: 'fixture-chain-target.yaml' },
  });
  autoApprove(service, runId1, 'review', 'fail');
  await untilTrue(() => api['chain:get']({ runId: runId1 })?.state === 'paused');

  const dropped = api['chain:drop']({ runId: runId1 });
  assert.equal(dropped.chain.state, 'dropped');
  assert.equal(dropped.chain.reason, 'Dropped by the owner.');
  await assert.rejects(api['chain:resume']({ runId: runId1 }), /is dropped: only a paused chain resumes/);
});

test('the issue tracker\'s "Create and plan" sets a `queue` chain (the roadmap target, #446) at its review gate; without a project it plans nothing and pauses', { timeout: 60000 }, async (t) => {
  const { service, api } = makeService(t);
  const thens = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'run.then') thens.push(ev); });
  const root = path.join(__dirname, '..', '..', '..', '..');

  const { runId } = await api['run:start']({
    file: 'issue-tracker.yaml', mock: true,
    inputs: { request: 'The chain test needs an issue', project_path: root, assign_workflow: 'software-development.yaml' },
  });
  autoApprove(service, runId, 'review', 'create_assign');

  await untilTrue(() => thens.some((e) => e.run_id === runId));
  const setThen = thens.find((e) => e.run_id === runId);
  assert.deepEqual(setThen.then, { action: 'queue', workflow: 'software-development.yaml', inputs: {} });
  assert.equal(setThen.by, 'gate:review');

  await untilTrue(() => ['done', 'paused'].includes(api['chain:get']({ runId })?.state));
  const chain = api['chain:get']({ runId });
  // nothing queued ever: either no issue was produced, or there is no project's roadmap to plan in
  assert.match(chain.reason, /nothing planned|no roadmap to plan in/);
  assert.doesNotMatch(chain.reason, /queued/);
});

test('a chain to the Product Owner proposes roadmap stages from the run\'s produced issues, and starts no run', { timeout: 60000 }, async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  writeFixtures(ws);
  const folder = fs.mkdtempSync(path.join(require('os').tmpdir(), 'chain-po-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'chain-po', folder });
  fs.mkdirSync(ws.backlog, { recursive: true });
  // a body of 130+ chars so the simulated Product Owner does not flag it to enrich first (#164)
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({
    projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [{ ...roadmapIssue(101), body: 'x'.repeat(130) }],
  }));
  const started = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'workflow.started') started.push(ev); });

  const { runId: runId1 } = await api['run:start']({
    file: 'fixture-chain-source.yaml', inputs: { task: 'Do the work', repo_path: folder }, mock: true, mockSequences: { number: [101] },
    then: { action: 'product_owner' },
  });
  autoApprove(service, runId1, 'review', 'accept');

  await untilTrue(() => api['chain:get']({ runId: runId1 })?.state === 'done');
  const chain = api['chain:get']({ runId: runId1 });
  assert.match(chain.reason, /The Product Owner proposed 1 roadmap stage: review them on the Backlog and press Start\./);

  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.stages.length, 1);
  assert.deepEqual(roadmap.stages[0].items[0].issues.map((i) => i.number), [101]);
  assert.equal(roadmap.stages[0].items[0].status, 'planned');
  assert.equal(started.length, 1, 'only fixture-chain-source ran: the Product Owner never starts a run by itself');
});

test('a chain to the Product Owner adds its stages to a running roadmap without pausing it, and says the roadmap runs them in their turn (#654)', { timeout: 60000 }, async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  writeFixtures(ws);
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const folder = fs.mkdtempSync(path.join(require('os').tmpdir(), 'chain-po-running-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'chain-po-running', folder });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({
    projectId: p.id, platform: 'github', repo: 'https://github.com/o/r',
    issues: [{ ...roadmapIssue(101), body: 'x'.repeat(130) }, { ...roadmapIssue(102), body: 'x'.repeat(130) }],
  }));
  api['settings:set']({ concurrentRuns: { enabled: true, max: 2, perProject: null, countSimulations: true } });

  // the roadmap is running: its #102 run waits at its gate while the chain's source run goes on
  await api['roadmap:save']({ projectId: p.id, stages: [{ name: 'Stage one', items: [{ workflow: 'fixture-issue.yaml', number: 102, mock: true }] }] });
  await api['roadmap:start']({ projectId: p.id, simulated: true });
  await untilTrue(() => api['runs:active']().length === 1);
  const roadmapRunId = api['runs:active']()[0].runId;
  t.after(async () => {
    try { api['run:stop']({ runId: roadmapRunId }); } catch { /* already ended */ }
    await untilTrue(() => !api['runs:active']().some((r) => r.runId === roadmapRunId));
  });

  const { runId: runId1 } = await api['run:start']({
    file: 'fixture-chain-source.yaml', inputs: { task: 'Do the work', repo_path: folder }, mock: true, mockSequences: { number: [101] },
    then: { action: 'product_owner' },
  });
  autoApprove(service, runId1, 'review', 'accept');

  await untilTrue(() => api['chain:get']({ runId: runId1 })?.state === 'done');
  const chain = api['chain:get']({ runId: runId1 });
  assert.match(chain.reason, /The Product Owner proposed 1 roadmap stage: the running roadmap runs them in their turn\./);
  assert.doesNotMatch(chain.reason, /press Start/);

  const roadmap = api['roadmap:get']({ projectId: p.id });
  assert.equal(roadmap.state, 'running');
  assert.equal(roadmap.stages.length, 2);
  assert.deepEqual(roadmap.stages[1].items[0].issues.map((i) => i.number), [101]);
  assert.equal(roadmap.stages[1].items[0].status, 'planned', 'it waits for stage 1, still running');
});
