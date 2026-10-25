// The Refactor proposals workflow's core (#378, src/domains/refactor/refactor-proposals-run.js) and the ranking it
// shares with the Refactor tab (src/domains/refactor/refactor-priority.js rankProject), on a temp workspace (src/domains/workspace/workspace.js
// layout: refactor, architecture, backlog): what a simulated whole run cannot show (one mock finding,
// no synced backlog). The propose step drops a finding whose files are all in an open `refactor` issue's
// Target list and keeps one only partly listed; the report it saves is simulated, so the analysis
// estimate (architecture:estimate) ignores it; the ranking reads the roadmap's planned files; the run
// keeps the top `limit` of its own proposals; filing in a simulation previews and skips a dismissed one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const arch = require('../../src/domains/oracle/oracle-architecture');
const proposals = require('../../src/domains/refactor/refactor-proposals');
const priority = require('../../src/domains/refactor/refactor-priority');
const { layout } = require('../../src/domains/workspace/workspace');

const PROJECT = 'proj-378';
const load = () => require('../../src/domains/refactor/refactor-proposals-run');

function workspace(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'refactor-run-378-'));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true, maxRetries: 5 }));
  const stores = layout(ws);
  for (const dir of [stores.refactor, stores.architecture, stores.backlog]) fs.mkdirSync(dir, { recursive: true });
  return { ws, stores };
}

const finding = (title, paths, kind = 'oversized-unit') => ({
  kind, title, files: paths.map((p) => ({ path: p })), evidence: `${title}: evidence`, severity: 'high', refactor: `Split ${paths[0]}`,
});
const report = (findings) => ({ summary: 'Two hot spots.', areas: [{ area: 'src', verdict: 'Too coupled' }], findings });

// the synced backlog (src/domains/backlog/backlog.js readBacklog's cache: <backlog>/<project>.json)
function writeBacklog(stores, issues) {
  fs.writeFileSync(path.join(stores.backlog, `${PROJECT}.json`), JSON.stringify({ platform: 'github', repo: 'o/r', syncedAt: '2026-10-15T00:00:00.000Z', issues }));
}
const targetBody = (paths) => ['## Context', '- found', '## Target', paths.map((p) => `- \`${p}\``).join('\n'), '## Tasks', '- [ ] do it'].join('\n\n');

test('#378 propose: a finding whose files are all in an open refactor issue\'s Target list is dropped with the issue; one only partly listed becomes a proposal', (t) => {
  const { proposeFindings } = load();
  const { ws, stores } = workspace(t);
  writeBacklog(stores, [
    { number: 41, title: 'Refactor: split engine', state: 'OPEN', labels: [{ name: 'refactor' }], body: targetBody(['src/a.js', 'src/b.js']) },
  ]);
  const out = proposeFindings({ wsRoot: ws, projectId: PROJECT, report: report([finding('Covered', ['src/a.js', 'src/b.js']), finding('Partly covered', ['src/a.js', 'src/c.js'])]), simulated: true });
  assert.deepEqual(out.added.map((x) => x.title), ['Partly covered']);
  assert.equal(out.dropped.length, 1);
  assert.equal(out.dropped[0].title, 'Covered');
  assert.match(out.dropped[0].reason, /#41/);
  assert.deepEqual(proposals.listProposals(stores.refactor, PROJECT).map((p) => p.title), ['Partly covered']);
});

test('#378 propose: a closed refactor issue, or an open issue without the refactor label, drops nothing', (t) => {
  const { proposeFindings } = load();
  const { ws, stores } = workspace(t);
  writeBacklog(stores, [
    { number: 7, title: 'Old refactor', state: 'CLOSED', labels: [{ name: 'refactor' }], body: targetBody(['src/a.js']) },
    { number: 8, title: 'A bug', state: 'OPEN', labels: [{ name: 'bug' }], body: targetBody(['src/a.js']) },
  ]);
  const out = proposeFindings({ wsRoot: ws, projectId: PROJECT, report: report([finding('Split a', ['src/a.js'])]), simulated: true });
  assert.deepEqual(out.added.map((x) => x.title), ['Split a']);
  assert.equal(out.dropped.length, 0);
});

test('#378 propose: a finding matching an open proposal or a dismissed one is dropped, the reason telling which', (t) => {
  const { proposeFindings } = load();
  const { ws, stores } = workspace(t);
  const open = finding('Still open', ['src/open.js']);
  const gone = finding('Dismissed before', ['src/gone.js']);
  const first = proposeFindings({ wsRoot: ws, projectId: PROJECT, report: report([open, gone]), simulated: true });
  assert.equal(first.added.length, 2);
  const dismissed = first.added.find((x) => x.title === 'Dismissed before');
  proposals.dismissProposal(stores.refactor, PROJECT, dismissed.id, 'Not worth it');
  const again = proposeFindings({ wsRoot: ws, projectId: PROJECT, report: report([open, gone]), simulated: true });
  assert.equal(again.added.length, 0);
  const reasons = Object.fromEntries(again.dropped.map((d) => [d.title, d.reason]));
  assert.match(reasons['Dismissed before'], /dismissed/i);
  assert.match(reasons['Dismissed before'], /Not worth it/);
  assert.match(reasons['Still open'], /open proposal/i);
  assert.equal(proposals.listProposals(stores.refactor, PROJECT).length, 2);
});

test('#378 propose: the report is saved in the Architecture history; a simulated one does not count in the analysis estimate, a real one does', (t) => {
  const { proposeFindings } = load();
  const { ws, stores } = workspace(t);
  const sim = proposeFindings({ wsRoot: ws, projectId: PROJECT, report: report([finding('A', ['src/a.js'])]), costUsd: 0, simulated: true });
  const saved = arch.listReports(stores.architecture, PROJECT);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, sim.report_id);
  assert.equal(saved[0].simulated, true);
  assert.equal(arch.estimateCost(saved), null, 'a simulated report is not a basis for the estimate');
  proposeFindings({ wsRoot: ws, projectId: PROJECT, report: report([finding('B', ['src/b.js'])]), costUsd: 0.42, simulated: false });
  const estimate = arch.estimateCost(arch.listReports(stores.architecture, PROJECT));
  assert.equal(estimate?.usd, 0.42);
  assert.equal(estimate?.basis, 1);
});

test('#378 propose: a report that is not in the analysis format is refused', (t) => {
  const { proposeFindings } = load();
  const { ws } = workspace(t);
  assert.throws(() => proposeFindings({ wsRoot: ws, projectId: PROJECT, report: { summary: 'x' }, simulated: true }));
});

test('#378 rankProject: several proposals ranked 1..n and saved; one whose files an unfinished roadmap item plans to change goes last', async (t) => {
  const { stores } = workspace(t);
  const add = (title, file, extra = {}) => proposals.addProposal(stores.refactor, PROJECT, { source: 'architecture', key: `k:${file}`, title, files: [{ path: file }], severity: 'high', ...extra });
  const busy = add('Busy file', 'src/busy.js');
  const hot = add('Hot file', 'src/hot.js');
  const cold = add('Cold file', 'src/cold.js');
  // a filed refactor (issue 12) plans src/busy.js; the roadmap's unfinished item is issue 12
  add('Filed before', 'src/busy.js', { key: 'k:filed' });
  const filed = proposals.listProposals(stores.refactor, PROJECT).find((p) => p.title === 'Filed before');
  proposals.updateProposal(stores.refactor, PROJECT, filed.id, { issue: 12, status: 'dismissed' });
  const item = { id: 'item-12', workflow: 'refactor.yaml', number: 12, title: 'Issue 12', issues: [{ number: 12, url: 'u', title: 'Issue 12' }], status: 'planned' };
  fs.writeFileSync(path.join(stores.backlog, `${PROJECT}.roadmap.json`), JSON.stringify({ state: 'planned', simulated: true, error: null, pausedBy: null, scope: null, updatedAt: null, stages: [{ id: 's1', name: '', note: '', items: [item] }] }));
  const model = { danger_zone: [{ file: 'src/hot.js', score: 90 }, { file: 'src/busy.js', score: 95 }] };

  const { ranking } = await priority.rankProject({ refactorRoot: stores.refactor, backlogDir: stores.backlog, projectId: PROJECT, model, mock: true });
  const order = ranking.slice().sort((a, b) => a.rank - b.rank).map((r) => r.id);
  assert.deepEqual(order, [hot.id, cold.id, busy.id], 'the hottest free file first, the planned one last');
  assert.deepEqual(ranking.map((r) => r.rank).sort((a, b) => a - b), [1, 2, 3]);
  assert.match(ranking.find((r) => r.id === busy.id).reason, /unfinished roadmap item/i);
  const saved = proposals.readRanking(stores.refactor, PROJECT);
  assert.equal(JSON.stringify(saved).includes(hot.id), true, 'the ranking is saved as the Refactor tab reads it');
});

test('#378 rank: the run keeps its own new proposals in rank order, the first `limit` only', async (t) => {
  const { proposeFindings, rankProposals } = load();
  const { ws, stores } = workspace(t);
  proposals.addProposal(stores.refactor, PROJECT, { source: 'architecture', key: 'k:older', title: 'Older proposal', files: [{ path: 'src/older.js' }], severity: 'low' });
  const out = proposeFindings({ wsRoot: ws, projectId: PROJECT, report: report([finding('One', ['src/one.js']), finding('Two', ['src/two.js']), finding('Three', ['src/three.js'])]), simulated: true });
  const ids = out.added.map((x) => x.id);
  const r = await rankProposals({ folder: ws, wsRoot: ws, projectId: PROJECT, ids, limit: 2, mock: true });
  assert.equal(r.ranked.length, 3, 'only the run\'s proposals, not the older one');
  assert.deepEqual(r.ranked.map((x) => x.rank), r.ranked.map((x) => x.rank).slice().sort((a, b) => a - b), 'in rank order');
  assert.deepEqual(r.kept, r.ranked.slice(0, 2).map((x) => x.id));
  assert.equal(r.simulated, true);
  const none = await rankProposals({ folder: ws, wsRoot: ws, projectId: PROJECT, ids: [], limit: 2, mock: true });
  assert.deepEqual(none.kept, []);
});

test('#378 file (simulation): previews numbered `refactor` issues naming the Refactor workflow, skips a dismissed proposal, runs nothing', async (t) => {
  const { proposeFindings, fileProposals } = load();
  const chain = require('@multiagent/shared/chain-model');
  const { ws, stores } = workspace(t);
  const out = proposeFindings({ wsRoot: ws, projectId: PROJECT, report: report([finding('Keep me', ['src/k.js']), finding('Drop me', ['src/d.js'])]), simulated: true });
  const drop = out.added.find((x) => x.title === 'Drop me');
  proposals.dismissProposal(stores.refactor, PROJECT, drop.id, 'Owner dropped it at the gate');
  const filed = await fileProposals({ wsRoot: ws, projectId: PROJECT, folder: ws, ids: out.added.map((x) => x.id), simulated: true });
  assert.equal(filed.simulated, true);
  assert.equal(filed.label, 'refactor');
  assert.equal(filed.workflow, 'refactor.yaml');
  assert.match(filed.message, /simulated/i);
  assert.equal(filed.issues.length, 1);
  assert.match(filed.issues[0].title, /Keep me/);
  assert.match(filed.issues[0].body, /refactor\.yaml/);
  assert.match(filed.issues[0].body, /## Target[\s\S]*src\/k\.js/);
  assert.equal(chain.producedIssues({ issues: filed.issues }).length, 1, 'a pipeline\'s next stage reads the preview');
  assert.deepEqual(filed.skipped.map((s) => s.title), ['Drop me']);
  assert.equal(proposals.listProposals(stores.refactor, PROJECT).some((p) => p.issue), false, 'nothing recorded as filed');
});
