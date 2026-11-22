// #845: the screenshot states of a repository with Issues turned off: the Backlog's --issues disabled
// (scripts/screenshot/views/backlog.js demoIssuesDisabled) and the wizard's --review issues-off
// (scripts/screenshot/views/onboarding.js, with --mode review). Plain Node: no Electron window is opened here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs } = require('../scripts/screenshot');
const { demoIssuesDisabled } = require('../scripts/screenshot/views/backlog');

test('--issues disabled is a Backlog option; --review issues-off an option of the wizard', () => {
  assert.equal(parseArgs(['--view', 'backlog', '--issues', 'disabled']).issues, 'disabled');
  assert.throws(() => parseArgs(['--view', 'workflows', '--issues', 'disabled']), /--issues applies to --view backlog/);
  assert.throws(() => parseArgs(['--view', 'backlog', '--issues', 'nope']), /--issues takes disabled/);
  assert.equal(parseArgs(['--view', 'onboarding', '--mode', 'review', '--review', 'issues-off']).review, 'issues-off');
  assert.throws(() => parseArgs(['--view', 'backlog', '--review', 'issues-off']), /--review applies to --view onboarding/);
});

test('demoIssuesDisabled leaves the last sync with no issue and issuesDisabled, and turns on the simulation hook', (t) => {
  const backlog = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-issues-off-'));
  fs.writeFileSync(path.join(backlog, 'p1.json'), JSON.stringify({ projectId: 'p1', repo: 'https://github.com/o/r', issues: [{ number: 1 }], epics: [{ number: 2 }] }));
  const before = process.env.CRAFTORIO_E2E_ISSUES_FAIL;
  t.after(() => {
    if (before === undefined) delete process.env.CRAFTORIO_E2E_ISSUES_FAIL;
    else process.env.CRAFTORIO_E2E_ISSUES_FAIL = before;
  });
  demoIssuesDisabled({ backlog }, 'p1');
  const data = JSON.parse(fs.readFileSync(path.join(backlog, 'p1.json'), 'utf8'));
  assert.deepEqual(data, { projectId: 'p1', repo: 'https://github.com/o/r', issues: [], epics: [], issuesDisabled: true });
  assert.equal(process.env.CRAFTORIO_E2E_ISSUES_FAIL, 'disabled');
});
