// #702: the Documents service (fronts/plan/engine/domains/docs.js listItems) lists the Build and Test
// stages' documents: plan.md and test.md (sdlc-record sets its `status: collecting`), and reads a plan
// whose Progress is N of N done as `built`.
// The interface these tests assume: listItems(dir) → [{ item, stage, docs: [{ doc, file, status }] }] as
// today, with `test` after `plan` in docs (stage: the latest document's), and the plan's status
// `built` when every row of its `## Progress` table is done (an `accepted` plan with N-1 of N stays
// `accepted`). Plain folders in a temp dir: listItems reads files, no git.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../engine/domains/docs');

const fm = (fields) => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`;
const INTENT = `${fm({ item: 'demo', stage: 'intent', status: 'accepted', date: '2026-10-30', translation: 'intent.pt-BR.md' })}\n# Intent: demo\n\n## Problem\n\nP.\n`;
const SPEC = `${fm({ item: 'demo', stage: 'spec', status: 'signed off', date: '2026-10-31', translation: 'spec.pt-BR.md' })}\n# Spec: demo\n\n## Requirements\n\n**R1. List.** It lists.\n`;
const plan = (statuses) => `${fm({ item: 'demo', stage: 'plan', status: 'accepted', date: '2026-11-01', translation: 'plan.pt-BR.md' })}
# Plan: demo

## Order of work

${statuses.map((_, i) => `${i + 1}. Step ${i + 1}.`).join('\n')}

## Progress

| Step | Status | Run | Commit / PR |
|---|---|---|---|
${statuses.map((s, i) => `| ${i + 1}. Step ${i + 1} | ${s} | ${s === 'done' ? `run-${i + 1}` : '—'} | ${s === 'done' ? 'abc1234' : '—'} |`).join('\n')}
`;
const TEST_MD = `${fm({ item: 'demo', stage: 'test', status: 'collecting', date: '2026-11-02', translation: 'test.pt-BR.md' })}\n# Test: demo evidence\n\n## Suite and tests\n\n| Run | Unit | E2E | Result |\n|---|---|---|---|\n| run-2 | 120 passed | 3 passed | pass |\n`;

function repo(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-702-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    const f = path.join(dir, 'docs', 'work', 'demo', name);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  return dir;
}
const docOf = (item, doc) => (item?.docs || []).find((d) => d.doc === doc) || null;

test('#702 listItems lists the plan and the test documents in stage order, the test one with its `collecting` status', (t) => {
  const dir = repo(t, { 'intent.md': INTENT, 'spec.md': SPEC, 'plan.md': plan(['done', 'pending']), 'test.md': TEST_MD });
  const [item] = load().listItems(dir);
  assert.deepEqual(
    [(item?.docs || []).map((d) => d.doc).join(','), docOf(item, 'test')?.status, docOf(item, 'test')?.file, item?.stage],
    ['intent,spec,plan,test', 'collecting', 'docs/work/demo/test.md', 'test'],
  );
});

test('#702 listItems reads a plan whose Progress is N of N done as `built`', (t) => {
  const dir = repo(t, { 'intent.md': INTENT, 'spec.md': SPEC, 'plan.md': plan(['done', 'done']) });
  const [item] = load().listItems(dir);
  assert.equal(docOf(item, 'plan')?.status, 'built');
});

test('#702 listItems keeps a plan with N-1 of N done `accepted`', (t) => {
  const dir = repo(t, { 'intent.md': INTENT, 'spec.md': SPEC, 'plan.md': plan(['done', 'pending']) });
  const [item] = load().listItems(dir);
  assert.equal(docOf(item, 'plan')?.status, 'accepted');
});
