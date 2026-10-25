// The simulated channels of scripts/screenshot.js and of the E2E suite's Electron main
// (features/support/electron-main.js): the Backlog's sync answers with the cached demo issues, the
// Product Owner, the Supervisor chat and the Oracle answer from their mock selves, filings and Save to
// issue only preview; and the demo answers of some channels: GitHub Actions minutes (Usage), the
// Product Owner's live turn (--po working | writing, #180), the diff viewer's demo branch (#118),
// missing CLIs (--missing-clis, #147) and Keep awake's demo states (--keep-awake active | error, #162).

const path = require('path');

// Demo GitHub Actions minutes (Usage): near the quota, as in the month that motivated the monitor.
function demoActionsUsage() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const item = (sku, quantity, price) => ({ date, product: 'actions', sku, unitType: 'minutes', quantity, grossAmount: quantity * price, netAmount: 0 });
  const { summarizeActionsUsage } = require('../../src/domains/usage/actions-usage'); // only apps that have the channel ask
  return { login: 'demo-user', ...summarizeActionsUsage({ usageItems: [item('Actions Linux', 353, 0.008), item('Actions Windows', 560, 0.016), item('Actions macOS', 35, 0.08)] }, { includedMinutes: 2000, now }) };
}

// --po working | writing (#180): po:ask never answers; its turn's progress is pushed to the window as
// the service would (chat:progress): a few steps done, one running, and with writing the answer's
// first paragraphs and its JSON block (which the drawer hides).
function demoPoTurn(sender, which, projectId) {
  const send = (phase, items = []) => sender.send('chat:progress', { chat: 'po', key: projectId, turnId: 'demo-turn', phase, items });
  send('start');
  const call = (id, name, input) => ({ kind: 'tool_call', id, name, input });
  const done = (id) => ({ kind: 'tool_result', id, is_error: false });
  send('items', [
    { kind: 'thinking' },
    call('t1', 'Read', { file_path: 'C:/projects/demo-app/src/domains/roadmap/roadmap.js' }), done('t1'),
    call('t2', 'Grep', { pattern: 'dispatchRoadmaps' }), done('t2'),
    call('t3', 'Read', { file_path: 'C:/projects/demo-app/src/server/routes.js' }), done('t3'),
    call('t4', 'Bash', { command: 'git log --oneline -20 -- src/server' }), done('t4'),
    call('t5', 'Bash', { command: 'gh issue view 15 --json body' }), done('t5'),
    call('t6', 'Bash', { command: 'gh issue list --state open --limit 100' }),
  ]);
  if (which === 'writing') {
    send('items', [
      done('t6'),
      { kind: 'text', text: '## Proposal\n\nThree runs: the **rename crash** (#11) first, since it blocks the rest; then **#12** and **#9** together: both add a server route, and one run avoids a merge conflict in `src/server`.' },
      { kind: 'text', text: 'Then the small UI fixes, **#10** and **#16**, in one validated run you can check in the app.' },
      { kind: 'text', text: '```json\n{ "summary": "Three runs.", "groups": [] }\n```' },
    ]);
  }
  return new Promise(() => {});
}

// Simulation: the Backlog's sync answers with the cached demo issues instead of calling gh, and the
// Usage screen's GitHub Actions minutes are demo data. `keepAwake`: a demo state of Keep awake, or null.
// `holdOracle`: the Oracle's answer never comes (--oracle answering). `po`: --po working | writing,
// the Product Owner's answer never comes and its live turn is demoPoTurn (#180).
function simulateChannels(ipcMain, keepAwake = null, missing = null, holdOracle = false, po = null) {
  const handle = ipcMain.handle.bind(ipcMain);
  const handlers = {};
  ipcMain.handle = (channel, fn) => {
    handlers[channel] = fn;
    if (missing && missing[channel]) return handle(channel, async (...a) => missing[channel](await fn(...a)));
    if (channel === 'usage:actions') return handle(channel, () => demoActionsUsage());
    if (channel === 'keepAwake:state' && keepAwake) return handle(channel, () => keepAwake);
    // the supervisor's report on the sessions (Analytics) uses the mock provider
    if (channel === 'analytics:analyze') return handle(channel, (e, arg) => fn(e, { ...arg, mock: true }));
    // the Backlog's Product Owner answers from its simulated self (no model call)
    if (channel === 'po:ask') return handle(channel, ['working', 'writing'].includes(po) ? (e, arg) => demoPoTurn(e.sender, po, arg?.projectId) : (e, arg) => fn(e, { ...arg, mock: true }));
    // and its filing of a drafted issue (#117) only previews: never calls gh/glab
    if (channel === 'po:file') return handle(channel, (e, arg) => fn(e, { ...arg, preview: true }));
    // a split (#124) and an epic (#138) applied from a plan answer only preview too
    if (channel === 'po:split' || channel === 'po:epic') return handle(channel, (e, arg) => fn(e, { ...arg, preview: true }));
    // the app-wide Supervisor chat too (#28)
    if (channel === 'supervisor:chat') return handle(channel, (e, arg) => fn(e, { ...arg, mock: true }));
    // and the Oracle (#171): simulated, or held for the answering state
    if (channel === 'oracle:ask') return handle(channel, holdOracle ? () => new Promise(() => {}) : (e, arg) => fn(e, { ...arg, mock: true }));
    if (channel === 'oracle:reset') return handle(channel, (e, arg) => fn(e, { ...arg, mock: true }));
    // Save to issue (Write & Review) only previews: never calls gh/glab
    if (channel === 'backlog:save-doc') return handle(channel, (e, arg) => fn(e, { ...arg, preview: true }));
    // Archive and Restore (#238) are only recorded in the demo backlog: never call gh/glab
    if (channel === 'backlog:archive' || channel === 'backlog:restore') return handle(channel, (e, arg) => fn(e, { ...arg, simulate: true }));
    // the diff viewer (#118): a demo branch, since a simulated run has no diff of its own; a run whose
    // developer reported its files (a seeded real run, #429's predicted vs actual) keeps its own diff
    if (channel === 'run:diff') {
      return handle(channel, async (e, arg) => {
        const own = await Promise.resolve(fn(e, arg)).catch(() => null);
        return own?.files?.length ? own : demoRunDiff(arg?.commit);
      });
    }
    if (channel === 'run:diffFile') return handle(channel, (e, arg) => demoRunDiffFile(arg?.file));
    return handle(channel, channel === 'backlog:sync' ? (e, arg) => handlers['backlog:get'](e, { projectId: arg?.projectId }) : fn);
  };
}

// The diff viewer's demo branch (#118): an added, a modified (two hunks, a word-level change, a long
// line), a deleted, a renamed file, an image, a binary and a huge lockfile, over two commits;
// `--click "#btn-run-diff"` opens it on the Run screen, `--click '.dv [data-dv-mode="unified"]'`
// switches the layout, `--click '.dv [data-dv-expand]'` expands the first collapsed region.
const DEMO_DIFF_BEFORE = [
  "const path = require('path');", '', '// Reads the run\'s settings, with defaults.', 'function loadSettings(dir) {',
  "  const file = path.join(dir, 'settings.json');", '  return { retries: 2, ...readJson(file) };', '}', '',
  ...Array.from({ length: 24 }, (_, i) => `// helper ${i + 1}: unchanged context the viewer collapses`),
  'function retryDelay(attempt) {', '  return 1000 * attempt;', '}', '', 'module.exports = { loadSettings, retryDelay };',
].join('\n');
const DEMO_DIFF_AFTER = DEMO_DIFF_BEFORE
  .replace('  return { retries: 2, ...readJson(file) };', "  // a missing file is not an error: the defaults apply\n  return { retries: 3, timeoutMs: 30000, ...readJson(file, {}) };")
  .replace('  return 1000 * attempt;', '  return Math.min(30000, 1000 * 2 ** attempt); // exponential backoff, capped so a long outage never waits more than thirty seconds per attempt');
const demoSvg = (fill, text) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140"><rect width="240" height="140" rx="12" fill="${fill}"/><text x="120" y="80" font-family="sans-serif" font-size="22" fill="#fff" text-anchor="middle">${text}</text></svg>`).toString('base64')}`;
// A unified patch from hunks [oldStart, newStart, lines (' x' / '-x' / '+x')], counts computed.
function demoPatch(file, hunks) {
  const head = `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n`;
  return head + hunks.map(([o, n, lines]) => {
    const old = lines.filter((l) => l[0] !== '+').length;
    const neu = lines.filter((l) => l[0] !== '-').length;
    return `@@ -${old ? o : 0},${old} +${neu ? n : 0},${neu} @@\n${lines.join('\n')}\n`;
  }).join('');
}
const helper = (i) => ` // helper ${i}: unchanged context the viewer collapses`;
function demoRunDiff(commit) {
  const commits = [
    { sha: 'b7e1c2d9a0f4b7e1c2d9a0f4b7e1c2d9a0f4b7e1', short: 'b7e1c2d', subject: 'Retry with exponential backoff (review fixes)', author: 'developer', date: '2026-10-01T10:42:00Z' },
    { sha: '4f0a9e3c1b2d4f0a9e3c1b2d4f0a9e3c1b2d4f0a', short: '4f0a9e3', subject: 'Settings: defaults when the file is missing', author: 'developer', date: '2026-10-01T09:15:00Z' },
  ];
  const file = (f) => ({ oldFile: null, added: 0, deleted: 0, binary: false, image: false, large: false, patch: null, ...f });
  const settings = file({ file: 'src/settings.js', status: 'modified', added: 3, deleted: 2, patch: demoPatch('src/settings.js', [
    [3, 3, [" // Reads the run's settings, with defaults.", ' function loadSettings(dir) {', "   const file = path.join(dir, 'settings.json');", '-  return { retries: 2, ...readJson(file) };', '+  // a missing file is not an error: the defaults apply', '+  return { retries: 3, timeoutMs: 30000, ...readJson(file, {}) };', ' }', ' ', helper(1)]],
    [31, 32, [helper(23), helper(24), ' function retryDelay(attempt) {', '-  return 1000 * attempt;', '+  return Math.min(30000, 1000 * 2 ** attempt); // exponential backoff, capped so a long outage never waits more than thirty seconds per attempt', ' }', ' ', ' module.exports = { loadSettings, retryDelay };']],
  ]) });
  const files = commit ? [settings] : [
    settings,
    file({ file: 'src/retry/policy.js', status: 'added', added: 4, patch: demoPatch('src/retry/policy.js', [[0, 1, ['+// The retry policy of a failed step.', '+const MAX_ATTEMPTS = 5;', '+', '+module.exports = { MAX_ATTEMPTS };']]]) }),
    file({ file: 'src/legacy-retry.js', status: 'deleted', deleted: 2, patch: demoPatch('src/legacy-retry.js', [[1, 0, ['-// Old fixed delay.', '-module.exports = () => 1000;']]]) }),
    file({ file: 'docs/retries.md', oldFile: 'docs/retry.md', status: 'renamed', added: 1, deleted: 1, patch: demoPatch('docs/retries.md', [[1, 1, [' # Retry', ' ', '-A failed step retries twice.', '+A failed step retries up to five times.']]]) }),
    file({ file: 'docs/images/backoff.svg', status: 'modified', added: null, deleted: null, binary: true, image: true }),
    file({ file: 'assets/icon.ico', status: 'added', added: null, deleted: null, binary: true }),
    file({ file: 'package-lock.json', status: 'modified', added: 1840, deleted: 1203, large: true }),
  ];
  return { simulated: false, unavailable: null, base: 'main', branch: 'retry-backoff-settings-defaults', mergeBase: 'c0ffee0', commits, commit: commit || null, files };
}
function demoRunDiffFile(file) {
  if (file === 'docs/images/backoff.svg') return { file, image: true, patch: null, before: demoSvg('#3b4a7a', 'fixed 1s'), after: demoSvg('#2f7a52', 'backoff 1s → 30s') };
  if (file === 'src/settings.js') return { file, image: false, patch: null, before: DEMO_DIFF_BEFORE, after: DEMO_DIFF_AFTER };
  if (file === 'package-lock.json') return { file, image: false, patch: demoPatch(file, [[1, 1, [' {', '-  "version": "1.0.0",', '+  "version": "1.1.0",', '   "lockfileVersion": 3,']]]), before: null, after: null };
  return { file, image: false, patch: null, before: null, after: null };
}

// --missing-clis: what the Usage and Settings channels answer when CLIs are missing, each built from
// the real answer (the install commands come from the app tree, absent at an older --ref).
function demoMissingClis(appDir, on) {
  if (!on) return null;
  let ic = null;
  try { ic = require(path.join(appDir, 'src', 'domains', 'machine', 'install-commands')); } catch { /* older ref */ }
  const ids = ['claude', 'gh', 'glab', 'grok'];
  return {
    'usage:actions': () => ({ error: 'GitHub billing usage needs the gh "user" scope', hint: 'gh auth refresh -s user', includedMinutes: 2000 }),
    'usage:get': (u) => ({ ...u, providers: (u.providers || []).map((p) => (ids.includes(p.id) ? { ...p, installed: false } : p)) }),
    'env:details': (tools) => tools.map((t) => (ids.includes(t.id)
      ? { id: t.id, name: t.name, path: null, connected: false, ...(ic ? { installCommand: ic.installCommand(t.id), installHint: ic.installHint(t.id) } : {}) }
      : t)),
    'audio:status': (st) => ({ ...st, path: null }),
  };
}

// --keep-awake active | error: what main answers (built by the app tree's src/host/keep-awake.js, absent
// at an older --ref); off and idle are the real state from the setting.
function demoKeepAwake(appDir, which) {
  if (which !== 'active' && which !== 'error') return null;
  let ka;
  try { ka = require(path.join(appDir, 'src', 'host', 'keep-awake')); } catch { return null; }
  const work = ka.workToDo({ runs: [{ waiting: false }, { waiting: true }], roadmaps: [{ projectId: 'demo-app', state: 'running', stage: 3, of: 6 }] });
  const s = which === 'active'
    ? { available: true, enabled: true, holding: true, work, error: null }
    : { available: true, enabled: true, holding: false, work, error: 'Could not keep the computer awake: the system refused the request (demo).' };
  return { ...s, label: ka.keepAwakeLabel(s) };
}

module.exports = {
  demoKeepAwake,
  demoMissingClis,
  simulateChannels,
};
