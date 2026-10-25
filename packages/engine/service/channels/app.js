// The app itself: installed CLIs, version, settings and the workspace folder.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveCommand } = require('../../engine/providers');
const simulation = require('../../engine/simulation');
const machineProfile = require('../../domains/machine/machine-profile');
const workspace = require('../../domains/workspace/workspace');
const {
  args,
  BOOL,
  listOf,
  nullable,
  NUMBER,
  OBJECT,
  OPTIONS,
  shape,
  STRING,
} = require('../schemas');

const CLI_PATH = nullable(STRING);
const DAY_MS = 864e5;

// The memory guard's events (#276: memory.hold, process.killed) of the runs written since `from`
// (epoch ms), each with its run id; only the lines that name one are parsed.
const MEMORY_LINE = /"type"\s*:\s*"(memory\.hold|process\.killed)"/;
function memoryGuardEvents(runsDir, from) {
  const out = [];
  let ids = [];
  try { ids = fs.readdirSync(runsDir); } catch { return out; }
  for (const id of ids) {
    const file = path.join(runsDir, id, 'events.jsonl');
    let text;
    try {
      if (fs.statSync(file).mtimeMs < from) continue;
      text = fs.readFileSync(file, 'utf8');
    } catch { continue; }
    if (!MEMORY_LINE.test(text)) continue;
    for (const line of text.split('\n')) {
      if (!MEMORY_LINE.test(line)) continue;
      try { const e = JSON.parse(line); out.push({ ...e, run_id: e.run_id || id }); } catch { /* a cut line */ }
    }
  }
  return out;
}

module.exports = (ctx) => [
  {
    channel: 'env:check',
    method: 'checkEnv',
    schema: { result: shape({ claude: CLI_PATH, codex: CLI_PATH, grok: CLI_PATH }, ['claude', 'codex', 'grok']) },
    fn: () => ({
      claude: resolveCommand('claude')?.file || null,
      codex: resolveCommand('codex')?.file || null,
      grok: resolveCommand('grok')?.file || null,
    }),
  },
  { channel: 'env:details', method: 'envDetails', schema: { result: listOf(OBJECT) }, fn: () => ctx.envDetails() },
  // #312: a provider account's folder (Settings › Agents & CLIs › Accounts): whether it is signed in
  // (never a credential) and the command that logs it in (null for a CLI without a folder variable).
  // One object (`params: 'opts'`), the way the renderer calls it: `api.accountStatus({ provider, dir })`.
  {
    channel: 'settings:accountStatus',
    method: 'accountStatus',
    params: 'opts',
    schema: {
      params: args({ provider: STRING, dir: STRING }, ['provider', 'dir']),
      result: shape({ signedIn: BOOL, account: STRING, loginCommand: nullable(STRING) }, ['signedIn', 'loginCommand']),
    },
    fn: (opts) => ctx.accountStatus(opts || {}),
  },
  {
    channel: 'app:info',
    method: 'appInfo',
    schema: {
      result: shape({
        version: STRING, electron: STRING, node: STRING, workflowsDir: STRING, simulationOnly: BOOL, totalMemoryBytes: NUMBER, startView: nullable(STRING),
        isPackaged: BOOL, screenshot: BOOL, noSandbox: BOOL, fronts: { type: 'array', items: STRING },
      },['simulationOnly']),
    },
    fn: () => ({
      version: ctx.host.appVersion,
      // the fronts this engine serves (phase 4, #590): the composition's, or every installed one
      fronts: ctx.fronts,
      electron: process.versions.electron,
      node: process.versions.node,
      workflowsDir: ctx.ws.workflows,
      simulationOnly: simulation.simulationOnly(),
      // Settings › Execution gives the memory guard's limit in GB for this machine (#276)
      totalMemoryBytes: os.totalmem(),
      // the screen a Run App copy opens on (#119, set by packages/engine/domains/local/local-preview.js); simulation-only copies only
      startView: simulation.simulationOnly() ? process.env.MULTIAGENT_START_VIEW || null : null,
      // run from source or packaged: the Findings button shows from source (#361, findings-model.js)
      isPackaged: Boolean(ctx.host.isPackaged),
      // a scripts/screenshot.js capture: the Findings button stays hidden unless the setting is on
      screenshot: process.env.MULTIAGENT_SCREENSHOT === '1',
      // the Linux AppImage's launcher started the app without Chromium's sandbox (#476,
      // scripts/release-assets.js APP_RUN): Settings › About warns and gives the alternative
      noSandbox: process.env.MULTIAGENT_NO_SANDBOX === '1',
    }),
  },
  // the engine's version and the contract its channels declare (#339): what GET /api/version answers
  // (packages/engine/server), so a client built for another contract can tell
  {
    channel: 'app:version',
    method: 'appVersion',
    schema: { result: shape({ app: STRING, contract: STRING }, ['app', 'contract']) },
    fn: () => ({ app: ctx.host.appVersion, contract: ctx.contract }),
  },
  // the code this process started with and the code on disk now (changed: a restart is needed, #83)
  { channel: 'app:codeVersion', method: 'codeVersion', schema: { result: OBJECT }, fn: () => ctx.code.check() },
  { channel: 'settings:get', method: 'getSettings', schema: { result: OBJECT }, fn: () => workspace.readSettings(ctx.ws) },
  // the machine profile (#367, packages/engine/domains/machine/machine-profile.js) for Settings › Execution and the Setup: the
  // values in force (auto | manual | unknown), this machine's line and proposal, and the memory guard's
  // suggestion of the last 7 days (null when none). Read-only: Apply goes through settings:set.
  {
    channel: 'settings:machineProfile',
    method: 'machineProfile',
    schema: {
      result: shape({
        state: STRING, concurrentRuns: NUMBER, testWorkers: NUMBER, line: STRING, machine: OBJECT, proposal: nullable(OBJECT), suggestion: nullable(OBJECT),
      }, ['state', 'concurrentRuns', 'testWorkers', 'line']),
    },
    fn: () => {
      const settings = workspace.readSettings(ctx.ws);
      const resolved = machineProfile.resolveLimits(settings, machineProfile.readMachine());
      const now = Date.now();
      const events = memoryGuardEvents(ctx.ws.runs, now - machineProfile.CONSTANTS.SUGGEST_DAYS * DAY_MS);
      const suggestion = settings.concurrentRuns?.enabled
        ? machineProfile.suggestFromMemoryGuard(events, { now, concurrentRuns: resolved.concurrentRuns, timeZone: settings.timeZone })
        : null;
      return { ...resolved, line: machineProfile.machineLine(resolved), suggestion };
    },
  },
  // #390: the processes of finished runs that keep using CPU (the memory guard's last sample), each
  // { pid, ppid, runId, worktree, commandLine, bytes, cpuShare }; [] while the guard is off
  {
    channel: 'memory:strays',
    method: 'strayProcesses',
    schema: { result: listOf(OBJECT) },
    fn: () => ctx.strayProcesses(),
  },
  // stops one of them with its children; refused for any other process or a run in progress again
  {
    channel: 'memory:stopStray',
    method: 'stopStray',
    params: ['pid'],
    schema: { params: args({ pid: NUMBER }, ['pid']), result: OBJECT },
    fn: (opts) => ctx.stopStray(opts?.pid),
  },
  // patch: the settings to change (packages/engine/domains/workspace/workspace.js writeSettings checks each one) → the settings
  {
    channel: 'settings:set',
    method: 'setSettings',
    params: 'patch',
    schema: { params: OPTIONS, result: OBJECT },
    fn: (patch) => {
      const next = workspace.writeSettings(ctx.ws, patch);
      // a higher limit of concurrent runs frees slots for the Backlog queues
      if (patch && ('concurrentRuns' in patch || 'machineProfile' in patch)) ctx.dispatchQueue().catch((e) => console.error('backlog dispatch:', e));
      // the desktop app re-checks Keep awake (#162, apps/desktop/host/main.js)
      ctx.events.emit('settings:changed', next);
      return next;
    },
  },
  // the saved settings, pushed to every window: the interface language redraws them (#329)
  { event: 'settings:changed', method: 'onSettingsChanged' },
  {
    channel: 'workspace:get',
    method: 'getWorkspace',
    // the workspace's folders (packages/engine/domains/workspace/workspace.js layout), and where its location is registered
    schema: { result: shape({ root: STRING }, ['root']) },
    fn: () => ({ ...ctx.ws, registry: process.env[workspace.ENV_VAR] ? null : workspace.defaultStore().describe }),
  },
];
