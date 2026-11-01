// #670: the issues the Product Owner proposed from a spec, filed on the owner's click
// (productOwner.fileSpec, packages/engine/domains/po/po-file-issues.js): refused while a mockup in scope
// has no issue, a preview runs nothing, and the same answer is filed once.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const productOwner = require('../../domains/po/product-owner');

const AT = '2026-10-31T10:00:00.000Z';
const ISSUES = [{ title: 'Home screen, phase 1', body: '- [ ] The home screen matches `mock-1.jpg`: layout, icons, texts, controls, order' }, { title: 'Home screen, phase 2', body: '- [ ] Settings match `mock-2.jpg`' }];
const COVERED = { ok: true, covered: [{ mockup: 'mock-1.jpg', issue: ISSUES[0].title }, { mockup: 'mock-2.jpg', issue: ISSUES[1].title }], missing: [], later: [], errors: [] };

// A conversation holding one answer with issues from the spec `home-screen`, at AT.
function specConversation(t, coverage = COVERED) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-spec-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const backlogDir = path.join(dir, 'backlog');
  fs.mkdirSync(backlogDir, { recursive: true });
  const answer = { summary: '', groups: [], conflicts: [], enrich: [], spec: { item: 'home-screen', issues: ISSUES, coverage } };
  fs.writeFileSync(path.join(backlogDir, 'demo.po.jsonl'), `${JSON.stringify({ ts: AT, role: 'po', text: '', answer })}\n`);
  let n = 40;
  const calls = [];
  const exec = (cli, args) => { calls.push(cli); n += 1; return `https://github.com/o/r/issues/${n}\n`; };
  const file = (preview) => productOwner.fileSpec({ backlogDir, projectId: 'demo', runsDir: path.join(dir, 'runs'), at: AT, preview, platform: 'github', repo: 'https://github.com/o/r', exec });
  return { file, calls };
}

test('#670 fileSpec: a mockup in scope with no issue refuses the filing and names the mockup; nothing runs', async (t) => {
  const { file, calls } = specConversation(t, { ok: false, covered: [], missing: ['mock-4.jpg'], later: [], errors: ['mock-4.jpg has no issue'] });
  await assert.rejects(file(false), /mock-4\.jpg has no issue/);
  assert.equal(calls.length, 0);
});

test('#670 fileSpec: a preview runs no command, files nothing and says so', async (t) => {
  const { file, calls } = specConversation(t);
  const out = await file(true);
  assert.equal(calls.length, 0);
  assert.equal(out.preview, true);
  assert.deepEqual(out.issues, []);
  assert.match(out.message.text, /Preview/);
});

test('#670 fileSpec: filed for real, one issue per proposed issue with its number, in order; the second time "already filed"', async (t) => {
  const { file, calls } = specConversation(t);
  const out = await file(false);
  assert.equal(calls.length, 2);
  assert.deepEqual(out.issues.map((i) => [i.title, i.number]), [['Home screen, phase 1', 41], ['Home screen, phase 2', 42]]);
  assert.equal(out.message.specFiled.at, AT);
  await assert.rejects(file(false), /already filed/);
  assert.equal(calls.length, 2);
});

test('#670 fileSpec: a preview does not count as filed; the real filing still goes through after it', async (t) => {
  const { file, calls } = specConversation(t);
  await file(true);
  const out = await file(false);
  assert.equal(calls.length, 2);
  assert.equal(out.issues.length, 2);
});
