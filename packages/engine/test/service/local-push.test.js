const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeService } = require('./helpers');

test('backlog: work merged locally shows as not pushed until the Backlog pushes it', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'service-push-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }));
  const origin = path.join(tmp, 'origin.git');
  const folder = path.join(tmp, 'repo');
  git(tmp, 'init', '-q', '--bare', origin);
  git(tmp, 'clone', '-q', origin, folder);
  git(folder, 'checkout', '-q', '-b', 'main');
  git(folder, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(folder, 'push', '-q', '-u', 'origin', 'main');
  git(folder, 'commit', '-q', '--allow-empty', '-m', 'Add the feature\n\nCloses #1');
  const merged = git(folder, 'rev-parse', 'HEAD');

  const p = await api['projects:create']({ name: 'local', folder });
  // a local-hero run that merged #1 into the local main, and the last sync (Bitbucket: the sync
  // after the push stops before calling any CLI, the cache stays)
  const runDir = path.join(ws.runs, 'run-local');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({
    run_id: 'run-local', workflow: 'software-development-local-hero', project_id: p.id, status: 'success', started_at: '2026-09-29T10:00:00Z',
    issues: [{ number: 1, url: 'https://bitbucket.org/o/r/issues/1' }], inputs: {}, sessions: [], worktree: { repo: folder },
    local_merge: { branch: 'feat/one', base: 'main', commit: merged },
  }));
  fs.mkdirSync(ws.backlog, { recursive: true });
  const issue = { number: 1, title: 'One', state: 'open', url: 'https://bitbucket.org/o/r/issues/1', body: '', labels: [], assignees: [], tasks: { done: 0, total: 0 } };
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'bitbucket', repo: 'https://bitbucket.org/o/r', issues: [issue] }));

  // never checked yet: assumed not pushed
  assert.equal(api['backlog:get']({ projectId: p.id }).issues[0].column, 'local');
  const checked = await api['backlog:local']({ projectId: p.id });
  assert.deepEqual([checked.local.ahead, checked.local.base, checked.local.issues], [1, 'main', [1]]);
  assert.equal(checked.backlog.issues[0].column, 'local');
  assert.deepEqual(api['backlog:unpushed'](), [{ projectId: p.id, name: 'local', base: 'main', ahead: 1, issues: [1] }]);
  assert.equal((await api['projects:runs']({ id: p.id })).local.ahead, 1);

  const pushed = await api['backlog:push']({ projectId: p.id });
  assert.deepEqual([pushed.pushed, pushed.issues, pushed.local.ahead], [true, [1], 0]);
  assert.equal(git(origin, 'rev-parse', 'main'), merged);
  // pushed: no longer "local"; Done only when a sync reports #1 closed on the platform
  assert.equal(pushed.backlog.issues[0].column, 'in_progress');
  assert.deepEqual(api['backlog:unpushed'](), []);
  // a push that succeeds is never a conflict notice
  assert.deepEqual(api['notifications:list']({}).items.filter((n) => n.type === 'run.conflict'), []);
});

test('backlog: a push conflict is handed to a run of the local workflow that merged there last', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'service-resolve-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }));
  const origin = path.join(tmp, 'origin.git');
  const folder = path.join(tmp, 'repo');
  const other = path.join(tmp, 'other');
  const change = (cwd, text, msg) => { fs.writeFileSync(path.join(cwd, 'a.txt'), text); git(cwd, 'commit', '-q', '-am', msg); };
  git(tmp, 'init', '-q', '--bare', origin);
  git(tmp, 'clone', '-q', origin, folder);
  git(folder, 'checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(folder, 'a.txt'), 'a\n');
  git(folder, 'add', 'a.txt');
  git(folder, 'commit', '-q', '-m', 'init');
  git(folder, 'push', '-q', '-u', 'origin', 'main');
  git(tmp, 'clone', '-q', '-b', 'main', origin, other);
  change(folder, 'mine\n', 'Change a\n\nCloses #1');
  const mine = git(folder, 'rev-parse', 'HEAD');
  change(other, 'theirs\n', 'their a');
  git(other, 'push', '-q', 'origin', 'main');

  fs.writeFileSync(path.join(ws.workflows, 'fixture-local.yaml'), `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-local
inputs:
  task: { type: string, required: true }
  repo_path: { type: string, required: true }
  language: { type: string, default: js }
  base_branch: { type: string, default: main }
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "{{ inputs.task }}"
`);
  const p = await api['projects:create']({ name: 'local', folder });
  // the local run that merged #1 (its workflow and language are reused)
  const runDir = path.join(ws.runs, 'run-local');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify({ type: 'workflow.started', file: path.join(ws.workflows, 'fixture-local.yaml'), inputs: { language: 'go' } })}\n`);
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({
    run_id: 'run-local', workflow: 'fixture-local', project_id: p.id, status: 'success', started_at: '2026-09-29T10:00:00Z',
    inputs: { language: 'go' }, sessions: [], worktree: { repo: folder }, local_merge: { branch: 'feat/one', base: 'main', commit: mine },
  }));

  // nothing to resolve before the update found origin moved
  await assert.rejects(api['backlog:resolve-push']({ projectId: p.id, files: ['a.txt'], mock: true }), /already has every commit of origin\/main/);
  const changed = [];
  service.events.on('notifications:changed', (n) => changed.push(n));
  const u = await api['backlog:update-push']({ projectId: p.id });
  assert.deepEqual([u.conflict, u.files], [true, ['a.txt']]);
  assert.equal(git(folder, 'rev-parse', 'main'), mine);
  // the conflict (#69) is also a row of the notification center, whoever asked for the push
  assert.equal(changed.length, 1);
  const [conflict] = api['notifications:list']({}).items;
  assert.equal(conflict.type, 'run.conflict');
  assert.equal(conflict.projectId, p.id);
  assert.deepEqual(conflict.target, { view: 'backlog', projectId: p.id });
  assert.match(conflict.title, /Merge conflict: local/);
  assert.match(conflict.body, /Local main conflicts with origin in a\.txt/);

  const finished = [];
  service.events.on('run:event', (ev) => { if (ev.type === 'workflow.finished') finished.push(ev); });
  const started = await api['backlog:resolve-push']({ projectId: p.id, files: ['a.txt'], mock: true });
  for (let i = 0; i < 200 && !finished.length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(finished.length, 1);
  const first = JSON.parse(fs.readFileSync(path.join(started.runDir, 'events.jsonl'), 'utf8').split('\n')[0]);
  assert.equal(path.basename(first.file), 'fixture-local.yaml');
  assert.deepEqual([first.inputs.repo_path, first.inputs.base_branch, first.inputs.language], [folder, 'main', 'go']);
  assert.match(first.inputs.task, /git merge origin\/main/);
  assert.match(first.inputs.task, /conflicted in: a\.txt/);
  assert.equal((await api['runs:list']()).runs.find((r) => r.runId === started.runId).projectId, p.id);
  assert.equal(git(folder, 'rev-parse', 'main'), mine); // a simulated run touches no git
});

// #861: a project created from a local folder: origin is the user's own (non-bare) repository with
// main checked out; the workspace clone has a commit merged locally
async function localOriginProject(t) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'service-local-origin-')));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }));
  const user = path.join(tmp, 'finance-app');
  const folder = path.join(tmp, 'repos', 'finance-app');
  fs.mkdirSync(user);
  git(user, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(user, 'a.txt'), 'a\n');
  git(user, 'add', 'a.txt');
  git(user, 'commit', '-q', '-m', 'init');
  git(tmp, 'clone', '-q', user, folder);
  git(folder, 'commit', '-q', '--allow-empty', '-m', 'Add the feature\n\nCloses #1');
  const merged = git(folder, 'rev-parse', 'HEAD');
  const p = await api['projects:create']({ name: 'finance', folder });
  const runDir = path.join(ws.runs, 'run-local');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({
    run_id: 'run-local', workflow: 'feature', project_id: p.id, status: 'success', started_at: '2026-11-20T10:00:00Z',
    inputs: {}, sessions: [], worktree: { repo: folder }, local_merge: { branch: 'feat/one', base: 'main', commit: merged },
  }));
  return { api, git, user, folder, merged, p };
}

test('#861 backlog: Push of a project whose origin is a local folder with main checked out and clean fast-forwards that folder', async (t) => {
  const f = await localOriginProject(t);
  const pushed = await f.api['backlog:push']({ projectId: f.p.id });
  assert.equal(pushed.pushed, true);
  assert.equal(f.git(f.user, 'rev-parse', 'main'), f.merged);
  assert.equal(f.git(f.user, 'status', '--porcelain'), '');
});

test('#861 backlog: Push (and Update and push) with uncommitted changes in the local origin is refused with the reason and the commands; nothing changes there', async (t) => {
  const f = await localOriginProject(t);
  const before = f.git(f.user, 'rev-parse', 'main');
  fs.writeFileSync(path.join(f.user, 'a.txt'), 'edited by the user\n');
  for (const channel of ['backlog:push', 'backlog:update-push']) {
    await assert.rejects(f.api[channel]({ projectId: f.p.id }), (e) => {
      assert.match(e.message, /uncommitted/i, channel);
      assert.ok(e.message.includes(f.folder), `${channel}: the commands name the clone: ${e.message}`);
      assert.match(e.message, /merge --ff-only/, channel);
      assert.equal(e.status, 400, `${channel}: a client error (shown in the Push dialog)`);
      return true;
    });
    assert.equal(f.git(f.user, 'rev-parse', 'main'), before);
    assert.equal(fs.readFileSync(path.join(f.user, 'a.txt'), 'utf8'), 'edited by the user\n');
  }
});

test('#861 backlog: Push with a diverged local origin is refused with the reason and the commands; nothing changes there', async (t) => {
  const f = await localOriginProject(t);
  f.git(f.user, 'commit', '-q', '--allow-empty', '-m', 'user work');
  const mine = f.git(f.user, 'rev-parse', 'main');
  await assert.rejects(f.api['backlog:push']({ projectId: f.p.id }), (e) => {
    assert.match(e.message, /diverged/i);
    assert.ok(e.message.includes(f.folder), e.message);
    return true;
  });
  assert.equal(f.git(f.user, 'rev-parse', 'main'), mine);
});
