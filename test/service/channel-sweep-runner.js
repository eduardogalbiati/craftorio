// #333: the child process of the hostile-input sweep (test/slow/service-channel-sweep-333.slow.test.js).
// A channel that blocks the event loop (synchronous work on a 1 MB string) cannot be stopped by a
// timer in its own process: the test runs this script, watches its output and kills it when a call
// blocks, then starts it again from the next channel.
// Usage: node channel-sweep-runner.js <workspace dir> <absolute path outside> <first channel index>
// Writes one JSON line per event on stdout: { type: 'call', index, name, label } before each call,
// { type: 'problem', text }, { type: 'trashed', path }, { type: 'unhandled', text }, and at the end
// { type: 'done', swept, polluted, relaunched }. A helper script: it registers no test.
const path = require('path');
const { createService } = require('../../src/service');
const { setupWorkspace } = require('../../src/workspace');
const SKIPS = require('./channel-sweep-skips');

const LIMIT_MS = 4000;
// What a channel throws when it did not check its input: the engine's own messages, never a
// message that names the problem for the client.
const RAW = /Cannot read propert|Cannot set propert|Cannot destructure|is not a function|is not iterable|is not defined|Cannot convert undefined|Cannot convert object|Cannot create property|Invalid array length|Maximum call stack|The "[^"]+" argument must be|\[object Object\]|^undefined$|^null$/;

const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const skipFor = (name) => SKIPS.find((s) => s.channel === name || (s.channel.endsWith(':*') && name.startsWith(s.channel.slice(0, -1))));

function hostileValues(outsideAbs) {
  return [
    ['missing', undefined],
    ['null', null],
    ['number', 42],
    ['array', [1, 'two']],
    ['object', { a: 1 }],
    ['empty string', ''],
    ['parent path', '../../outside'],
    ['absolute path', outsideAbs],
    // a path to an existing file once the channel appends its extension (.json, .yaml, .md…): a
    // traversal that deletes with { force } is invisible when the target does not exist
    ['parent path to a file', '../../outside/sentinel'],
    ['absolute path to a file', path.join(outsideAbs, 'sentinel')],
    ['1 MB string', 'x'.repeat(1024 * 1024)],
    ['__proto__ object', JSON.parse('{"__proto__": {"polluted": "yes"}}')],
  ];
}

// The arguments of one entry: the whole argument hostile, then each named parameter hostile alone.
function argumentsFor(entry, hostile) {
  const out = hostile.map(([label, v]) => [`argument ${label}`, v]);
  if (Array.isArray(entry.params)) {
    for (const p of entry.params.filter((x) => !x.startsWith('...'))) {
      for (const [label, v] of hostile) out.push([`${p} ${label}`, { [p]: v }]);
    }
  }
  return out;
}

async function attempt(fn, arg) {
  let timer;
  const limit = new Promise((resolve) => { timer = setTimeout(() => resolve({ timeout: true }), LIMIT_MS); });
  try {
    return await Promise.race([Promise.resolve().then(() => fn(arg)).then(() => ({ ok: true }), (error) => ({ error })), limit]);
  } finally { clearTimeout(timer); }
}

// Why a call's outcome does not pass, or '' when it does.
function verdict(r) {
  if (r.timeout) return `no answer within ${LIMIT_MS} ms`;
  if (r.ok) return '';
  const e = r.error;
  if (!(e instanceof Error)) return `rejected with a non-Error (${typeof e})`;
  const message = String(e.message || '');
  if (!message.trim()) return 'rejected with an empty message';
  if (RAW.test(message)) return `raw error: ${message.slice(0, 160)}`;
  return '';
}

async function main() {
  const [wsDir, outsideAbs, fromArg] = process.argv.slice(2);
  const from = Number(fromArg) || 0;
  process.env.MULTIAGENT_SIMULATION_ONLY = '1'; // never a real run, provider or CLI terminal
  process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.05';
  // the CLIs' config folders (src/domains/cli/cli-config-dirs.js) inside the scratch workspace: the usage
  // channels (analytics:*) read empty folders instead of this machine's logs in the home folder
  process.env.CLAUDE_CONFIG_DIR = path.join(path.resolve(wsDir), 'cli-config', 'claude');
  process.env.CODEX_HOME = path.join(path.resolve(wsDir), 'cli-config', 'codex');
  process.on('unhandledRejection', (e) => emit({ type: 'unhandled', text: `unhandled rejection: ${String(e?.stack || e).slice(0, 300)}` }));
  process.on('uncaughtException', (e) => emit({ type: 'unhandled', text: `uncaught exception: ${String(e?.stack || e).slice(0, 300)}` }));
  let relaunched = 0;
  const service = createService({
    host: { trashItem: async (p) => { emit({ type: 'trashed', path: String(p) }); }, relaunch: () => { relaunched++; }, appVersion: '9.9.9', isPackaged: false },
  });
  service.setWorkspace(setupWorkspace(path.resolve(wsDir), { persist: false }));

  const hostile = hostileValues(outsideAbs);
  let swept = 0;
  const entries = service.manifest;
  for (let index = from; index < entries.length; index++) {
    const entry = entries[index];
    const name = entry.channel || entry.send;
    if (!name || skipFor(name)) continue;
    const fn = entry.channel ? service.api[name] : service.notifications[name];
    if (typeof fn !== 'function') { emit({ type: 'problem', text: `${name}: in the manifest, not answered by the service and not in channel-sweep-skips.js` }); continue; }
    swept++;
    const failures = [];
    for (const [label, arg] of argumentsFor(entry, hostile)) {
      emit({ type: 'call', index, name, label });
      const r = await attempt(fn, arg);
      const why = verdict(r);
      if (why) failures.push(`${label}: ${why}`);
      if (r.timeout) break; // one time-out is enough to fail the channel; more would only slow the sweep
    }
    if (failures.length) emit({ type: 'problem', text: `${name} (${failures.length} failing call(s)): ${failures.slice(0, 3).join(' | ')}` });
  }

  // what the calls started in the background has time to fail, then the runs they started stop
  await new Promise((r) => setTimeout(r, 1000));
  for (const run of service.api['runs:active']()) {
    try { service.api['run:stop']({ runId: run.runId }); } catch { /* already ended */ }
  }
  for (let i = 0; i < 300 && service.api['runs:active']().length; i++) await new Promise((r) => setTimeout(r, 100));
  emit({ type: 'done', swept, polluted: {}.polluted !== undefined, relaunched });
  service.shutdown();
  setTimeout(() => process.exit(0), 200);
}

main().catch((e) => { emit({ type: 'unhandled', text: `runner failed: ${String(e?.stack || e).slice(0, 300)}` }); process.exit(1); });
