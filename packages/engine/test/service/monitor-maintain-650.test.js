// #650 Write doc phase 5 (docs/work/write-doc/spec.md R16): an error the Monitor diagnoses, tied to a
// work item, is recorded in that item's docs/work/<item>/maintain.md and opens a new intent
// (docs/work/<new item>/intent.md) that links back. Acceptance test written before the code.
// Seam assumed: monitor:diagnose { projectId, fingerprint, item } (the item of the project's repository
// the error belongs to); without `item` it behaves as in #634 (monitor-634.test.js). The writing itself
// is the Documents service's recordIncident (fronts/plan/test/docs-maintain-650.test.js).
// No model is called (CRAFTORIO_SIMULATION_ONLY=1, set by makeService).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeService, gitRepo } = require('./helpers');

const MSG = "TypeError: cannot read 'total' of undefined";
const checkout = (id) => JSON.stringify({ id, at: '2026-11-02T10:00:00Z', status: 500, method: 'POST', path: '/api/checkout', message: MSG, file: 'checkout.js', line: 412 });

const INTENT = `---
item: checkout
stage: intent
status: accepted
approver: Owner
date: 2026-10-30
---

# Intent: checkout

## Problem

People cannot pay.
`;
const MAINTAIN = `---
item: checkout
stage: maintain
status: no incidents
---

# Maintain: incidents and post-mortems

## Incidents

| Date | Source | Error | New intent | Fix |
|---|---|---|---|---|
| — | — | — | — | no incidents |

## Post-mortems
`;

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-650-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A service with a project whose repository has the item "checkout", a log source with the 500, polled.
// `fronts` (#775): the composition's fronts, default every installed one.
async function setup(t, { fronts } = {}) {
  const { service, api } = makeService(t, { userDataDir: tmpDir(t), fronts });
  const repo = gitRepo(t);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo.dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  fs.mkdirSync(path.join(repo.dir, 'docs', 'work', 'checkout'), { recursive: true });
  fs.writeFileSync(path.join(repo.dir, 'docs', 'work', 'checkout', 'intent.md'), INTENT);
  fs.writeFileSync(path.join(repo.dir, 'docs', 'work', 'checkout', 'maintain.md'), MAINTAIN);
  git('add', '.');
  git('commit', '-q', '-m', 'the checkout item');
  const project = await api['projects:create']({ name: 'shop', folder: repo.dir });
  const logFile = path.join(tmpDir(t), 'api.log');
  fs.writeFileSync(logFile, `${checkout('e1')}\n${checkout('e2')}\n`);
  const saved = await api['monitor:save-source']({ projectId: project.id, source: { type: 'log-file', path: logFile, label: 'api logs' } });
  assert.equal(saved?.ok, true, JSON.stringify(saved));
  await api['monitor:poll']({ projectId: project.id });
  const g = (await api['monitor:state']({ projectId: project.id })).groups.find((x) => x.title === 'POST /api/checkout');
  assert.ok(g, 'the 500 is a group');
  return { service, api, repo, git, projectId: project.id, group: g };
}

const workItems = (dir) => {
  try { return fs.readdirSync(path.join(dir, 'docs', 'work')); } catch { return []; }
};

test('#650 monitor:diagnose of an error tied to an item records it in the item\'s maintain.md and opens a new intent that links back', async (t) => {
  const s = await setup(t);
  const res = await s.api['monitor:diagnose']({ projectId: s.projectId, fingerprint: s.group.fingerprint, item: 'checkout' });
  assert.equal(res?.ok, true, JSON.stringify(res));

  const maintain = fs.readFileSync(path.join(s.repo.dir, 'docs', 'work', 'checkout', 'maintain.md'), 'utf8');
  const incidents = maintain.slice(maintain.indexOf('## Incidents'), maintain.indexOf('## Post-mortems'));
  const row = incidents.split('\n').find((l) => l.startsWith('|') && l.includes(MSG));
  assert.ok(row, incidents);
  assert.ok(row.toLowerCase().includes('monitor'), row);

  const fresh = workItems(s.repo.dir).filter((d) => d !== 'checkout');
  assert.equal(fresh.length, 1, `new items: ${JSON.stringify(fresh)}`);
  const intent = fs.readFileSync(path.join(s.repo.dir, 'docs', 'work', fresh[0], 'intent.md'), 'utf8');
  assert.ok(intent.includes('../checkout/maintain.md'), intent);
  assert.ok(intent.includes(MSG), intent);
  assert.ok(row.includes(`../${fresh[0]}/intent.md`), row);
  // committed in the project's repository, nothing left uncommitted under docs/work
  assert.equal(s.git('status', '--porcelain', '--', 'docs/work'), '');
});

test('#650 monitor:diagnose with an item the repository does not have: ok false, nothing written in docs/work, the Inbox card still filed', async (t) => {
  const s = await setup(t);
  const head = s.git('rev-parse', 'HEAD');
  const res = await s.api['monitor:diagnose']({ projectId: s.projectId, fingerprint: s.group.fingerprint, item: 'nope' });
  assert.equal(res?.ok, false, JSON.stringify(res));
  assert.match(String(res.error || ''), /nope/);
  assert.deepEqual(workItems(s.repo.dir), ['checkout']);
  assert.equal(fs.readFileSync(path.join(s.repo.dir, 'docs', 'work', 'checkout', 'maintain.md'), 'utf8'), MAINTAIN);
  assert.equal(s.git('rev-parse', 'HEAD'), head);
  assert.equal(s.git('status', '--porcelain'), '');
  const discovery = require('../../domains/discovery/discovery');
  const cards = discovery.listCards(s.service.workspace().discovery, s.projectId, { column: 'inbox' }).filter((c) => c.type === 'intent');
  assert.equal(cards.length, 1);
  const g = (await s.api['monitor:state']({ projectId: s.projectId })).groups.find((x) => x.fingerprint === s.group.fingerprint);
  assert.equal(g.state, 'intent');
});

// #775: the Monitor (ai front) calls the plan front's docs helpers only optionally: an engine serving the
// ai front alone answers a diagnose with an item without crashing, writes nothing in docs/work and still
// files the Inbox card
test('#775 monitor:diagnose with an item on an engine without the plan front: ok false, nothing written in docs/work, the Inbox card still filed', async (t) => {
  const s = await setup(t, { fronts: ['ai'] });
  assert.equal(s.api['docs:intents'], undefined, 'the plan front is not served');
  const head = s.git('rev-parse', 'HEAD');
  const res = await s.api['monitor:diagnose']({ projectId: s.projectId, fingerprint: s.group.fingerprint, item: 'checkout' });
  assert.equal(res?.ok, false, JSON.stringify(res));
  assert.match(String(res.error || ''), /Documents/);
  assert.deepEqual(workItems(s.repo.dir), ['checkout']);
  assert.equal(fs.readFileSync(path.join(s.repo.dir, 'docs', 'work', 'checkout', 'maintain.md'), 'utf8'), MAINTAIN);
  assert.equal(s.git('rev-parse', 'HEAD'), head);
  const discovery = require('../../domains/discovery/discovery');
  const cards = discovery.listCards(s.service.workspace().discovery, s.projectId, { column: 'inbox' }).filter((c) => c.type === 'intent');
  assert.equal(cards.length, 1);
});

test('#650 diagnosing the same group again with its item records the incident once', async (t) => {
  const s = await setup(t);
  await s.api['monitor:diagnose']({ projectId: s.projectId, fingerprint: s.group.fingerprint, item: 'checkout' });
  const again = await s.api['monitor:diagnose']({ projectId: s.projectId, fingerprint: s.group.fingerprint, item: 'checkout' });
  assert.equal(again?.ok, true, JSON.stringify(again));
  const maintain = fs.readFileSync(path.join(s.repo.dir, 'docs', 'work', 'checkout', 'maintain.md'), 'utf8');
  assert.equal(maintain.split('\n').filter((l) => l.startsWith('|') && l.includes(MSG)).length, 1, maintain);
  assert.equal(workItems(s.repo.dir).length, 2);
});
