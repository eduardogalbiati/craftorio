// #630: the project's auto-push is removed (Local mode's push is the feature and fix workflows' "push main"
// step). Acceptance tests, written before the code: no backlog:auto-push channel, and backlog:get no longer
// carries autoPush.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeService } = require('./helpers');

test('#630 the backlog:auto-push channel no longer exists', (t) => {
  const { api } = makeService(t);
  assert.equal(api['backlog:auto-push'], undefined);
});

test('#630 a project\'s backlog no longer carries autoPush', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'service-auto-push-630-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }));
  const folder = path.join(tmp, 'repo');
  fs.mkdirSync(folder);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: folder, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'init');

  const p = await api['projects:create']({ name: 'local', folder });
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${p.id}.json`), JSON.stringify({ projectId: p.id, platform: 'github', repo: 'https://github.com/o/r', issues: [] }));

  const backlog = api['backlog:get']({ projectId: p.id });
  assert.equal('autoPush' in backlog, false, `backlog:get's keys: ${JSON.stringify(Object.keys(backlog))}`);
});
