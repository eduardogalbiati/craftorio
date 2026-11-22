// Service area (#740): installing or signing in a CLI (claude, codex, grok, gh, glab, git) on the ENGINE's
// machine, from any client (the browser UI, the desktop app local or remote): the runs call the CLIs here,
// so they are installed here. A job runs the CLI's install command of this platform or its sign-in
// (packages/engine/domains/machine/install-commands.js: only those fixed strings, never one a client
// sends) in a shell without a terminal, pushes every change as cli-setup:changed (the output, stdout and
// stderr in order; a sign-in's one-time code and URL) and, once the process has ended, checks that CLI
// again (env:details' row) for the panel of Settings › Agents & CLIs.
// - A sign-in that works headless (gh's device code: the owner opens the URL and types the code from any
//   device) runs; the others (claude /login's TUI, codex / grok / glab, whose web sign-in waits for a
//   browser on this machine) are not started: the job says what to run on the server ('manual').
// - The channels (channels/cli-setup.js) are behind the server's token like every channel (#479).
// - With CRAFTORIO_SIMULATION_ONLY=1 nothing is installed: a simulated process writes a few lines and
//   leaves a CLI the E2E hook made missing installed (packages/engine/domains/machine/simulated-clis.js).
// createCliSetup({ spawn, check, emit, platform }) is the job runner without the service (the tests' seam).

const os = require('os');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const childProcess = require('child_process');
const simulation = require('../../engine/simulation');
const simulatedClis = require('../../domains/machine/simulated-clis');
const {
  installCommands,
  signInCommands,
} = require('../../domains/machine/install-commands');
const {
  clientError,
  cliEnv,
} = require('../common');

const ACTIONS = ['install', 'login'];
// the sign-ins that work without a terminal or a browser on this machine, with the flags that keep them
// from asking questions (gh: device code on stderr, then waits for the browser's confirmation)
const HEADLESS_SIGN_IN = {
  gh: 'gh auth login --hostname github.com --git-protocol https --web',
};
// the end of a long output is what matters
const MAX_OUTPUT = 100000;
// an install or a sign-in left waiting is stopped (the owner never completed the device code)
const TIME_LIMIT_MS = { install: 30 * 60 * 1000, login: 15 * 60 * 1000 };
// "First copy your one-time code: ABCD-1234" (gh), "One-time code: WXYZ-9876"
const DEVICE_CODE = /code\s*:\s*([A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+)/i;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/;

const knownIds = (platform) => new Set([...Object.keys(installCommands(platform, { brew: false })), ...Object.keys(signInCommands())]);

// the shell that runs one command line without a terminal (cmd.exe /c on Windows, like terminals.js
// commandSpec but closing when the command ends)
function shellOf(command, platform) {
  if (platform === 'win32') return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${command}"`], windowsVerbatimArguments: true };
  return { file: process.env.SHELL || '/bin/sh', args: ['-c', command] };
}

function createCliSetup({ spawn, check, emit, platform = process.platform, cwd = () => os.homedir(), installFallback = () => null }) {
  const jobs = new Map();
  let seq = 0;
  const view = (job) => {
    const { child, timer, ...rest } = job;
    return { ...rest };
  };
  const push = (job) => emit('cli-setup:changed', view(job));

  // the command an action runs, or a 400 naming what is unknown
  function commandOf(id, action) {
    if (!ACTIONS.includes(action)) throw clientError(`Unknown action "${action}": expected install or login.`);
    if (!knownIds(platform).has(id)) throw clientError(`Unknown CLI "${id}".`);
    const command = action === 'install' ? installCommands(platform)[id] || installFallback(id) : signInCommands()[id];
    if (!command) throw clientError(`The CLI "${id}" has no ${action === 'install' ? 'install' : 'sign-in'} command on this platform.`);
    return command;
  }

  function append(job, text) {
    job.output = (job.output + text).slice(-MAX_OUTPUT);
    if (job.action !== 'login') return;
    const code = DEVICE_CODE.exec(job.output);
    if (code) job.deviceCode = code[1];
    const url = URL_PATTERN.exec(job.output);
    if (url) job.url = url[0].replace(/[.,;)]+$/, '');
  }

  async function finish(job, status, extra = '') {
    if (job.status !== 'running') return;
    clearTimeout(job.timer);
    if (extra) append(job, extra);
    job.status = status;
    job.endedAt = new Date().toISOString();
    try { job.tool = (await check(job.id)) || null; } catch { job.tool = null; }
    push(job);
  }

  // resolves at once with the job (never waits for the process); a 400 for an unknown CLI or action
  async function start({ id, action } = {}) {
    const command = commandOf(id, action);
    // one job per CLI at a time: a second click follows the running one
    const running = [...jobs.values()].find((j) => j.id === id && j.status === 'running');
    if (running) return view(running);
    const jobId = `${Date.now().toString(36)}-${(seq += 1)}`;
    if (action === 'login' && !HEADLESS_SIGN_IN[id]) {
      const job = { jobId, id, action, status: 'manual', output: '', command, message: `This sign-in needs a terminal on the engine's machine: run \`${command}\` on the server, then check again.`, startedAt: new Date().toISOString() };
      jobs.set(jobId, job);
      return view(job);
    }
    const line = action === 'login' ? HEADLESS_SIGN_IN[id] : command;
    const shell = shellOf(line, platform);
    const job = { jobId, id, action, status: 'running', output: '', command: line, startedAt: new Date().toISOString() };
    jobs.set(jobId, job);
    let child;
    try {
      child = spawn(shell.file, shell.args, { cwd: cwd(), env: cliEnv(platform), windowsHide: true, ...(shell.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}) }, { id, action });
    } catch (e) {
      finish(job, 'failed', `${e.message || e}\n`);
      return view(job);
    }
    Object.defineProperty(job, 'child', { value: child, enumerable: false });
    job.timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } finish(job, 'failed', 'Stopped: it took too long.\n'); }, TIME_LIMIT_MS[action]);
    job.timer.unref?.();
    const onData = (chunk) => { append(job, String(chunk)); push(job); };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (e) => finish(job, 'failed', `${e.message || e}\n`));
    child.on('close', (code) => finish(job, code === 0 ? 'done' : 'failed'));
    // a sign-in that asks to press Enter before it opens the browser goes on (no browser here)
    if (action === 'login') child.stdin?.end('\n');
    return view(job);
  }

  function status({ jobId } = {}) {
    const job = jobs.get(jobId);
    if (!job) throw clientError(`Unknown job "${jobId}".`);
    return view(job);
  }

  return { start, status };
}

// a process that installs nothing (CRAFTORIO_SIMULATION_ONLY=1): a few lines, exit 0, and the CLI the
// E2E hook made missing is found afterwards
function simulatedSpawn(file, args, options, { id, action } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => true;
  const lines = [`Simulation only: ${action === 'login' ? 'signing in' : 'installing'} ${id} is simulated, nothing changes on this machine.\n`, `${id}: done (simulated)\n`];
  setTimeout(() => {
    child.stdout.write(lines[0]);
    setTimeout(() => {
      child.stdout.end(lines[1]);
      child.stderr.end();
      if (action === 'install') simulatedClis.markInstalled(id);
      setTimeout(() => child.emit('close', 0, null), 10);
    }, 200);
  }, 50);
  return child;
}

// the real process (refused in simulation, where the simulated one runs instead)
function machineSpawn(file, args, options, meta) {
  if (simulation.simulationOnly()) return simulatedSpawn(file, args, options, meta);
  simulation.refuseReal(`the command "${[file, ...args].join(' ')}"`);
  return childProcess.spawn(file, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
}

module.exports = (ctx) => {
  let runner = null;
  const jobs = () => (runner ||= createCliSetup({
    spawn: machineSpawn,
    check: async (id) => (await ctx.envDetails()).find((t) => t.id === id) || null,
    emit: (event, payload) => ctx.events.emit(event, payload),
    platform: process.platform,
    cwd: () => { try { return ctx.ws?.root || os.homedir(); } catch { return os.homedir(); } },
    // the E2E hook's missing CLI installs (simulated) even where the platform has no command
    installFallback: (id) => (simulatedClis.simulatedState(id) ? simulatedClis.simulatedInstallCommand(id) : null),
  }));

  return {
    // { id, action: 'install' | 'login' } → the job, at once (its changes come as cli-setup:changed)
    cliSetupStart: (data) => jobs().start(data),
    // { jobId } → the job as it is now
    cliSetupStatus: (opts) => jobs().status(opts),
  };
};

module.exports.createCliSetup = createCliSetup;
