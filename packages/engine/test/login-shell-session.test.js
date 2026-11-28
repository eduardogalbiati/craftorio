// The login shell whose PATH the engine merges (#316) runs in a session of its own: an interactive shell
// started from a process with a controlling terminal took that terminal and the kernel stopped the
// engine (or an E2E worker) for good. Seam: providers.resolveCommand in a fresh Node process, with
// SHELL a fake shell that prints, as its "PATH", whether it leads its own session (its pid is its sid).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PROVIDERS = path.join(__dirname, '..', 'engine', 'providers.js');

test('the login shell runs as the leader of its own session, and its PATH is merged first', { skip: process.platform === 'win32' }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'login-shell-session-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const shell = path.join(dir, 'fake-shell');
  // `ps -o sid=` of its own pid: equal to $$ only when it runs in a session of its own (setsid)
  fs.writeFileSync(shell, [
    '#!/bin/sh',
    'sid=$(ps -o sid= -p $$ | tr -d " ")',
    'if [ "$sid" = "$$" ]; then where=own-session; else where=shared-session; fi',
    `printf '__CRAFTORIO_PATH__/fake/%s__CRAFTORIO_PATH__' "$where"`,
    '',
  ].join('\n'), { mode: 0o755 });
  const code = `require(${JSON.stringify(PROVIDERS)}).resolveCommand('sh'); process.stdout.write(process.env.PATH.split(require('path').delimiter)[0]);`;
  const r = spawnSync(process.execPath, ['-e', code], { env: { ...process.env, SHELL: shell }, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '/fake/own-session', 'the login shell leads its own session and its PATH comes first');
});
