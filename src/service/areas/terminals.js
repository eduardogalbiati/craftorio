// Service area: embedded terminals (xterm.js in the UI + node-pty here, src/terminals.js). Opens a
// session's live log or CLI, a Sessions screen CLI, a shell in a workspace or project folder, a
// suggested command (an install command, #147), a gate's diff and the supervisor's chat; 'term:data' / 'term:exit' go out on `events`, and a CLI
// that stops to wait for the user becomes a notification.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveCommand } = require('../../engine/providers');
const simulation = require('../../engine/simulation');
const projects = require('../../projects');
const registry = require('../../shared/providers');
const skills = require('../../skills');
const supervisor = require('../../supervisor');
const notifier = require('../../notifications');
const { Terminals } = require('../../terminals');
const { SCOPE_HINT } = require('../../actions-usage');
const { followSession } = require('../../session-tail');
const {
  installCommands,
  signInCommands,
} = require('../../install-commands');
const {
  BUNDLED_SKILLS_DIR,
  cliEnv,
  folderMatcher,
  q,
} = require('../common');

module.exports = (ctx) => {
  // CLIs in Sessions terminals that stop and wait for the user
  const waiting = new notifier.WaitDetector({ onWaiting: (id, info, message) => ctx.notify(notifier.sessionNotice(id, info, message)) });
  const terminals = new Terminals((channel, payload) => {
    if (channel === 'term:data') waiting.output(payload.id, payload.data);
    if (channel === 'term:exit') waiting.close(payload.id);
    ctx.events.emit(channel, payload);
  });

  // Interactive chat with the supervisor about a run: the provider's CLI in the run folder, with the
  // run report written to supervisor/context.md and a first message that points to it.
  function supervisorChatSpec(runId) {
    const runDir = ctx.runFolder(runId);
    const cfg = supervisor.supervisorConfig(runDir, ctx.workflowDirs());
    simulation.refuseReal(`the supervisor's CLI (${cfg.provider.command || 'claude'})`);
    const skill = skills.resolveSkill([ctx.ws.skills, BUNDLED_SKILLS_DIR], 'run-supervisor');
    const ctxFile = path.join(runDir, 'supervisor', 'context.md');
    fs.mkdirSync(path.dirname(ctxFile), { recursive: true });
    fs.writeFileSync(ctxFile, supervisor.runReport(runDir, { workflowsDir: ctx.workflowDirs() }));
    const cmd = resolveCommand(cfg.provider.command || 'claude');
    if (!cmd) throw new Error(`The supervisor needs ${cfg.provider.command}, which is not installed.`);
    const first = `You are the supervisor of the multi-agent workflow run in this folder. Read ${path.join(skill.path, 'SKILL.md')} (your method) and supervisor/context.md (the run report); events.jsonl, sessions/ and the other files have the details. Then explain briefly what happened in this run and wait for my questions. Do not change any file.`;
    // read-only: the CLI's own plan mode, sandbox or tool list (its adapter's readOnlyChatArgs)
    const args = registry.byType(cfg.provider.type)?.readOnlyChatArgs?.({ model: cfg.model, skillDir: skill.path, prompt: first }) || [first];
    return { title: `supervisor · ${path.basename(runDir)}`, cwd: runDir, file: cmd.file, args, env: cliEnv() };
  }

  // A program in a pseudoterminal. .cmd/.bat shims (npm-installed CLIs) run through cmd.exe;
  // node-pty re-quotes array arguments on Windows, so cmd.exe gets its command line as a single string.
  // `windowsPty` tells xterm.js the program runs in ConPTY: ConPTY reflows the lines itself on a
  // resize, and xterm reflowing them too leaves pieces of the old layout on screen (full-screen
  // CLIs like Grok's end up garbled).
  function openProgram(spec, cols, rows) {
    const win = process.platform === 'win32';
    const shim = win && /\.(cmd|bat)$/i.test(spec.file);
    const opened = terminals.open({
      ...spec, cols, rows,
      file: shim ? 'cmd.exe' : spec.file,
      args: shim ? `/d /s /c "${[spec.file, ...spec.args].map(q).join(' ')}"` : spec.args,
    });
    return win ? { ...opened, windowsPty: { backend: 'conpty', buildNumber: Number(os.release().split('.')[2]) || undefined } } : opened;
  }

  // A shell in a folder of the workspace or of a project (Open the worktree at a gate)
  function shellSpec(folder) {
    const dir = path.resolve(String(folder || ''));
    const inside = [ctx.ws.root, ...projects.listProjects(ctx.ws.projects).map((x) => x.folder)].filter(Boolean).some((d) => folderMatcher()(dir, d));
    if (!inside) throw new Error('The folder is outside the workspace and the projects.');
    if (!fs.existsSync(dir)) throw new Error(`Folder not found: ${dir}`);
    const win = process.platform === 'win32';
    return { title: path.basename(dir), cwd: dir, file: win ? 'cmd.exe' : process.env.SHELL || '/bin/sh', args: [], env: cliEnv() };
  }

  // A command the app suggests (#147: an install command, gh's billing scope; #319: a CLI's sign-in)
  // in a shell in the workspace folder; the shell stays open afterwards to show the result or finish
  // a login. Any other command is refused: the play buttons only send these fixed strings (#398: the
  // same Homebrew-aware list as the hints; `opts.brew` overrides the lookup). One env for the whole
  // terminal, with the folders detection searched (#397), so the shell left open finds the CLI too.
  function commandSpec(command, platform = process.platform, opts = {}) {
    const allowed = [...Object.values(installCommands(platform, opts)), ...Object.values(signInCommands()), SCOPE_HINT].filter(Boolean);
    if (!allowed.includes(command)) throw new Error('Only the commands the app suggests can run in a command terminal.');
    const cwd = ctx.ws.root || os.homedir();
    const env = cliEnv(platform);
    if (platform === 'win32') return { title: command, cwd, file: 'cmd.exe', args: `/s /k "${command}"`, env };
    const shell = process.env.SHELL || '/bin/sh';
    return { title: command, cwd, file: shell, args: ['-c', `${command}; exec '${shell}'`], env };
  }

  function openTerminal({ kind, runId, sessionId, cols, rows, ...opts }) {
    if (kind === 'supervisor') return openProgram(supervisorChatSpec(runId || ctx.liveRun(null)?.runId), cols, rows);
    if (kind === 'shell') return { ...openProgram(shellSpec(opts.folder), cols, rows), cwd: path.resolve(String(opts.folder)) };
    if (kind === 'command') {
      const spec = commandSpec(opts.command);
      simulation.refuseReal(`the command "${opts.command}"`);
      return { ...openProgram(spec, cols, rows), cwd: spec.cwd };
    }
    if (kind === 'diff') {
      const spec = ctx.gateDiffSpec({ runId, approvalId: opts.approvalId, file: opts.file });
      return { ...openProgram(spec, cols, rows), cwd: spec.cwd };
    }
    if (kind === 'cli-resume' || kind === 'cli-new') {
      const spec = ctx.cliSessionSpec({ kind, sessionId, ...opts });
      const opened = openProgram(spec, cols, rows);
      waiting.watch(opened.id, { title: spec.title });
      return { ...opened, cwd: spec.cwd };
    }
    const spec = ctx.terminalSpec(runId, sessionId, kind === 'cli' ? 'cli' : 'live');
    if (kind !== 'cli') {
      // live: follow the log in this process (see src/terminals.js for why not a child process)
      const [, runDir, id] = spec.args;
      return terminals.openVirtual({ title: spec.title, start: (write) => followSession(runDir, id, write) });
    }
    return openProgram(spec, cols, rows);
  }

  return {
    commandSpec,
    openProgram,
    openTerminal,
    terminals,
    waiting,
  };
};
