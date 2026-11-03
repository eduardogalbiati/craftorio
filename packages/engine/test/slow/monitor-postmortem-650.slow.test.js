// #650 (docs/work/write-doc/spec.md R16): the post-mortem of an incident the Monitor recorded. An error
// tied to a work item (monitor:diagnose { item }) is an incident of docs/work/<item>/maintain.md; when the
// group's fix run (monitor:propose-fix, the bundled `fix` workflow, simulated) ends in success, the
// item's maintain.md gets the post-mortem under ## Post-mortems, naming the incident's new intent.
// One whole simulated run (mock provider, scratch workspace, a throwaway git repository as the project);
// every human gate is answered with its approving choice.
process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeService, gitRepo } = require('../service/helpers');

const DEADLINE_MS = 240000;
const MSG = "TypeError: cannot read 'total' of undefined";
const line = (id) => JSON.stringify({ id, at: '2026-11-02T10:00:00Z', status: 500, method: 'POST', path: '/api/checkout', message: MSG, file: 'checkout.js', line: 412 });

const INTENT = '---\nitem: checkout\nstage: intent\nstatus: accepted\napprover: Owner\ndate: 2026-10-30\n---\n\n# Intent: checkout\n\n## Problem\n\nPeople cannot pay.\n';
const MAINTAIN = '---\nitem: checkout\nstage: maintain\nstatus: no incidents\n---\n\n# Maintain: incidents and post-mortems\n\n## Incidents\n\n| Date | Source | Error | New intent | Fix |\n|---|---|---|---|---|\n| — | — | — | — | no incidents |\n\n## Post-mortems\n';

// the approving answer of a gate: true, or the choice that approves (else the first one)
function approving(ev) {
  const choices = (ev.choices || []).map((c) => (typeof c === 'string' ? c : c.id));
  if (!choices.length) return true;
  return choices.find((c) => /^(approve|accept|merge|yes|continue|ok)/i.test(c)) || choices[0];
}

const postMortems = (text) => text.slice(text.indexOf('## Post-mortems') + '## Post-mortems'.length);

test('#650 the fix run of an error tied to an item ends in success: the item\'s maintain.md gets the post-mortem', { timeout: DEADLINE_MS + 30000 }, async (t) => {
  const { service, api } = makeService(t);
  const repo = gitRepo(t);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo.dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  fs.mkdirSync(path.join(repo.dir, 'docs', 'work', 'checkout'), { recursive: true });
  fs.writeFileSync(path.join(repo.dir, 'docs', 'work', 'checkout', 'intent.md'), INTENT);
  fs.writeFileSync(path.join(repo.dir, 'docs', 'work', 'checkout', 'maintain.md'), MAINTAIN);
  git('add', '.');
  git('commit', '-q', '-m', 'the checkout item');
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-650-'));
  t.after(() => fs.rmSync(logDir, { recursive: true, force: true }));
  const logFile = path.join(logDir, 'api.log');
  fs.writeFileSync(logFile, `${line('e1')}\n${line('e2')}\n`);
  const project = await api['projects:create']({ name: 'shop', folder: repo.dir });
  await api['monitor:save-source']({ projectId: project.id, source: { type: 'log-file', path: logFile, label: 'api logs' } });
  await api['monitor:poll']({ projectId: project.id });
  const group = (await api['monitor:state']({ projectId: project.id })).groups.find((g) => g.title === 'POST /api/checkout');
  assert.ok(group, 'the simulated 500 is a group');

  const diag = await api['monitor:diagnose']({ projectId: project.id, fingerprint: group.fingerprint, item: 'checkout' });
  assert.equal(diag?.ok, true, JSON.stringify(diag));
  const intentItem = fs.readdirSync(path.join(repo.dir, 'docs', 'work')).find((d) => d !== 'checkout');
  assert.ok(intentItem, 'the incident opened a new intent item');

  let runId = null;
  const early = [];
  const finished = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { service.events.off('run:event', on); reject(new Error(`timed out waiting for the fix run ${runId} to finish`)); }, DEADLINE_MS);
    function on(ev) {
      if (!runId) { early.push(ev); return; }
      if (ev.run_id !== runId) return;
      if (ev.type === 'approval.requested') setImmediate(() => api['approval:resolve']({ runId, id: ev.approval_id, answer: approving(ev) }));
      if (ev.type === 'workflow.finished') { clearTimeout(timer); service.events.off('run:event', on); resolve(ev); }
    }
    service.events.on('run:event', on);
    t.after(() => { clearTimeout(timer); service.events.off('run:event', on); });
  });
  const started = await api['monitor:propose-fix']({ projectId: project.id, fingerprint: group.fingerprint });
  runId = started?.runId;
  assert.equal(typeof runId, 'string', JSON.stringify(started));
  for (const ev of early.filter((e) => e.run_id === runId && e.type === 'approval.requested')) {
    api['approval:resolve']({ runId, id: ev.approval_id, answer: approving(ev) });
  }
  const end = early.find((e) => e.run_id === runId && e.type === 'workflow.finished') || await finished;
  assert.equal(end.status, 'success', `the simulated fix run ended ${end.status}: ${end.error || ''}`);
  await new Promise((r) => setTimeout(r, 200));

  const maintain = fs.readFileSync(path.join(repo.dir, 'docs', 'work', 'checkout', 'maintain.md'), 'utf8');
  const pm = postMortems(maintain);
  assert.ok(pm.includes(intentItem), pm);
  assert.ok(pm.includes(MSG), pm);
});
