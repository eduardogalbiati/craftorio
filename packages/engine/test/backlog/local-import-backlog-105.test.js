// #105 acceptance, written before the code: a folder with git and no remote, imported with the new-project wizard
// (its file:// URL), gets the local backlog (#25, #35, #38). Seam: the whole service in a simulation
// (test/project/local-import-105-fixture.js), then the Backlog's refresh (backlog:sync), backlog:get, and the
// review's / Health tab's "Create issue" on a finding (architecture:createIssue, a report saved with
// oracle-architecture.js saveReport). No host fileIssue: nothing stands in for gh / glab, none may be needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const arch = require('../../domains/oracle/oracle-architecture');
const { importFolder, personFolder } = require('../project/local-import-105-fixture');

const FINDING = { kind: 'god-file', title: 'The widget loop does too much.', severity: 'high', files: [{ path: 'README.md' }], evidence: 'README.md changes in every commit.', refactor: 'Split it.' };

test('#105 L2 the Backlog\'s refresh of a folder with no remote answers its local backlog, no "recognizable git URL" error', { timeout: 60000 }, async (t) => {
  const { api, id } = await importFolder(t, personFolder(t));
  const data = await api['backlog:sync']({ projectId: id });
  assert.equal(data.local, true, `the local backlog: ${JSON.stringify({ local: data.local, repo: data.repo, platform: data.platform })}`);
  assert.equal(data.repo ?? null, null);
  assert.deepEqual(data.issues, []);
});

test('#105 L2 Create issue on a finding files a local issue, in the local backlog', { timeout: 60000 }, async (t) => {
  const { api, ws, id } = await importFolder(t, personFolder(t));
  const reportId = arch.saveReport(path.join(ws.root, 'architecture'), id, {
    date: '2026-11-26T10:00:00.000Z', head: null, branch: 'main', costUsd: 0, simulated: true, report: { summary: 'A small folder.', areas: [], findings: [FINDING] },
  }).id;
  const out = await api['architecture:createIssue']({ projectId: id, reportId, findingIndex: 0 });
  assert.equal(Number.isInteger(out.filed.issue), true, `the filed issue: ${JSON.stringify(out.filed)}`);
  assert.equal(out.filed.issueUrl ?? null, null, 'a local issue has no URL');
  const data = await api['backlog:get']({ projectId: id });
  assert.equal(data.local, true, `still the local backlog: ${JSON.stringify({ local: data.local, repo: data.repo })}`);
  const issue = data.issues.find((i) => i.number === out.filed.issue);
  assert.ok(issue, `issue #${out.filed.issue} in the backlog: ${JSON.stringify(data.issues.map((i) => i.number))}`);
  assert.equal(issue.local, true);
  assert.equal(issue.url ?? null, null);
  assert.match(issue.title, /The widget loop does too much\./);
});
