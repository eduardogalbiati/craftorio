// #728: the Refactor tab's Prioritize (refactor:prioritize) on a REAL turn, through makeService: the
// channel's real options (realOptions, the same ctx.refactorPriorityOptions the onboarding's ranking job
// and the refactor-proposals workflow's prioritize step use) carry no onItem, which crashed the turn with
// "onItem is not a function". The CLI is stubbed: PROVIDERS.claude gets this node's absolute path and
// packages/engine/test/fixtures/fake-claude-ranking.js for the test (restored after), never a `claude`
// found on PATH (the owner's real, paid CLI). MULTIAGENT_SIMULATION_ONLY is lifted for the test only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService } = require('@multiagent/engine/test/service/helpers');

const STUB = require.resolve('@multiagent/engine/test/fixtures/fake-claude-ranking.js');

function realClaudeStub(t, marker) {
  const { PROVIDERS } = require('@multiagent/engine/domains/workflow/workflow-builder');
  const claude = PROVIDERS.claude;
  const saved = { command: claude.command, args: claude.args };
  claude.command = process.execPath;
  claude.args = [STUB, marker];
  const sim = process.env.MULTIAGENT_SIMULATION_ONLY;
  delete process.env.MULTIAGENT_SIMULATION_ONLY;
  t.after(() => {
    claude.command = saved.command;
    claude.args = saved.args;
    if (sim === undefined) delete process.env.MULTIAGENT_SIMULATION_ONLY; else process.env.MULTIAGENT_SIMULATION_ONLY = sim;
  });
}

test('#728 refactor:prioritize with a real (stubbed CLI) turn saves the Product Owner\'s ranking on the proposals', async (t) => {
  const { api } = makeService(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'refactor728-svc-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 }));
  fs.writeFileSync(path.join(folder, 'a.txt'), 'a\n');
  const project = await api['projects:create']({ name: 'refactor', folder });
  const projectId = project.id;
  const add = (n) => api['refactor:add']({ projectId, target: `src/part${n}.js`, improvement: `Split part ${n}`, evidence: `Part ${n} changes with every fix` });
  const a = await add(1);
  const b = await add(2);
  const marker = path.join(folder, 'stub.ran');
  realClaudeStub(t, marker);

  const out = await api['refactor:prioritize']({ projectId });

  assert.equal(fs.existsSync(marker), true, 'the stub CLI ran: a real turn, not the simulated ranking');
  assert.deepEqual(out.ranking.map((r) => r.id).sort(), [a.id, b.id].sort());
  for (const r of out.ranking) assert.match(r.reason, /Fake Product Owner reason/);
  assert.equal(out.costUsd, 0.0123);
  const list = await api['refactor:proposals']({ projectId });
  assert.deepEqual(list.map((p) => p.rank).sort(), [1, 2]);
});
