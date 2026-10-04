// #238: the Backlog's Archive / Restore channels. Acceptance tests, written before the code.
// Seams this file expects (src/service/channels/backlog.js):
//   { channel: 'backlog:archive', method: 'archiveIssues', params: ['projectId', 'numbers'] }
//   { channel: 'backlog:restore', method: 'restoreIssues', params: ['projectId', 'numbers'] }
// Both answer { results: [{ number, ok, error? }], backlog } (backlog: the Backlog after the change).
// The guards (src/backlog.js archiveIssues, fed the issues with their roadmap and run links) are
// checked per issue before anything is sent: an issue planned in the roadmap is refused with
// "Planned in stage <n>: remove it from the roadmap first". The CLI commands themselves are covered with
// a stubbed gh/glab in test/backlog-archive-238.test.js; here only refused issues are sent, so no
// CLI is ever started (and simulation-only is on).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService, ISSUE_WORKFLOW, roadmapProject } = require('./helpers');

test('the manifest declares backlog:archive (archiveIssues) and backlog:restore (restoreIssues), each taking projectId and numbers', (t) => {
  const { service } = makeService(t);
  const entry = (channel) => service.manifest.find((e) => e.channel === channel);
  assert.ok(entry('backlog:archive'), 'backlog:archive is declared');
  assert.equal(entry('backlog:archive').method, 'archiveIssues');
  assert.deepEqual(entry('backlog:archive').params, ['projectId', 'numbers']);
  assert.ok(entry('backlog:restore'), 'backlog:restore is declared');
  assert.equal(entry('backlog:restore').method, 'restoreIssues');
  assert.deepEqual(entry('backlog:restore').params, ['projectId', 'numbers']);
});

test('backlog:archive refuses an issue planned in the roadmap, naming its stage; the issue stays open in the Backlog', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const p = await roadmapProject(api, ws, t, [1, 2], 'archive-planned');
  await api['roadmap:save']({
    projectId: p.id,
    stages: [
      { name: 'First', items: [{ workflow: 'fixture-issue.yaml', number: 2, mock: true }] },
      { name: 'Second', items: [{ workflow: 'fixture-issue.yaml', number: 1, mock: true }] },
    ],
  });
  assert.equal(typeof api['backlog:archive'], 'function', 'the backlog:archive channel exists');

  const out = await api['backlog:archive']({ projectId: p.id, numbers: [1] });

  assert.deepEqual(out.results, [{ number: 1, ok: false, error: 'Planned in stage 2: remove it from the roadmap first' }]);
  const issue = api['backlog:get']({ projectId: p.id }).issues.find((i) => i.number === 1);
  assert.equal(issue.state, 'open');
  assert.equal((issue.labels || []).some((l) => String(l?.name ?? l) === 'archived'), false);
  // the roadmap is untouched
  const planned = api['roadmap:get']({ projectId: p.id }).stages.flatMap((s) => s.items.map((x) => x.number));
  assert.deepEqual(planned, [2, 1]);
});
