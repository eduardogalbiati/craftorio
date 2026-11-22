// #730 acceptance: a finding of the Oracle's report becomes an issue. Written before the code, through
// makeService (simulation only, no network, no real CLI) as refactor-waiting-stage-435.test.js: the issue is
// filed through the host's fileIssue(draft) (it stands in for gh/glab: the only thing faked), the project is
// a scratch git repository with a synced backlog, the reports are saved with oracle-architecture.js
// saveReport. Observable state only: the drafts the fake filer received, the roadmap file
// (roadmap.js readRoadmap) and architecture:report's answer.
// The contract assumed here (new seams of #730):
// - channel architecture:createIssue { projectId, reportId, findingIndex, prioritize? } (method
//   createFindingIssue(projectId, reportId, findingIndex, { prioritize })) → { filed: { issue, issueUrl,
//   stage, waiting } }: files an issue with the finding's text, files and evidence, labelled `refactor`;
//   with `prioritize` it is also added to the roadmap as a planned item (the Refactor workflow, nothing
//   starts); a finding already filed is not filed again (the same issue comes back);
// - architecture:report's findings[] carry `filed` (that object, or null) and `proposal` (the finding's
//   existing Refactor proposal, or null): the proposals made before #730 stay readable under their findings.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const arch = require('@craftorio/engine/domains/oracle/oracle-architecture');
const proposals = require('@craftorio/engine/domains/refactor/refactor-proposals');
const roadmaps = require('@craftorio/engine/domains/roadmap/roadmap');
const { makeService, gitRepo, roadmapIssue } = require('@craftorio/engine/test/service/helpers');

const FIRST_ISSUE = 432;
const URL_OF = (n) => `https://github.com/o/r/issues/${n}`;

const FINDINGS = [
  { kind: 'god-file', title: 'The run loop does too much.', severity: 'high', files: [{ path: 'a.txt', lines: '1-90' }], evidence: 'a.txt changes in every commit of the window.', refactor: 'Split the loop in two modules.' },
  { kind: 'duplicated-rule', title: 'The queue repeats the discount rule.', severity: 'medium', files: [{ path: 'b.txt' }], evidence: 'Two copies of the 10% rule.', refactor: 'Keep one copy.' },
];

async function setup(t) {
  const drafts = [];
  let next = FIRST_ISSUE;
  const fileIssue = async (draft) => {
    drafts.push(draft);
    const number = next++;
    return { number, url: URL_OF(number) };
  };
  const { service, api } = makeService(t, { fileIssue });
  const ws = service.workspace();
  const { dir } = gitRepo(t);
  const p = await api['projects:create']({ name: 'demo', folder: dir });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [5, 6, 432, 433, 434].map(roadmapIssue) }));
  const projectId = p.id;
  const reportId = arch.saveReport(path.join(ws.root, 'architecture'), projectId, {
    date: '2026-10-20T10:00:00.000Z', head: null, branch: 'main', costUsd: 0, simulated: true, report: { summary: 'A small project.', areas: [], findings: FINDINGS },
  }).id;
  const create = (findingIndex, more = {}) => api['architecture:createIssue']({ projectId, reportId, findingIndex, ...more });
  const view = () => api['architecture:report']({ projectId });
  const roadmap = () => roadmaps.readRoadmap(ws.backlog, projectId) || { stages: [] };
  return { api, ws, projectId, reportId, drafts, create, view, roadmap };
}

const itemsOf = (r) => (r.stages || []).flatMap((s) => s.items || []);
const numbersOf = (item) => (item.issues || []).map((i) => Number(i.number));
const plannedNumbers = (r) => itemsOf(r).flatMap(numbersOf).sort((a, b) => a - b);
const labelOf = (draft) => {
  const args = draft.command?.args || [];
  return args[args.indexOf('--label') + 1];
};
const filedOf = (f) => (f?.filed ? [f.filed.issue, f.filed.issueUrl, f.filed.stage ?? null] : null);

test('#730 Create issue files one issue with the finding\'s text, files and evidence, labelled refactor', async (t) => {
  const w = await setup(t);
  await w.create(0);
  assert.equal(w.drafts.length, 1, 'one issue filed');
  const d = w.drafts[0];
  const all = `${d.title}\n${d.body}`;
  assert.equal(String(d.title).includes('The run loop does too much.'), true, `the title: ${d.title}`);
  for (const s of ['a.txt', 'a.txt changes in every commit of the window.']) assert.equal(String(d.body).includes(s), true, `the body has "${s}": ${d.body}`);
  assert.equal(all.includes('Split the loop in two modules.'), true, 'the finding\'s refactor is in the issue');
  assert.equal(labelOf(d), 'refactor');
});

test('#730 Create issue answers the issue, records it on the finding, and adds nothing to the roadmap', async (t) => {
  const w = await setup(t);
  const out = await w.create(0);
  assert.deepEqual([out.filed.issue, out.filed.issueUrl, out.filed.stage ?? null], [432, URL_OF(432), null]);
  const view = await w.view();
  assert.deepEqual(filedOf(view.findings[0]), [432, URL_OF(432), null], 'architecture:report shows the finding\'s issue');
  assert.equal(filedOf(view.findings[1]), null, 'the other finding is not filed');
  assert.deepEqual(plannedNumbers(w.roadmap()), [], 'nothing in the roadmap');
});

test('#730 Create issue and prioritize files the issue and plans it on the Refactor workflow; nothing starts', async (t) => {
  const w = await setup(t);
  const out = await w.create(1, { prioritize: true });
  assert.equal(w.drafts.length, 1, 'one issue filed');
  assert.equal(labelOf(w.drafts[0]), 'refactor');
  const items = itemsOf(w.roadmap());
  assert.equal(items.length, 1, 'one roadmap item');
  assert.deepEqual([items[0].workflow, numbersOf(items[0]), items[0].status, items[0].runId ?? null], ['refactor.yaml', [432], 'planned', null]);
  assert.equal(typeof out.filed.stage, 'number', `the answer names the roadmap stage: ${JSON.stringify(out.filed)}`);
  const view = await w.view();
  assert.deepEqual(filedOf(view.findings[1]), [432, URL_OF(432), out.filed.stage], 'architecture:report shows the issue and its stage');
});

test('#730 Create issue on a finding already filed files no second issue and answers the same one', async (t) => {
  const w = await setup(t);
  await w.create(0);
  const again = await w.create(0);
  assert.equal(w.drafts.length, 1, 'still one issue');
  assert.equal(again.filed.issue, 432);
});

test('#730 Create issue for a finding the report does not have is refused and files nothing', async (t) => {
  const w = await setup(t);
  // refused with the reason (as architecture:sendToRefactor: "No finding 9 in the architecture report …")
  await assert.rejects(async () => w.create(9), /finding 9/i);
  assert.equal(w.drafts.length, 0);
});

test('#730 a finding becomes an issue, not a Refactor proposal', async (t) => {
  const w = await setup(t);
  await w.create(0);
  await w.create(1, { prioritize: true });
  const view = await w.view();
  assert.deepEqual(view.findings.map((f) => f.proposal ?? null), [null, null], 'no proposal under the findings');
});

test('#730 a proposal made from a finding before #730 stays readable under that finding', async (t) => {
  const w = await setup(t);
  const f = FINDINGS[0];
  const stored = proposals.addProposal(path.join(w.ws.root, 'refactor'), w.projectId, {
    source: 'architecture', key: arch.findingKey(f), reportId: w.reportId, kind: f.kind, title: f.title, files: f.files, evidence: f.evidence, severity: f.severity, refactor: f.refactor,
  });
  const view = await w.view();
  assert.equal(view.findings[0].proposal?.id, stored.id, 'the proposal under its finding');
  assert.equal(view.findings[0].proposal?.title, 'The run loop does too much.');
  assert.equal(view.findings[1].proposal ?? null, null, 'none under the other finding');
});
