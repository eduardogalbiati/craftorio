// Installing or signing in a CLI on the engine's machine (#740, packages/engine/service/areas/cli-setup.js):
// Settings › Agents & CLIs starts a job and follows it through cli-setup:changed (its output, a sign-in's
// device code and URL, the CLI checked again at the end). Behind the server's token like every channel
// (#479): only an authenticated client runs them. The channel sweep skips cli-setup:start (it installs software).

const {
  args,
  OBJECT,
  text,
} = require('../schemas');

module.exports = (ctx) => [
  // { id, action: install | login } → { jobId, id, action, status: running | manual, output, command, message? }
  { channel: 'cli-setup:start', method: 'cliSetupStart', params: 'data', schema: { params: args({ id: text(40, 'The CLI: claude, codex, grok, gh, glab, git or gitleaks.'), action: text(20, 'install or login.') }, ['id', 'action']), result: OBJECT }, fn: (data) => ctx.cliSetupStart(data) },
  // a job as it is now (a page opened while it runs)
  { channel: 'cli-setup:status', method: 'cliSetupStatus', params: ['jobId'], schema: { params: args({ jobId: text(80, 'The job, from cli-setup:start.') }, ['jobId']), result: OBJECT }, fn: (opts) => ctx.cliSetupStatus(opts) },
  { event: 'cli-setup:changed', method: 'onCliSetupChanged' },
];
