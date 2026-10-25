// src/shared/providers/quota-reset.js (#312): the reset-time rules the adapters' quotaReset share,
// and src/domains/cli/provider-accounts.js's login command quoting and Codex probe. Local time throughout.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { nextClockTime, nextDay } = require('../src/shared/providers/quota-reset');
const { accountLoginCommand, accountStatus } = require('../src/domains/cli/provider-accounts');

const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();

test('#312 nextClockTime: today when still ahead, tomorrow when past, am/pm read', () => {
  assert.equal(nextClockTime('3', '15', 'PM', local(2026, 10, 22, 10)), local(2026, 10, 22, 15, 15));
  assert.equal(nextClockTime('9', undefined, 'am', local(2026, 10, 22, 10)), local(2026, 10, 23, 9));
  assert.equal(nextClockTime('12', '00', 'am', local(2026, 10, 22, 10)), local(2026, 10, 23, 0));
  assert.equal(nextClockTime('15', '30', undefined, local(2026, 10, 22, 10)), local(2026, 10, 22, 15, 30));
});

test('#312 nextDay: a day read on that very day is its end, not the same day a year later', () => {
  assert.equal(nextDay(9, '26', local(2026, 10, 26, 0, 5)), local(2026, 10, 26, 23, 59));
  assert.equal(nextDay(9, '26', local(2026, 10, 8, 10)), local(2026, 10, 26));
  assert.equal(nextDay(0, '3', local(2026, 10, 8, 10)), local(2027, 1, 3));
});

test('#312 the Codex adapter reads "try again at Oct 26th" on Oct 26 as that day', () => {
  const codex = require('../src/shared/providers').resolve('codex');
  const at = codex.quotaReset("You've hit your usage limit. … or try again at Oct 26th.", local(2026, 10, 26, 8));
  assert.equal(new Date(at).getFullYear(), 2026);
  assert.equal(at, local(2026, 10, 26, 23, 59));
});

test('#312 the login command single-quotes the folder for PowerShell and a POSIX shell', () => {
  assert.equal(accountLoginCommand('claude', "C:\\it's $here", 'win32').startsWith("$env:CLAUDE_CONFIG_DIR='C:\\it''s $here'; "), true);
  assert.equal(accountLoginCommand('codex', "/home/a b/it's", 'linux').startsWith("CODEX_HOME='/home/a b/it'\\''s' "), true);
});

test('#312 a Codex folder is probed with its own CODEX_HOME; auth.json alone counts only without a probe', async (t) => {
  const dir = fs.mkdtempSync(path.join(process.env.TMP || os.tmpdir(), 'codex-account-312-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const probe = async (id, env) => { calls.push([id, env]); return false; };
  assert.deepEqual(await accountStatus({ provider: 'codex', dir, probe }), { signedIn: false });
  assert.equal(calls.length, 0, 'no auth.json: no probe');
  fs.writeFileSync(path.join(dir, 'auth.json'), '{}');
  assert.deepEqual(await accountStatus({ provider: 'codex', dir, probe }), { signedIn: false });
  assert.deepEqual(calls, [['codex', { CODEX_HOME: dir }]]);
  assert.deepEqual(await accountStatus({ provider: 'codex', dir, probe: async () => null }), { signedIn: true });
  assert.deepEqual(await accountStatus({ provider: 'codex', dir }), { signedIn: true });
});
