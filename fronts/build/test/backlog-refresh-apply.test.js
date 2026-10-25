// skills/backlog-refresh/apply.js (#161): applies a backlog-refresh answer to GitHub/GitLab issues
// with no model. `cli` is injected directly in these tests (apply.js also accepts a fake CLI
// process through BACKLOG_REFRESH_FAKE_CLI; a couple of tests exercise that entry point too).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { apply, parseArgs, parseRemote, refreshBody, MARKER } = require('../../../skills/backlog-refresh/apply');

const APPLY_JS = path.join(__dirname, '..', '..', '..', 'skills', 'backlog-refresh', 'apply.js');

// A throwaway git repository with an `origin` remote (apply() reads the repo from it, never from
// the answer file); machine-independent (explicit user.name/user.email, docs/agents/testing.md).
function gitRepoWithOrigin(t, remote) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-refresh-apply-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-refresh-apply-cfg-'));
  t.after(() => fs.rmSync(cfgDir, { recursive: true, force: true }));
  const cfg = path.join(cfgDir, 'config');
  fs.writeFileSync(cfg, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  git('remote', 'add', 'origin', remote);
  return dir;
}

function makeRunDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-refresh-run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function answerFile(runDir, answer) {
  const file = path.join(runDir, 'refresh.json');
  fs.writeFileSync(file, JSON.stringify(answer));
  return file;
}

// ---- refreshBody: the body with edits applied and the marker note replaced --------------------

test('refreshBody: an edit that matches exactly once is applied', () => {
  const r = refreshBody('before old after', [{ find: 'old', replace: 'new' }], '', '2026-10-02');
  assert.equal(r.body, 'before new after');
});

test('refreshBody: reports a skip when a find does not match', () => {
  const r = refreshBody('some text', [{ find: 'missing', replace: 'x' }], '', '2026-10-02');
  assert.match(r.skip, /appears 0 times/);
});

test('refreshBody: reports a skip when a find matches more than once', () => {
  const r = refreshBody('dup and dup again', [{ find: 'dup', replace: 'x' }], '', '2026-10-02');
  assert.match(r.skip, /appears 2 times/);
});

test('refreshBody: appends a fresh refresh note after the marker when there was none', () => {
  const r = refreshBody('Desc', [], 'hello', '2026-10-02');
  assert.equal(r.body, `Desc\n\n${MARKER}\n> **Backlog refresh** (2026-10-02): hello\n`);
});

test('refreshBody: replaces an older note after the marker, keeping the text before it', () => {
  const current = `Desc\n\n${MARKER}\n> **Backlog refresh** (old): old note\n`;
  const r = refreshBody(current, [], 'new note', '2026-10-02');
  assert.equal(r.body, `Desc\n\n${MARKER}\n> **Backlog refresh** (2026-10-02): new note\n`);
});

// ---- parseRemote ---------------------------------------------------------------------------

test('parseRemote: a GitHub https remote', () => {
  assert.deepEqual(parseRemote('gh', 'https://github.com/o/r.git'), { host: 'github.com', project: 'o/r' });
});

test('parseRemote: a GitHub ssh remote', () => {
  assert.deepEqual(parseRemote('gh', 'git@github.com:o/r.git'), { host: 'github.com', project: 'o/r' });
});

test('parseRemote: rejects a non-GitHub remote for gh', () => {
  assert.throws(() => parseRemote('gh', 'https://gitlab.com/o/r.git'), /not a GitHub remote/);
});

test('parseRemote: rejects a GitHub remote with a nested (subgroup-style) path for gh', () => {
  assert.throws(() => parseRemote('gh', 'https://github.com/group/sub/repo.git'), /not a GitHub remote/);
});

test('parseRemote: a GitLab https remote with a subgroup', () => {
  assert.deepEqual(parseRemote('gl', 'https://gitlab.com/group/sub/repo.git'), { host: 'gitlab.com', project: 'group/sub/repo' });
});

test('parseRemote: a GitLab ssh remote on a self-hosted host', () => {
  assert.deepEqual(parseRemote('gl', 'git@gitlab.example.com:group/repo.git'), { host: 'gitlab.example.com', project: 'group/repo' });
});

test('parseRemote: throws on a string that is not a git remote URL', () => {
  assert.throws(() => parseRemote('gh', 'not a url'), /not a git remote URL/);
});

// ---- parseArgs ------------------------------------------------------------------------------

test('parseArgs: maps the known flags', () => {
  assert.deepEqual(
    parseArgs(['--platform', 'gh', '--mode', 'safe', '--file', 'f.json', '--project', 'p', '--run-id', '123']),
    { platform: 'gh', mode: 'safe', file: 'f.json', project: 'p', runId: '123' },
  );
});

test('parseArgs: throws on an unknown argument', () => {
  assert.throws(() => parseArgs(['--bogus', 'x']), /Unknown argument: --bogus/);
});

test('parseArgs: throws when a flag has no value', () => {
  assert.throws(() => parseArgs(['--platform']), /--platform needs a value/);
});

test('parseArgs: throws when a required key is missing', () => {
  assert.throws(() => parseArgs(['--platform', 'gh']), /missing --mode/);
});

// ---- apply(): safe mode ----------------------------------------------------------------------

test('apply: safe mode applies an edit matching exactly once, writes the body file and records "updated"', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, { issues: [{ number: 5, edits: [{ find: 'old text', replace: 'new text' }], complexity: 0 }] });
  const calls = [];
  const cli = (cmd, args) => {
    calls.push([cmd, args]);
    if (args[1] === 'view') return JSON.stringify({ body: 'before old text after', updatedAt: '', state: 'OPEN', labels: [] });
    return '';
  };
  const result = apply({ platform: 'gh', mode: 'safe', file, project, cli });
  assert.deepEqual(result.results, [{ number: 5, result: 'updated', changes: ['body (1 edit)'] }]);
  assert.equal(fs.readFileSync(path.join(runDir, 'bodies', '5.md'), 'utf8'), 'before new text after');
  const editCall = calls.find((c) => c[1][1] === 'edit');
  assert.deepEqual(editCall, ['gh', ['issue', 'edit', '5', '--repo', 'o/r', '--body-file', path.join(runDir, 'bodies', '5.md')]]);
  const applied = JSON.parse(fs.readFileSync(path.join(runDir, 'applied-safe.json'), 'utf8'));
  assert.equal(applied.repo, 'o/r');
  assert.deepEqual(applied.results, result.results);
});

test('apply: safe mode skips the whole issue when a find does not match', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, { issues: [{ number: 7, edits: [{ find: 'missing text', replace: 'x' }], complexity: 0 }] });
  const cli = (cmd, args) => (args[1] === 'view' ? JSON.stringify({ body: 'nothing here', updatedAt: '', state: 'OPEN', labels: [] }) : '');
  const result = apply({ platform: 'gh', mode: 'safe', file, project, cli });
  assert.equal(result.results[0].result, 'skipped');
  assert.match(result.results[0].reason, /appears 0 times/);
  assert.equal(fs.existsSync(path.join(runDir, 'bodies', '7.md')), false);
});

test('apply: safe mode skips the whole issue when a find matches more than once', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, { issues: [{ number: 8, edits: [{ find: 'dup', replace: 'x' }], complexity: 0 }] });
  const cli = (cmd, args) => (args[1] === 'view' ? JSON.stringify({ body: 'dup and dup', updatedAt: '', state: 'OPEN', labels: [] }) : '');
  const result = apply({ platform: 'gh', mode: 'safe', file, project, cli });
  assert.equal(result.results[0].result, 'skipped');
  assert.match(result.results[0].reason, /appears 2 times/);
});

test('apply: safe mode skips an issue edited on the platform after the review', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, { issues: [{ number: 9, updated_at: '2026-01-01T00:00:00Z', edits: [{ find: 'a', replace: 'b' }], complexity: 0 }] });
  const cli = (cmd, args) => (args[1] === 'view' ? JSON.stringify({ body: 'a text', updatedAt: '2026-02-02T00:00:00Z', state: 'OPEN', labels: [] }) : '');
  const result = apply({ platform: 'gh', mode: 'safe', file, project, cli });
  assert.deepEqual(result.results, [{ number: 9, result: 'skipped', reason: 'edited after the review (2026-02-02T00:00:00Z)' }]);
});

test('apply: safe mode skips a closed issue', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, { issues: [{ number: 10, edits: [{ find: 'a', replace: 'b' }], complexity: 0 }] });
  const cli = (cmd, args) => (args[1] === 'view' ? JSON.stringify({ body: 'a text', updatedAt: '', state: 'CLOSED', labels: [] }) : '');
  const result = apply({ platform: 'gh', mode: 'safe', file, project, cli });
  assert.deepEqual(result.results, [{ number: 10, result: 'skipped', reason: 'not open any more' }]);
});

test('apply: safe mode is a complete no-op (no cli call, nothing recorded) for edits:[] and complexity:0', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, { issues: [{ number: 3, edits: [], complexity: 0, note: 'still current' }] });
  const calls = [];
  const cli = (cmd, args) => { calls.push([cmd, args]); return ''; };
  const result = apply({ platform: 'gh', mode: 'safe', file, project, cli });
  assert.deepEqual(result.results, []);
  assert.deepEqual(calls, []);
});

test('apply: safe mode replaces an older refresh note and keeps the complexity label untouched when it already matches', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const body = `Desc\n\n${MARKER}\n> **Backlog refresh** (old): old note\n`;
  const file = answerFile(runDir, { issues: [{ number: 11, edits: [], complexity: 2, note: 'new note text' }] });
  const calls = [];
  const cli = (cmd, args) => {
    calls.push([cmd, args]);
    if (args[1] === 'view') return JSON.stringify({ body, updatedAt: '', state: 'OPEN', labels: [{ name: 'complexity:2' }] });
    return '';
  };
  const result = apply({ platform: 'gh', mode: 'safe', file, project, cli, today: '2026-10-02' });
  assert.deepEqual(result.results, [{ number: 11, result: 'updated', changes: ['body (0 edits)'] }]);
  assert.equal(fs.readFileSync(path.join(runDir, 'bodies', '11.md'), 'utf8'), `Desc\n\n${MARKER}\n> **Backlog refresh** (2026-10-02): new note text\n`);
  assert.ok(!calls.some((c) => c[1].includes('--add-label')), 'the complexity already matched: no label call');
});

test('apply: safe mode adds a complexity label when the issue had none', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, { issues: [{ number: 4, edits: [], complexity: 3 }] });
  const calls = [];
  const cli = (cmd, args) => {
    calls.push([cmd, args]);
    if (args[1] === 'view') return JSON.stringify({ body: 'same body', updatedAt: '', state: 'OPEN', labels: [{ name: 'bug' }] });
    return '';
  };
  const result = apply({ platform: 'gh', mode: 'safe', file, project, cli });
  assert.deepEqual(result.results, [{ number: 4, result: 'updated', changes: ['no complexity -> complexity:3'] }]);
  const labelCall = calls.find((c) => c[1].includes('--add-label'));
  assert.deepEqual(labelCall, ['gh', ['issue', 'edit', '4', '--repo', 'o/r', '--add-label', 'complexity:3']]);
});

test('apply: safe mode swaps the complexity label, removing the old one', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, { issues: [{ number: 6, edits: [], complexity: 4 }] });
  const calls = [];
  const cli = (cmd, args) => {
    calls.push([cmd, args]);
    if (args[1] === 'view') return JSON.stringify({ body: 'same body', updatedAt: '', state: 'OPEN', labels: [{ name: 'complexity:2' }, { name: 'bug' }] });
    return '';
  };
  const result = apply({ platform: 'gh', mode: 'safe', file, project, cli });
  assert.deepEqual(result.results, [{ number: 6, result: 'updated', changes: ['complexity:2 -> complexity:4'] }]);
  const labelCall = calls.find((c) => c[1].includes('--add-label'));
  assert.deepEqual(labelCall, ['gh', ['issue', 'edit', '6', '--repo', 'o/r', '--add-label', 'complexity:4', '--remove-label', 'complexity:2']]);
});

test('apply: safe mode reports "unchanged" and makes no label call when the requested complexity already matches', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, { issues: [{ number: 12, edits: [], complexity: 3 }] });
  const calls = [];
  const cli = (cmd, args) => {
    calls.push([cmd, args]);
    if (args[1] === 'view') return JSON.stringify({ body: 'same body', updatedAt: '', state: 'OPEN', labels: [{ name: 'complexity:3' }] });
    return '';
  };
  const result = apply({ platform: 'gh', mode: 'safe', file, project, cli });
  assert.deepEqual(result.results, [{ number: 12, result: 'unchanged', changes: [] }]);
  assert.equal(calls.length, 1); // only the view call
});

test('apply: GitLab safe mode updates the description directly (no body file passed to glab)', (t) => {
  const project = gitRepoWithOrigin(t, 'https://gitlab.com/group/sub/repo.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, { issues: [{ number: 6, edits: [{ find: 'A', replace: 'B' }], complexity: 0 }] });
  const calls = [];
  const cli = (cmd, args) => {
    calls.push([cmd, args]);
    if (args[1] === 'view') return JSON.stringify({ description: 'A text', updated_at: '', state: 'opened', labels: [] });
    return '';
  };
  const result = apply({ platform: 'gl', mode: 'safe', file, project, cli });
  assert.equal(result.results[0].result, 'updated');
  const updateCall = calls.find((c) => c[1][1] === 'update');
  assert.deepEqual(updateCall, ['glab', ['issue', 'update', '6', '--repo', 'https://gitlab.com/group/sub/repo', '--description', 'B text']]);
});

test('apply: GitLab safe mode comma-joins the labels to remove', (t) => {
  const project = gitRepoWithOrigin(t, 'https://gitlab.com/group/repo.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, { issues: [{ number: 13, edits: [], complexity: 5 }] });
  const calls = [];
  const cli = (cmd, args) => {
    calls.push([cmd, args]);
    if (args[1] === 'view') return JSON.stringify({ description: 'x', updated_at: '', state: 'opened', labels: ['complexity:1'] });
    return '';
  };
  const result = apply({ platform: 'gl', mode: 'safe', file, project, cli });
  assert.equal(result.results[0].result, 'updated');
  const updateCall = calls.find((c) => c[1].includes('--label'));
  assert.deepEqual(updateCall, ['glab', ['issue', 'update', '13', '--repo', 'https://gitlab.com/group/repo', '--label', 'complexity:5', '--unlabel', 'complexity:1']]);
});

test('apply: a failing cli call is reported as that issue failing; other issues still get processed', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, {
    issues: [
      { number: 20, edits: [{ find: 'x', replace: 'y' }], complexity: 0 },
      { number: 21, edits: [{ find: 'a', replace: 'b' }], complexity: 0 },
    ],
  });
  const cli = (cmd, args) => {
    if (args[1] === 'view' && args[2] === '20') { const e = new Error('boom'); e.stderr = 'gh: rate limited'; throw e; }
    if (args[1] === 'view') return JSON.stringify({ body: 'a text', updatedAt: '', state: 'OPEN', labels: [] });
    return '';
  };
  const result = apply({ platform: 'gh', mode: 'safe', file, project, cli });
  assert.deepEqual(result.results[0], { number: 20, result: 'failed', reason: 'gh: rate limited' });
  assert.equal(result.results[1].result, 'updated');
});

test('apply: throws when the answer is about a different repository than the project\'s remote', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, { repo: 'https://github.com/other/repo', issues: [] });
  assert.throws(
    () => apply({ platform: 'gh', mode: 'safe', file, project, cli: () => '' }),
    /The answer is about https:\/\/github\.com\/other\/repo, the project's remote is o\/r/,
  );
});

// ---- apply(): scope mode ----------------------------------------------------------------------

test('apply: scope mode closes close_done issues with a completed reason and a comment', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, { scope: [{ number: 10, action: 'close_done', reason: 'Fixed by #158' }] });
  const calls = [];
  const cli = (cmd, args) => {
    calls.push([cmd, args]);
    if (args[1] === 'view') return JSON.stringify({ body: '', updatedAt: '', state: 'OPEN', labels: [] });
    return '';
  };
  const result = apply({ platform: 'gh', mode: 'scope', file, project, cli, today: '2026-10-02', runId: 'r1' });
  const closeCall = calls.find((c) => c[1][1] === 'close');
  assert.deepEqual(closeCall, ['gh', ['issue', 'close', '10', '--repo', 'o/r', '--reason', 'completed', '--comment', 'Done on the base branch: Fixed by #158\n\n(Backlog refresh 2026-10-02, run r1, approved by the owner.)']]);
  assert.deepEqual(result.results, [{ number: 10, result: 'closed', reason: 'Done on the base branch: Fixed by #158' }]);
  const applied = JSON.parse(fs.readFileSync(path.join(runDir, 'applied-scope.json'), 'utf8'));
  assert.equal(applied.mode, 'scope');
});

test('apply: scope mode closes close_obsolete issues with a "not planned" reason', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, { scope: [{ number: 14, action: 'close_obsolete', reason: 'Overtaken by #158' }] });
  const calls = [];
  const cli = (cmd, args) => {
    calls.push([cmd, args]);
    return args[1] === 'view' ? JSON.stringify({ body: '', updatedAt: '', state: 'OPEN', labels: [] }) : '';
  };
  const result = apply({ platform: 'gh', mode: 'scope', file, project, cli, today: '2026-10-02' });
  const closeCall = calls.find((c) => c[1][1] === 'close');
  assert.deepEqual(closeCall, ['gh', ['issue', 'close', '14', '--repo', 'o/r', '--reason', 'not planned', '--comment', 'Obsolete: Overtaken by #158\n\n(Backlog refresh 2026-10-02, approved by the owner.)']]);
  assert.equal(result.results[0].result, 'closed');
});

test('apply: scope mode closes close_duplicate issues naming the original', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, { scope: [{ number: 12, action: 'close_duplicate', duplicate_of: 99, reason: 'Covered by #99' }] });
  const cli = (cmd, args) => (args[1] === 'view' ? JSON.stringify({ body: '', updatedAt: '', state: 'OPEN', labels: [] }) : '');
  const result = apply({ platform: 'gh', mode: 'scope', file, project, cli, today: '2026-10-02' });
  assert.deepEqual(result.results, [{ number: 12, result: 'closed', reason: 'Duplicate of #99. Covered by #99' }]);
});

test('apply: scope mode only reports rewrite proposals, with no cli call at all', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, { scope: [{ number: 13, action: 'rewrite', reason: 'Needs a rewrite: scope grew' }] });
  const calls = [];
  const cli = (cmd, args) => { calls.push([cmd, args]); return ''; };
  const result = apply({ platform: 'gh', mode: 'scope', file, project, cli });
  assert.deepEqual(result.results, [{ number: 13, result: 'reported', reason: 'Needs a rewrite: scope grew' }]);
  assert.deepEqual(calls, []);
});

test('apply: scope mode skips a proposal whose issue is not open any more', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, { scope: [{ number: 14, action: 'close_done', reason: 'x' }] });
  const cli = (cmd, args) => (args[1] === 'view' ? JSON.stringify({ body: '', updatedAt: '', state: 'CLOSED', labels: [] }) : '');
  const result = apply({ platform: 'gh', mode: 'scope', file, project, cli });
  assert.deepEqual(result.results, [{ number: 14, result: 'skipped', reason: 'not open any more' }]);
});

test('apply: scope mode skips an unknown action, with no cli call at all', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, { scope: [{ number: 15, action: 'bogus', reason: 'x' }] });
  const calls = [];
  const cli = (cmd, args) => { calls.push([cmd, args]); return ''; };
  const result = apply({ platform: 'gh', mode: 'scope', file, project, cli });
  assert.deepEqual(result.results, [{ number: 15, result: 'skipped', reason: 'unknown action bogus' }]);
  assert.deepEqual(calls, []);
});

test('apply: GitLab scope mode posts a comment, then closes the issue', (t) => {
  const project = gitRepoWithOrigin(t, 'https://gitlab.com/group/repo.git');
  const runDir = makeRunDir(t);
  const file = answerFile(runDir, { scope: [{ number: 16, action: 'close_done', reason: 'Fixed by #158' }] });
  const calls = [];
  const cli = (cmd, args) => {
    calls.push([cmd, args]);
    return args[1] === 'view' ? JSON.stringify({ description: '', updated_at: '', state: 'opened', labels: [] }) : '';
  };
  apply({ platform: 'gl', mode: 'scope', file, project, cli, today: '2026-10-02' });
  const ops = calls.filter((c) => c[1][1] !== 'view');
  assert.equal(ops[0][1][1], 'note');
  assert.equal(ops[1][1][1], 'close');
  assert.deepEqual(ops[0], ['glab', ['issue', 'note', '16', '--repo', 'https://gitlab.com/group/repo', '--message', 'Done on the base branch: Fixed by #158\n\n(Backlog refresh 2026-10-02, approved by the owner.)']]);
  assert.deepEqual(ops[1], ['glab', ['issue', 'close', '16', '--repo', 'https://gitlab.com/group/repo']]);
});

// ---- the CLI entry (BACKLOG_REFRESH_FAKE_CLI) ------------------------------------------------

function fakeCliScript(dir) {
  const file = path.join(dir, 'fake-cli.js');
  fs.writeFileSync(file, [
    "const args = process.argv.slice(3);",
    "if (args[1] === 'view') {",
    "  console.log(JSON.stringify({ body: 'before old after', description: 'before old after', updatedAt: '', updated_at: '', state: process.argv[2] === 'gh' ? 'OPEN' : 'opened', labels: [] }));",
    "} else if (args[2] === '666') {",
    "  process.stderr.write('simulated CLI failure');",
    "  process.exit(1);",
    "} else {",
    "  console.log('');",
    "}",
  ].join('\n'));
  return file;
}

test('apply CLI entry: exits 0 and writes applied-safe.json for a successful safe-mode run', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const fake = fakeCliScript(runDir);
  const file = answerFile(runDir, { issues: [{ number: 30, edits: [{ find: 'old', replace: 'new' }], complexity: 0 }] });
  const res = spawnSync(process.execPath, [APPLY_JS, '--platform', 'gh', '--mode', 'safe', '--file', file, '--project', project], {
    encoding: 'utf8', env: { ...process.env, BACKLOG_REFRESH_FAKE_CLI: fake },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(path.join(runDir, 'applied-safe.json')));
});

test('apply CLI entry: exits 1 when a cli call fails for one issue', (t) => {
  const project = gitRepoWithOrigin(t, 'https://github.com/o/r.git');
  const runDir = makeRunDir(t);
  const fake = fakeCliScript(runDir);
  const file = answerFile(runDir, { issues: [{ number: 666, edits: [{ find: 'old', replace: 'new' }], complexity: 0 }] });
  const res = spawnSync(process.execPath, [APPLY_JS, '--platform', 'gh', '--mode', 'safe', '--file', file, '--project', project], {
    encoding: 'utf8', env: { ...process.env, BACKLOG_REFRESH_FAKE_CLI: fake },
  });
  assert.equal(res.status, 1);
});

test('apply CLI entry: exits 2 and prints the error when a required argument is missing', () => {
  const res = spawnSync(process.execPath, [APPLY_JS, '--platform', 'gh', '--mode', 'safe'], { encoding: 'utf8' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /apply: missing --file/);
});
