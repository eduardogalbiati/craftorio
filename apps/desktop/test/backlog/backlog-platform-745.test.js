// #745: the Backlog / Roadmap sync uses the project's platform (its host, or the platform stored on a
// self-hosted project), whatever platform the caller asked (a global backlogPlatform setting).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const backlog = require('@craftorio/engine/domains/backlog/backlog');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-745-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'backlog');
}

function fakeExec() {
  const calls = [];
  const exec = async (cli, args) => { calls.push([cli, ...args]); return '[]'; };
  return { exec, calls };
}

test('#745 a gitlab.com project syncs with GitLab even when GitHub is asked', async (t) => {
  const { exec, calls } = fakeExec();
  const data = await backlog.syncBacklog({ dir: tmp(t), project: { id: 'pharmaged', repo: 'https://gitlab.com/eduardogalbiati/pharmaged' }, platform: 'github', exec });
  assert.deepEqual([data.platform, calls[0][0]], ['gitlab', 'glab']);
});

test('#745 a github.com project syncs with GitHub even when GitLab is asked', async (t) => {
  const { exec, calls } = fakeExec();
  const data = await backlog.syncBacklog({ dir: tmp(t), project: { id: 'p', repo: 'https://github.com/o/r' }, platform: 'gitlab', exec });
  assert.deepEqual([data.platform, calls[0][0]], ['github', 'gh']);
});

test('#745 a self-hosted project syncs with the platform stored on it', async (t) => {
  const { exec, calls } = fakeExec();
  const data = await backlog.syncBacklog({ dir: tmp(t), project: { id: 's', repo: 'https://git.company.com/team/r', platform: 'gitlab' }, platform: 'github', exec });
  assert.deepEqual([data.platform, calls[0][0]], ['gitlab', 'glab']);
});

test('#745 platformOf: the project\'s platform, else the fallback, else GitHub', () => {
  assert.deepEqual([
    backlog.platformOf({ repo: 'https://gitlab.com/g/r' }, 'github'),
    backlog.platformOf({ repo: 'https://git.company.com/t/r' }, 'gitlab'),
    backlog.platformOf({ repo: 'https://git.company.com/t/r' }),
  ], ['gitlab', 'gitlab', 'github']);
});
