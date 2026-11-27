// Acceptance tests for #93 (written before the code): the e2e step's Playwright `--grep` is a regular
// expression, so `@issue-83` also selected `@issue-835`. Every grep the workflows and the engine build
// for an issue tag must match `@issue-<n>` only when no digit follows.
//
// Seams: the `e2e` step of the bundled feature workflow and of the repository's hero workflows
// (loaded with loadWorkflow, its command rendered with the run's inputs), and
// visual-baselines.js `missingBaselines(...).command` (the baseline update command, #696).
// workflows/fix.yaml has no e2e step (a fix runs no E2E), so it has nothing to anchor.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadWorkflow, render } = require('../engine/workflow');

const ROOT = path.join(__dirname, '..', '..', '..');
const WORKFLOWS = [
  'workflows/feature.yaml',
  '.craftorio/workflows/ai-development-local-hero.yaml',
  '.craftorio/workflows/ai-development-remote-hero.yaml',
];

const INPUTS = {
  issue: 'https://github.com/eduardogalbiati/craftorio/issues/83',
  issues: ['https://github.com/eduardogalbiati/craftorio/issues/83', 'https://github.com/eduardogalbiati/craftorio/issues/41'],
  e2e_tests: 'write_and_run',
};

// The pattern passed to --grep, without its shell quotes.
function grepOf(command) {
  const m = /--grep\s+(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(command);
  assert.ok(m, `the command passes a --grep (got "${command}")`);
  return { pattern: m[1] ?? m[2] ?? m[3], quoted: m[3] === undefined };
}

// Playwright tests the regex against the test's title, tags included.
const titles = {
  '83': 'backlog.feature.spec.js › Backlog › Open the kanban board @issue-83',
  '83-visual': 'backlog.feature.spec.js › Backlog › Board baseline @issue-83 @visual',
  '41': 'docs.feature.spec.js › Documents › List the documents @issue-41',
  smoke: 'start.feature.spec.js › Start › Start a run @smoke',
  '835': 'mockups.feature.spec.js › Mockups › Export the chosen screens @issue-835',
  '836-visual': 'mockups.feature.spec.js › Mockups › Mockup gallery @issue-836 @visual',
  '410': 'other.feature.spec.js › Other › Something else @issue-410',
  '183': 'other.feature.spec.js › Other › Not this one @issue-183',
};

for (const rel of WORKFLOWS) {
  test(`#93 ${rel}: the e2e grep for issues [83, 41] selects @issue-83, @issue-41 and @smoke but never @issue-835`, () => {
    const wf = loadWorkflow(path.join(ROOT, rel));
    const e2e = wf.steps.find((s) => s.id === 'e2e');
    assert.ok(e2e, 'the workflow has an e2e step');
    const command = render(String(e2e.command || ''), { inputs: INPUTS });
    const { pattern, quoted } = grepOf(command);
    assert.equal(quoted, true, `the pattern is quoted for the shell (got "${command}")`);
    const re = new RegExp(pattern);
    const selected = Object.keys(titles).filter((k) => re.test(titles[k]));
    assert.deepEqual(selected, ['83', '83-visual', '41', 'smoke'], `pattern "${pattern}"`);
  });
}

// ---- visual-baselines.js: the update command of a missing baseline (#696) -------------------------

const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-grep-anchor-93-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

const feature = (issue, png) => [
  `Feature: Board ${issue}`,
  `  @issue-${issue} @visual`,
  `  Scenario: The board ${issue} looks like its baseline`,
  '    Given the app is open',
  `    Then the board looks like the baseline "${png}"`,
  '',
].join('\n');

test('#93 missingBaselines: the update command greps @issue-83 without selecting @issue-835, and can be pasted in a shell', (t) => {
  const { missingBaselines } = require('../engine/visual-baselines');
  const root = tmp(t);
  write(root, 'features/board83.feature', feature(83, '83-board.png'));
  const missing = missingBaselines(root, { issues: [83], platform: 'win32' });
  assert.equal(missing.length, 1);
  const { pattern, quoted } = grepOf(missing[0].command);
  assert.ok(missing[0].command.startsWith('npm run test:e2e:update -- --grep '), missing[0].command);
  assert.ok(quoted || !/[()|<>&;!]/.test(pattern), `a pattern with shell metacharacters is quoted (got "${missing[0].command}")`);
  const re = new RegExp(pattern);
  assert.equal(re.test(titles['83-visual']), true, `"${pattern}" selects @issue-83`);
  assert.equal(re.test(titles['836-visual'].replace('836', '835')), false, `"${pattern}" never selects @issue-835`);
  assert.equal(re.test(titles['183']), false, `"${pattern}" never selects @issue-183`);
});

test('#93 missingBaselines: issue 83 never reports the baselines of @issue-835 scenarios', (t) => {
  const { missingBaselines } = require('../engine/visual-baselines');
  const root = tmp(t);
  write(root, 'features/mockups.feature', feature(835, '835-mockups.png'));
  write(root, 'features/board83.feature', feature(83, '83-board.png'));
  assert.deepEqual(missingBaselines(root, { issues: [83], platform: 'win32' }).map((m) => m.name), ['83-board.png']);
});
