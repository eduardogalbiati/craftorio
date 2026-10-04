// #184 internals: the memory Import's parsing, the checker's command policy and its failing-test
// parsing, the gh / glab read commands, and the digest's hash bookkeeping. Pure: no service, no git.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const knowledge = require('../src/oracle-knowledge');
const check = require('../src/oracle-check');
const platform = require('../src/oracle-platform');

test('memoryEntries: index links become "title: description", headings and blank lines dropped', () => {
  assert.deepEqual(knowledge.memoryEntries('# Memory index\n\n- [PRs](prs.md) - never commit to main\n* plain rule\n1. numbered rule\n- [Only a title](t.md)\n'), [
    '- PRs: never commit to main',
    '- plain rule',
    '- numbered rule',
    '- Only a title',
  ]);
});

test('importMemory: keeps the base, appends only new decisions, ignores case and bullets when comparing', () => {
  const base = '- Ship small PRs.\n';
  assert.equal(knowledge.importMemory(base, '- ship small prs.\n- [X](x.md): new one'), '- Ship small PRs.\n- X: new one\n');
  assert.equal(knowledge.importMemory(base, '# nothing'), base);
  assert.equal(knowledge.importMemory('', '- a'), '- a\n');
});

test('parseCheckCommand: a test runner with plain arguments only', () => {
  assert.deepEqual(check.parseCheckCommand('node --test test/a.test.js'), ['node', '--test', 'test/a.test.js']);
  assert.deepEqual(check.parseCheckCommand('npm test -- test/a.test.js'), ['npm', 'test', '--', 'test/a.test.js']);
  assert.deepEqual(check.parseCheckCommand('python -m pytest tests/test_a.py'), ['python', '-m', 'pytest', 'tests/test_a.py']);
  for (const bad of ['', 'rm -rf .', 'node --test a.js && del x', 'npm test | tail', 'node -e "1"', 'node -e 1', 'python -c 1', 'npm test > out.log', 'git push',
    'npx some-package', 'npm exec some-package', 'go run example.com/x@latest', 'python -m pip install x', 'yarn dlx x']) {
    assert.throws(() => check.parseCheckCommand(bad), undefined, bad);
  }
});

test('failingTests: names from node:test TAP and spec, Jest and go outputs', () => {
  assert.deepEqual(check.failingTests('ok 1 - fine\nnot ok 2 - check sees the bug\n  ---\n'), ['check sees the bug']);
  assert.deepEqual(check.failingTests('✔ fine (1ms)\n✖ breaks on empty (2.5ms)\n'), ['breaks on empty']);
  assert.deepEqual(check.failingTests('--- FAIL: TestLogin (0.00s)\n'), ['TestLogin (0.00s)']);
  assert.deepEqual(check.failingTests('# pass 3\n# fail 0\n'), []);
});

test('platform commands: gh and glab read-only list, view and label list on the target repository', () => {
  const gh = platform.searchCommand({ platform: 'github', target: 'acme/w', query: 'login', state: 'closed' });
  assert.deepEqual(gh.args.slice(0, 4), ['issue', 'list', '--repo', 'acme/w']);
  assert.ok(gh.args.includes('closed'));
  assert.equal(platform.searchCommand({ platform: 'github', target: 'a/b', query: 'x', state: 'weird' }).args.includes('open'), true);
  const gl = platform.searchCommand({ platform: 'gitlab', target: 'g/p', query: 'x', state: 'all' });
  assert.equal(gl.cli, 'glab');
  assert.ok(gl.args.includes('--all'));
  assert.deepEqual(platform.viewCommand({ platform: 'github', target: 'a/b', number: 7 }).args.slice(0, 3), ['issue', 'view', '7']);
  assert.throws(() => platform.viewCommand({ platform: 'github', target: 'a/b', number: 'x' }));
  assert.deepEqual(platform.labelsCommand({ platform: 'gitlab', target: 'g/p' }).args.slice(0, 2), ['label', 'list']);
  assert.deepEqual(platform.viewResult(JSON.stringify({ iid: 3, title: 't', description: 'd', labels: ['bug'] })).labels, ['bug']);
});

test('the knowledge digest: every source skill recorded, hashes current, the prompt text without the hash comments', () => {
  const skillsDir = path.join(__dirname, '..', 'skills');
  const text = fs.readFileSync(path.join(skillsDir, 'oracle', knowledge.KNOWLEDGE_FILE), 'utf8');
  const sources = knowledge.digestSources(text);
  assert.deepEqual(sources.map((x) => x.id).sort(), [...knowledge.KNOWLEDGE_SKILLS].sort());
  for (const { id, hash } of sources) assert.equal(hash, knowledge.skillHash(skillsDir, id), `${id}: run node scripts/oracle-knowledge.js after reviewing its digest`);
  const digest = knowledge.knowledgeDigest([path.join(os.tmpdir(), 'no-such-oracle-dir'), path.join(skillsDir, 'oracle')]);
  assert.doesNotMatch(digest, /sha256:/);
  for (const id of knowledge.KNOWLEDGE_SKILLS) assert.ok(digest.includes(id), id);
});
