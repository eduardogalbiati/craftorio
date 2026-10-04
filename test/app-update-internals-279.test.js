// #279 internals (the developer's tests, next to the acceptance tests of test/app-update-279.test.js):
// the Undo's goBack, the remote URL comparison, the failed-update window, a marked item in the
// "every stage" mode, and the Settings row's HTML (src/renderer/views/settings/settings.js, run in a
// vm sandbox as the other renderer tests do).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const appUpdate = require('../src/app-update');

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// a repository with three commits, git run with an isolated config (the module's git too)
function repo(t) {
  const cfg = path.join(tmp(t, 'appupd-int-cfg-'), 'config');
  fs.writeFileSync(cfg, '');
  const prev = { g: process.env.GIT_CONFIG_GLOBAL, s: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = cfg;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  t.after(() => {
    if (prev.g === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = prev.g;
    if (prev.s === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = prev.s;
  });
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const dir = tmp(t, 'appupd-int-');
  git(dir, 'init', '-q');
  const shas = [];
  for (const [file, text] of [['package-lock.json', '{}\n'], ['a.txt', 'a\n'], ['package-lock.json', '{"x":1}\n']]) {
    fs.writeFileSync(path.join(dir, file), text);
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', `change ${file}`);
    shas.push(git(dir, 'rev-parse', 'HEAD'));
  }
  return { dir, git, shas };
}

test('#279 goBack: moves the app folder back to an earlier commit, installing when the lockfile differs', async (t) => {
  const r = repo(t);
  const installs = [];
  const res = await appUpdate.goBack({ appDir: r.dir, to: r.shas[0].slice(0, 7), install: async (o) => { installs.push(o.cwd); } });
  assert.equal(res.ok, true, res.reason);
  assert.equal(r.git(r.dir, 'rev-parse', 'HEAD'), r.shas[0]);
  assert.equal(res.subjects.length, 2);
  assert.equal(installs.length, 1);
});

test('#279 goBack: refuses a commit that is not earlier, and a failed install returns to the start', async (t) => {
  const r = repo(t);
  const ahead = await appUpdate.goBack({ appDir: r.dir, to: 'deadbeef', install: async () => {} });
  assert.equal(ahead.ok, false);
  const failed = await appUpdate.goBack({ appDir: r.dir, to: r.shas[1], install: async () => { throw new Error('npm ERR!'); } });
  assert.equal(failed.ok, false);
  assert.equal(r.git(r.dir, 'rev-parse', 'HEAD'), r.shas[2]);
});

test('#279 normalizeUrl: https, ssh and .git forms of one repository compare equal', () => {
  const a = appUpdate.normalizeUrl('https://github.com/Owner/Repo.git');
  assert.equal(appUpdate.normalizeUrl('git@github.com:owner/repo.git'), a);
  assert.equal(appUpdate.normalizeUrl('https://token@github.com/owner/repo/'), a);
  assert.notEqual(appUpdate.normalizeUrl('https://github.com/owner/other'), a);
  assert.equal(appUpdate.normalizeUrl(''), '');
});

test('#279 failedUpdate: none within 2 minutes of the intent, the command to go back after', (t) => {
  const ws = tmp(t, 'appupd-int-ws-');
  const t0 = Date.parse('2026-10-04T18:00:00Z');
  appUpdate.writeIntent(ws, { from: 'febef8b123', to: '5d9be33123', subjects: ['fix'], roadmaps: [], appDir: 'C:/app' }, { now: t0 });
  assert.equal(appUpdate.failedUpdate(ws, { now: t0 + 60 * 1000 }), null);
  const f = appUpdate.failedUpdate(ws, { now: t0 + 3 * 60 * 1000 });
  assert.equal(f.command, 'git -C "C:/app" checkout febef8b');
});

test('#279 updateDue: a marked item updates in the "every stage" mode too', () => {
  assert.equal(appUpdate.updateDue({ selfHealing: true, on: true, when: 'stage', event: { type: 'item-merged', item: { updateAfter: true } }, behind: 1 }), true);
  assert.equal(appUpdate.updateDue({ selfHealing: true, on: true, when: 'stage', event: { type: 'item-merged', item: {} }, behind: 1 }), false);
});

// ---- the Settings row -------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const settingsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'settings', 'settings.js'), 'utf8');

function appUpdateHtml(o, info) {
  const src = /function appUpdateHtml\(o, info\) \{[\s\S]*?\n\}/.exec(settingsSrc)?.[0];
  assert.ok(src, 'appUpdateHtml not found in settings.js');
  const sandbox = { esc };
  vm.runInNewContext(`${src}\nthis.appUpdateHtml = appUpdateHtml;`, sandbox);
  return sandbox.appUpdateHtml(o, info);
}

test('#279 Settings row: unavailable says why, off and disabled, with no source line', () => {
  const html = appUpdateHtml({ selfHealing: true, appUpdate: true }, { applies: false, reason: "no project of this workspace is this app's repository" });
  assert.match(html, /data-testid="app-update-reason"[^>]*>Unavailable: no project of this workspace is this app&#39;s repository\./);
  assert.doesNotMatch(html, /app-update-source/);
  assert.match(html, /id="set-app-update"[^>]* disabled/);
  assert.doesNotMatch(html, /id="set-app-update"[^>]* checked/);
});

test('#279 Settings row: applies, with the source, the When modes and the switch; Self-healing off disables it', () => {
  const info = { applies: true, project: { id: 'p1', name: 'multiagent-orchestrator' }, short: '5d9be33', behind: 3 };
  const on = appUpdateHtml({ selfHealing: true, appUpdate: true, appUpdateWhen: 'stage' }, info);
  assert.match(on, /data-testid="app-update-source"/);
  assert.match(on, /multiagent-orchestrator/);
  assert.match(on, /5d9be33/);
  assert.match(on, /3 commits ahead of this app/);
  assert.match(on, /data-app-update-when="stage" aria-pressed="true"/);
  assert.match(on, /id="set-app-update"[^>]* checked/);
  const off = appUpdateHtml({ selfHealing: false, appUpdate: true }, info);
  assert.match(off, /Turn Self-healing on first/);
  assert.match(off, /id="set-app-update"[^>]* disabled/);
});
