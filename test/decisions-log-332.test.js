// Acceptance tests for #332: docs/agents/decisions.md, the owner's product decisions (newest first:
// date, decision, why, issues), seeded from closed issues, linked from the backlog, and kept current
// by the issue skills (a Docs task when an issue has a product-wide "Decision (owner)" line). The
// index entry is checked by test/claude-md.test.js. These checks read files only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

// An entry starts on a heading, list item or table row whose first text is its ISO date
// (`## 2026-10-11 ...`, `- **2026-10-11**: ...`, `| 2026-10-11 | ...`) and runs to the next one.
const ENTRY = /^\s*(?:#{2,4}\s+|[-*]\s+|\|\s*)[*_]*(\d{4}-\d{2}-\d{2})/;
function entries() {
  const out = [];
  for (const line of read('docs/agents/decisions.md').split('\n')) {
    const m = line.match(ENTRY);
    if (m) out.push({ date: m[1], text: line });
    else if (out.length) out[out.length - 1].text += `\n${line}`;
  }
  return out;
}

test('docs/agents/decisions.md lists at most about 15 entries, newest first', () => {
  const list = entries();
  assert.ok(list.length >= 3, `${list.length} dated entries`);
  assert.ok(list.length <= 16, `${list.length} entries: keep the log to about 15`);
  const dates = list.map((e) => e.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test('every decision names its issue(s) and why', () => {
  const text = read('docs/agents/decisions.md');
  // a table carries the why in its own column; otherwise each entry says why
  const whyColumn = /^\|.*\bwhy\b.*\|/im.test(text);
  for (const e of entries()) {
    assert.ok(/#\d+/.test(e.text), `no issue in the entry of ${e.date}`);
    if (!whyColumn) assert.ok(/\bwhy\b|because/i.test(e.text), `no why in the entry of ${e.date}`);
  }
});

test('the log is seeded with the three standing decisions of the issue', () => {
  const list = entries();
  const find = (re) => list.find((e) => re.test(e.text));
  const tests = find(/#47\b/);
  assert.ok(tests, 'no entry for #47');
  assert.equal(tests.date, '2026-09-29');
  assert.ok(/test writer/i.test(tests.text), 'the #47 entry does not name the test writer');
  const writeAndRun = find(/write_and_run/);
  assert.ok(writeAndRun, 'no entry for unit and E2E tests write_and_run by default');
  assert.equal(writeAndRun.date, '2026-10-03');
  const openSource = find(/#313\b/);
  assert.ok(openSource, 'no entry for #313');
  assert.equal(openSource.date, '2026-10-11');
  assert.ok(/\bMIT\b/.test(openSource.text), 'the #313 entry does not name the MIT license');
});

test('the log does not repeat a hard rule of the index (AGENTS.md)', () => {
  const hardRules = read('AGENTS.md').split('## Hard rules')[1].split('\n## ')[0];
  const leads = [...hardRules.matchAll(/^- \*\*(.+?)\*\*/gm)].map((m) => m[1]);
  assert.ok(leads.length >= 8, `${leads.length} bold hard-rule leads found in AGENTS.md`);
  const log = read('docs/agents/decisions.md').toLowerCase();
  assert.deepEqual(leads.filter((lead) => log.includes(lead.toLowerCase())), []);
});

test('docs/agents/backlog.md links the decisions log for ideas that were decided', () => {
  assert.ok(/\]\((?:\.\/)?decisions\.md\)/.test(read('docs/agents/backlog.md')), 'backlog.md does not link decisions.md');
});

for (const skill of ['issue-writing', 'issue-creator-gh', 'issue-creator-gl']) {
  test(`skill ${skill}: an issue with a product-wide "Decision (owner)" line gets a Docs task to record it in docs/agents/decisions.md`, () => {
    const text = read(`skills/${skill}/SKILL.md`);
    assert.ok(text.includes('docs/agents/decisions.md'), `${skill} does not name docs/agents/decisions.md`);
    assert.ok(text.includes('Decision (owner)'), `${skill} does not say when (a "Decision (owner)" line)`);
  });
}
