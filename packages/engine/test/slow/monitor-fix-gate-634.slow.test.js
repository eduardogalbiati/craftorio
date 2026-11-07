// #634 (spec R12) done-when: a simulated 500 becomes an Inbox card with its diagnosis, and the
// proposed fix stops at the human gate. One whole simulated run (mock provider, scratch workspace, a
// throwaway git repository as the project). Acceptance test, written before the code.
//
// Seams assumed (as in test/service/monitor-634.test.js): monitor:save-source (a log-file source on a
// temp JSON-lines file), monitor:poll, monitor:state, monitor:diagnose -> { cardId } (an 'intent' card
// of the project's Discovery Inbox, read with domains/discovery/discovery.js readCard), and
// monitor:propose-fix -> { runId }, which starts the bundled `fix` workflow (simulated under
// MULTIAGENT_SIMULATION_ONLY=1). The run is followed through the service's pushed run events: its
// workflow.started names workflow 'fix', and it must open a human gate (approval.requested) before any
// workflow.finished, without reaching a merge or push step. A deadline makes a missing gate fail here.
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService, gitRepo } = require('../service/helpers');

const discovery = () => require('../../domains/discovery/discovery');

const DEADLINE_MS = 120000;
const MSG = "TypeError: cannot read 'total' of undefined";
const line = (id) => JSON.stringify({ id, at: '2026-11-02T10:00:00Z', status: 500, method: 'POST', path: '/api/checkout', message: MSG, file: 'checkout.js', line: 412 });

// The first pushed event of `runId` matching `pred`, or a rejection naming `what` at the deadline.
function waitFor(service, pred, what) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { service.events.off('run:event', on); reject(new Error(`timed out waiting for ${what}`)); }, DEADLINE_MS);
    function on(ev) {
      if (!pred(ev)) return;
      clearTimeout(timer);
      service.events.off('run:event', on);
      resolve(ev);
    }
    service.events.on('run:event', on);
  });
}

test('#634 a simulated 500 becomes an Inbox intent with its diagnosis, and Propose fix runs `fix` to a human gate', { timeout: DEADLINE_MS + 30000 }, async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const repo = gitRepo(t);
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-634-'));
  t.after(() => fs.rmSync(logDir, { recursive: true, force: true }));
  const logFile = path.join(logDir, 'api.log');
  fs.writeFileSync(logFile, `${line('e1')}\n${line('e2')}\n`);
  const project = await api['projects:create']({ name: 'shop', folder: repo.dir });

  await api['monitor:save-source']({ projectId: project.id, source: { type: 'log-file', path: logFile, label: 'api logs' } });
  await api['monitor:poll']({ projectId: project.id });
  const group = (await api['monitor:state']({ projectId: project.id })).groups.find((g) => g.title === 'POST /api/checkout');
  assert.ok(group, 'the simulated 500 is a group');

  const { cardId } = await api['monitor:diagnose']({ projectId: project.id, fingerprint: group.fingerprint });
  const card = discovery().readCard(ws.discovery, project.id, cardId);
  assert.deepEqual([card.type, card.column], ['intent', 'inbox']);
  assert.ok(card.document.includes(MSG) && card.document.includes('checkout.js:412'), card.document);

  const events = [];
  service.events.on('run:event', (ev) => events.push(ev));
  const { runId } = await api['monitor:propose-fix']({ projectId: project.id, fingerprint: group.fingerprint });
  assert.equal(typeof runId, 'string');
  const of = (type) => events.filter((e) => e.run_id === runId && e.type === type);
  const end = of('approval.requested')[0] || of('workflow.finished')[0]
    || await waitFor(service, (e) => e.run_id === runId && (e.type === 'approval.requested' || e.type === 'workflow.finished'), `run ${runId} to reach a gate`);

  assert.equal(of('workflow.started')[0]?.workflow, 'fix');
  assert.equal(end.type, 'approval.requested', `the fix run ended (${end.status}) without stopping at a human gate`);
  const steps = of('step.started').map((e) => e.step_id);
  for (const merging of ['resolve_merge', 'push_main', 'ci', 'pr_monitor']) {
    assert.equal(steps.includes(merging), false, `the run reached ${merging} before the gate: ${steps.join(' > ')}`);
  }
  assert.equal(api['runs:active']().some((r) => r.runId === runId), true, 'the run is still waiting at the gate');
});
