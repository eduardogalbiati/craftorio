// The app itself: installed CLIs, version, settings and the workspace folder.

const os = require('os');
const { resolveCommand } = require('../../engine/providers');
const simulation = require('../../engine/simulation');
const workspace = require('../../workspace');
const {
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
  {
    channel: 'app:info',
    method: 'appInfo',
    schema: {
      result: shape({
        version: STRING, electron: STRING, node: STRING, workflowsDir: STRING, simulationOnly: BOOL, totalMemoryBytes: NUMBER, startView: nullable(STRING),
      }, ['simulationOnly']),
    },
    fn: () => ({
      version: ctx.host.appVersion,
      electron: process.versions.electron,
      node: process.versions.node,
      workflowsDir: ctx.ws.workflows,
      simulationOnly: simulation.simulationOnly(),
      // Settings › Execution gives the memory guard's limit in GB for this machine (#276)
      totalMemoryBytes: os.totalmem(),
      // the screen a Run App copy opens on (#119, set by src/local-preview.js); simulation-only copies only
      startView: simulation.simulationOnly() ? process.env.MULTIAGENT_START_VIEW || null : null,
    }),
  },
  // the code this process started with and the code on disk now (changed: a restart is needed, #83)
  { channel: 'app:codeVersion', method: 'codeVersion', schema: { result: OBJECT }, fn: () => ctx.code.check() },
  { channel: 'settings:get', method: 'getSettings', schema: { result: OBJECT }, fn: () => workspace.readSettings(ctx.ws) },
  // patch: the settings to change (src/workspace.js writeSettings checks each one) → the settings
  {
    channel: 'settings:set',
    method: 'setSettings',
    params: 'patch',
    schema: { params: OPTIONS, result: OBJECT },
    fn: (patch) => {
      const next = workspace.writeSettings(ctx.ws, patch);
      // a higher limit of concurrent runs frees slots for the Backlog queues
      if (patch && 'concurrentRuns' in patch) ctx.dispatchQueue().catch((e) => console.error('backlog dispatch:', e));
      // the desktop app re-checks Keep awake (#162, src/main.js)
      ctx.events.emit('settings:changed', next);
      return next;
    },
  },
  {
    channel: 'workspace:get',
    method: 'getWorkspace',
    // the workspace's folders (src/workspace.js layout), and where its location is registered
    schema: { result: shape({ root: STRING }, ['root']) },
    fn: () => ({ ...ctx.ws, registry: process.env[workspace.ENV_VAR] ? null : workspace.defaultStore().describe }),
  },
];
