// The app itself: installed CLIs, version, settings and the workspace folder.

const { resolveCommand } = require('../../engine/providers');
const simulation = require('../../engine/simulation');
const workspace = require('../../workspace');

module.exports = (ctx) => [
  {
    channel: 'env:check',
    method: 'checkEnv',
    fn: () => ({
      claude: resolveCommand('claude')?.file || null,
      codex: resolveCommand('codex')?.file || null,
      grok: resolveCommand('grok')?.file || null,
    }),
  },
  { channel: 'env:details', method: 'envDetails', fn: () => ctx.envDetails() },
  {
    channel: 'app:info',
    method: 'appInfo',
    fn: () => ({
      version: ctx.host.appVersion,
      electron: process.versions.electron,
      node: process.versions.node,
      workflowsDir: ctx.ws.workflows,
      simulationOnly: simulation.simulationOnly(),
    }),
  },
  { channel: 'settings:get', method: 'getSettings', fn: () => workspace.readSettings(ctx.ws) },
  {
    channel: 'settings:set',
    method: 'setSettings',
    params: 'patch',
    fn: (patch) => {
      const next = workspace.writeSettings(ctx.ws, patch);
      // a higher limit of concurrent runs frees slots for the Backlog queues
      if (patch && 'concurrentRuns' in patch) ctx.dispatchQueue().catch((e) => console.error('backlog dispatch:', e));
      return next;
    },
  },
  {
    channel: 'workspace:get',
    method: 'getWorkspace',
    fn: () => ({ ...ctx.ws, registry: process.env[workspace.ENV_VAR] ? null : workspace.defaultStore().describe }),
  },
];
