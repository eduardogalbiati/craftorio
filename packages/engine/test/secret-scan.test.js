// #49: the secret scan of a run's commits (`type: secret_scan`, gitleaks, no agent). Acceptance tests written
// before the code.
//
// Contract (the interface these tests assume):
// - WorkflowRun.prototype.runSecretScanStep(step, st), as the other machine steps (runCheckStep): real in a
//   simulation too (local and free, as the rule check). It runs gitleaks on the run's own commits (base to HEAD).
// - Output: { kind: 'secret_scan', status, findings: [{ rule, file, line, commit }], message, round }.
//   status 'pass'; 'fail' with the findings; 'skipped' when gitleaks is not installed ("secrets not scanned",
//   in the message and a log event) or the workflow's input turns it off (gitleaks is not called); another
//   status, or 'fail', for an error of gitleaks, which the workflow never takes for a pass.
// - No value of a finding in the output, the events or the run folder.
// - A release scans from the product's last tag (steps.version.output.previous_version), else the whole history.
// - A committed .gitleaksignore entry or .gitleaks.toml allowlist closes a finding.
// - result.md says "secrets not scanned" for a skipped scan.
// - skills/secret-triage, used by code-review; the repository's own .gitleaksignore.
// Seam: the bundled workflows' own step on a small run state, in a scratch repository with a fake gitleaks
// (helpers/fake-gitleaks.js). The routes are in secret-scan-workflows-49.test.js, the whole runs in slow/.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RULE, ROOT, commit, git, installGitleaks, offInput, load, plainGit, planted, project, removeGitleaks, scan, textIn } = require('./helpers/fake-gitleaks');
const { renderResultSummary } = require('../domains/evidence/result-summary');
const { readSkill } = require('../domains/agents/skills');

plainGit();
const LIMIT = { timeout: 120000 };
const SKILLS = path.join(ROOT, 'skills');
const lines = (out) => out.findings.map((f) => `${f.file}:${f.line}`);

// ---- what it scans ------------------------------------------------------------------------------

test('#49 scan: a run whose commits hold no secret passes', LIMIT, async (t) => {
  const { calls } = installGitleaks(t);
  const where = project(t);
  commit(where.dir, 'the change', { 'src/new.txt': 'nothing here\n' });
  const { out } = await scan(t, 'fix', where);
  assert.equal(out.kind, 'secret_scan');
  assert.equal(out.status, 'pass', out.message);
  assert.deepEqual(out.findings, []);
  assert.equal(calls().length > 0, true, 'gitleaks was called');
});

test('#49 scan: a secret in the run\'s commits is found, with only its rule, file, line and commit', LIMIT, async (t) => {
  installGitleaks(t);
  const where = project(t);
  const sha = commit(where.dir, 'the change', { 'src/config.txt': `name\ntoken ${planted()}\n` });
  const { out } = await scan(t, 'fix', where);
  assert.equal(out.status, 'fail');
  assert.equal(out.findings.length, 1);
  const [f] = out.findings;
  assert.deepEqual(Object.keys(f).sort(), ['commit', 'file', 'line', 'rule']);
  assert.deepEqual([f.rule, f.file, f.line], [RULE, 'src/config.txt', 2]);
  assert.equal(f.commit.length >= 7 && sha.startsWith(f.commit), true, f.commit);
});

test('#49 scan: a secret removed by a later commit of the run is still found', LIMIT, async (t) => {
  installGitleaks(t);
  const where = project(t);
  commit(where.dir, 'the change', { 'src/config.txt': `${planted()}\n` });
  commit(where.dir, 'remove it', { 'src/config.txt': 'clean\n' });
  const { out } = await scan(t, 'fix', where);
  assert.equal(out.status, 'fail');
  assert.deepEqual(lines(out), ['src/config.txt:1']);
});

test('#49 scan: a secret rewritten out of the run\'s commits is closed', LIMIT, async (t) => {
  installGitleaks(t);
  const where = project(t);
  commit(where.dir, 'the change', { 'src/config.txt': `${planted()}\n` });
  git(where.dir, 'reset', '-q', '--soft', 'main');
  commit(where.dir, 'the change again', { 'src/config.txt': 'clean\n' });
  assert.equal((await scan(t, 'fix', where)).out.status, 'pass');
});

test('#49 scan: a secret of a commit already on the base is not the run\'s', LIMIT, async (t) => {
  installGitleaks(t);
  const where = project(t, { 'old.txt': `${planted()}\n` });
  commit(where.dir, 'the change', { 'src/new.txt': 'clean\n' });
  assert.equal((await scan(t, 'fix', where)).out.status, 'pass');
});

test('#49 scan: in Remote mode the base is origin\'s, not a local base that is behind it', LIMIT, async (t) => {
  installGitleaks(t);
  const where = project(t);
  // a colleague's commit: on origin/main and under the run's branch, not on the local main
  commit(where.dir, 'a colleague\'s', { 'other.txt': `${planted()}\n` });
  git(where.dir, 'push', '-q', 'origin', 'HEAD:main');
  git(where.repo, 'fetch', '-q', 'origin');
  commit(where.dir, 'the change', { 'src/new.txt': 'clean\n' });
  const { out } = await scan(t, 'fix', where, { inputs: { mode: 'remote' }, remote: true });
  assert.equal(out.status, 'pass', out.message);
});

test('#49 scan: the worktree stays clean', LIMIT, async (t) => {
  installGitleaks(t);
  const where = project(t);
  commit(where.dir, 'the change', { 'src/config.txt': `${planted()}\n` });
  await scan(t, 'fix', where);
  assert.equal(git(where.dir, 'status', '--porcelain'), '');
});

const released = (previous) => ({ version: { output: { kind: 'release_version', status: 'written', version: '1.1.0', product: 'engine', tag_prefix: 'engine-v', tag: 'engine-v1.1.0', folder: 'packages/engine', previous_version: previous }, visits: 1 } });

test('#49 scan: a release scans from the product\'s last tag', LIMIT, async (t) => {
  installGitleaks(t);
  const where = project(t, { 'old.txt': `${planted()}\n` });
  git(where.repo, 'tag', 'engine-v1.0.0', 'main');
  // another product's tag, later than the engine's
  commit(where.repo, 'merged since', { 'src/merged.txt': `${planted()}\n` });
  git(where.repo, 'tag', 'desktop-v2.0.0', 'main');
  git(where.dir, 'reset', '-q', '--hard', 'main');
  const { out } = await scan(t, 'release', where, { steps: released('engine-v1.0.0') });
  assert.equal(out.status, 'fail');
  assert.deepEqual(lines(out), ['src/merged.txt:1']);
});

for (const previous of ['', null]) {
  test(`#49 scan: a release of a product with no tag (${JSON.stringify(previous)}) scans the whole history`, LIMIT, async (t) => {
    installGitleaks(t);
    const where = project(t, { 'old.txt': `${planted()}\n` });
    commit(where.repo, 'remove it', { 'old.txt': 'clean\n' });
    git(where.dir, 'reset', '-q', '--hard', 'main');
    const { out } = await scan(t, 'release', where, { steps: released(previous) });
    assert.equal(out.status, 'fail');
    assert.deepEqual(lines(out), ['old.txt:1']);
  });
}

// ---- values hidden ------------------------------------------------------------------------------

test('#49 values: the value of a finding is in no output, event or file of the run', LIMIT, async (t) => {
  installGitleaks(t);
  const where = project(t);
  const value = planted();
  commit(where.dir, 'the change', { 'src/config.txt': `token ${value}\n` });
  const { out, events, runDir } = await scan(t, 'fix', where);
  assert.equal(out.status, 'fail');
  assert.equal(JSON.stringify(out).includes(value), false, 'the output holds the value');
  assert.equal(JSON.stringify(events).includes(value), false, 'an event holds the value');
  assert.equal(textIn(runDir).includes(value), false, 'a file of the run holds the value');
});

// ---- false positives ----------------------------------------------------------------------------

test('#49 false positive: an entry committed in .gitleaksignore closes the finding, and only that one', LIMIT, async (t) => {
  installGitleaks(t);
  const where = project(t);
  const sha = commit(where.dir, 'the change', { 'test/a.txt': `${planted()}\n`, 'test/b.txt': `${planted()}\n` });
  commit(where.dir, 'a made up token of the tests is not a secret', { '.gitleaksignore': `# a made up token of the tests\n${sha}:test/a.txt:${RULE}:1\n` });
  const { out } = await scan(t, 'fix', where);
  assert.deepEqual(lines(out), ['test/b.txt:1']);
});

test('#49 false positive: with every finding in .gitleaksignore the scan passes', LIMIT, async (t) => {
  installGitleaks(t);
  const where = project(t);
  const sha = commit(where.dir, 'the change', { 'test/a.txt': `${planted()}\n` });
  commit(where.dir, 'a made up token', { '.gitleaksignore': `# a made up token of the tests\n${sha}:test/a.txt:${RULE}:1\n` });
  assert.equal((await scan(t, 'fix', where)).out.status, 'pass');
});

test('#49 false positive: the project\'s gitleaks configuration closes a finding', LIMIT, async (t) => {
  installGitleaks(t);
  const where = project(t);
  commit(where.dir, 'the change', { 'fixtures/a.txt': `${planted()}\n`, '.gitleaks.toml': "# made up tokens\n[allowlist]\npaths = ['''^fixtures/''']\n" });
  assert.equal((await scan(t, 'fix', where)).out.status, 'pass');
});

// ---- not installed, errors, off -----------------------------------------------------------------

test('#49 not installed: the step is skipped, never passed, and says "secrets not scanned"', LIMIT, async (t) => {
  removeGitleaks(t);
  const where = project(t);
  commit(where.dir, 'the change', { 'src/config.txt': `${planted()}\n` });
  const { out, events } = await scan(t, 'fix', where);
  assert.equal(out.status, 'skipped');
  assert.deepEqual(out.findings, []);
  assert.match(out.message, /secrets not scanned/i);
  const logs = events.filter((e) => e.type === 'log').map((e) => e.message).join('\n');
  assert.match(logs, /secrets not scanned/i);
});

for (const mode of ['error', 'partial', 'garbled']) {
  test(`#49 error: gitleaks that fails (${mode}) is not a pass, nor a skip, and no finding`, LIMIT, async (t) => {
    installGitleaks(t, { mode });
    const where = project(t);
    commit(where.dir, 'the change', { 'src/new.txt': 'clean\n' });
    const { out } = await scan(t, 'fix', where);
    assert.equal(['pass', 'skipped'].includes(out.status), false, out.status);
    assert.deepEqual(out.findings || [], []);
    assert.equal(String(out.message || '').length > 0, true, 'the message says what failed');
  });
}

test('#49 off: the input turns the step off: gitleaks is not called and nothing is shown as passed', LIMIT, async (t) => {
  const { calls } = installGitleaks(t);
  const where = project(t);
  commit(where.dir, 'the change', { 'src/config.txt': `${planted()}\n` });
  const { name, off } = offInput(load('fix'), 'fix');
  const { out } = await scan(t, 'fix', where, { inputs: { [name]: off } });
  assert.equal(out.status, 'skipped');
  assert.deepEqual(calls(), []);
});

// ---- the report ---------------------------------------------------------------------------------

const summary = (output) => ({ workflow: 'Fix', run_id: 'run-49', status: 'success', steps: output ? { secret_scan: { output } } : {} });

test('#49 report: result.md says "secrets not scanned" for a skipped scan, never that it passed', () => {
  const text = renderResultSummary('/no/such/run', summary({ kind: 'secret_scan', status: 'skipped', findings: [], message: 'Secrets not scanned: gitleaks is not installed.', round: 1 }));
  assert.match(text, /secrets not scanned/i);
  assert.equal(text.split('\n').some((l) => /secret/i.test(l) && /\bpass/i.test(l)), false, text);
});

test('#49 report: a scan that passed, or a run without one, is not reported as "secrets not scanned"', () => {
  for (const output of [{ kind: 'secret_scan', status: 'pass', findings: [], message: 'No secret found.', round: 1 }, null]) {
    assert.doesNotMatch(renderResultSummary('/no/such/run', summary(output)), /secrets not scanned/i);
  }
});

// ---- the skill and this repository's entries ----------------------------------------------------

test('#49 skill: secret-triage says a real secret is leaked: the owner revokes it, no agent uses or tests it', () => {
  const { name, body } = readSkill(SKILLS, 'secret-triage');
  assert.equal(name, 'secret-triage');
  assert.match(body, /leaked/i);
  assert.match(body, /owner[\s\S]{0,200}revoke|revoke[\s\S]{0,200}owner/i);
  assert.match(body, /never[\s\S]{0,120}\b(use|test|try)|do not[\s\S]{0,120}\b(use|test|try)/i);
});

test('#49 skill: secret-triage says how a false positive is recorded: .gitleaksignore, with its reason', () => {
  const { body } = readSkill(SKILLS, 'secret-triage');
  assert.match(body, /\.gitleaksignore/);
  assert.match(body, /reason/i);
  assert.match(body, /same commit/i);
});

test('#49 skill: the code review uses secret-triage', () => {
  assert.equal(readSkill(SKILLS, 'code-review').uses.includes('secret-triage'), true);
});

test('#49 .gitleaksignore: every entry of this repository is a fingerprint under its reason', () => {
  const text = fs.readFileSync(path.join(ROOT, '.gitleaksignore'), 'utf8');
  let reason = false;
  let entries = 0;
  for (const line of text.split(/\r?\n/).map((l) => l.trim())) {
    if (!line) reason = false;
    else if (line.startsWith('#')) reason = line.length > 12;
    else {
      entries++;
      assert.match(line, /^([0-9a-f]{40}:)?[^:]+:[\w.-]+:\d+$/);
      assert.equal(reason, true, `no reason above ${line}`);
    }
  }
  assert.equal(entries > 0, true, 'no entry');
});
