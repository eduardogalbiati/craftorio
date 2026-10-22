// Service area: agent sessions and the CLIs' own conversations. A run's session opened live
// (its log followed) or in its provider's CLI (the same conversation resumed), and the Sessions
// screen: every CLI conversation on this machine with its project, titles given in the app, and
// what to run to reopen one or start a new one.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveCommand } = require('../../engine/providers');
const simulation = require('../../engine/simulation');
const { canonicalPath } = require('../../engine/worktree');
const projects = require('../../projects');
const runs = require('../../runs');
const cliSessions = require('../../cli-sessions');
const { trustFolder } = require('../../cli-trust');
const { tailCommand } = require('../../native-bin');
const {
  cliEnv,
  cliReason,
  folderMatcher,
  resumeArgsOf,
  sessionView,
} = require('../common');

module.exports = (ctx) => {
  const { host } = ctx;

  // Everything needed to open a session: from the run in progress, or from the run folder on disk.
  function findSession(runId, sessionId) {
    const live = ctx.liveRun(runId);
    if (live) {
      const x = live.sessions.get(sessionId);
      return x && { run: { runId: live.runId, runDir: live.runDir, file: path.basename(live.file), inputs: live.inputs, running: live.status === 'running' }, sess: sessionView(x, true) };
    }
    if (!runId) return null;
    const r = runs.readRun(ctx.ws.runs, path.basename(String(runId)));
    const x = r?.sessions.find((y) => y.id === sessionId);
    return x && { run: { runId: r.runId, runDir: r.runDir, file: r.file, inputs: r.inputs, running: false }, sess: sessionView(x, false) };
  }

  // What to run to watch (live) or resume (cli) a session: { title, file, args, cwd, env }.
  // - live: follows the session's log (src/session-tail.js);
  // - cli: the provider's interactive CLI resuming the same conversation in the session's
  //   folder (claude --resume / codex resume / grok --resume).
  // #465: a deterministic step's log (`logPath` relative to the run folder, only under its logs/) or
  // the project's base check log (`projectId`): { dir, rel, file, title }
  function logTarget({ runId, logPath, projectId }) {
    if (projectId != null && runId == null) {
      const file = ctx.baseCheckLog(path.basename(String(projectId)));
      return { dir: path.dirname(file), rel: path.basename(file), file, title: 'Base check · log' };
    }
    const runDir = ctx.runFolder(runId);
    const rel = String(logPath || '').replace(/\\/g, '/');
    const file = path.resolve(runDir, rel);
    const logs = path.join(path.resolve(runDir), 'logs');
    const inside = folderMatcher();
    // a path relative to the run folder only (an absolute one, even into logs/, is refused)
    if (!rel || path.isAbsolute(rel) || /^[a-z]:/i.test(rel) || !inside(file, logs) || inside(logs, file)) {
      throw new Error('Only a log of the run (its logs/ folder) opens in a log terminal.');
    }
    return { dir: path.resolve(runDir), rel: path.relative(runDir, file).replace(/\\/g, '/'), file, title: `${rel.replace(/^logs\//, '')} · log` };
  }

  function terminalSpec(runId, sessionId, mode) {
    // #465: a step's log (sessionId: its path in the run folder) or the base check's (sessionId: the project)
    if (mode === 'log' || mode === 'base-check') {
      const target = logTarget(mode === 'log' ? { runId, logPath: sessionId } : { projectId: sessionId });
      const tail = tailCommand(!!host.isPackaged, resolveCommand);
      return {
        title: target.title, cwd: target.dir, file: tail.command,
        args: [...tail.args, target.dir, '--file', target.rel], env: { ...process.env, ...tail.env, FORCE_COLOR: '1' },
      };
    }
    const found = findSession(runId, sessionId);
    if (!found) throw new Error('Session not found.');
    const { run, sess } = found;
    if (mode !== 'live') simulation.refuseReal(`the ${sess.provider} CLI`);
    const env = { ...process.env };
    delete env.CLAUDECODE;
    if (mode === 'live') {
      // the multiagent-tail binary (#342), else session-tail.js under node (src/native-bin.js)
      const tail = tailCommand(!!host.isPackaged, resolveCommand);
      return {
        title: sess.agent === 'orchestrator' ? 'orchestrator · live' : `${sess.agent} (${sess.id}) · live`,
        cwd: run.runDir, file: tail.command,
        args: [...tail.args, run.runDir, sess.id], env: { ...env, ...tail.env, FORCE_COLOR: '1' },
      };
    }
    const providers = ctx.runWorkflow(run.runId, run.file).providers || {};
    const why = cliReason(sess, providers, run.running);
    if (why) throw new Error(why);
    const cfg = providers[sess.provider];
    // older runs did not record the session folder, and a succeeded run's worktree is removed:
    // fall back to the run's repo/project folder
    const folder = [sess.cwd, run.inputs?.repo_path, run.inputs?.project_path].find((d) => d && fs.existsSync(d)) || run.runDir;
    delete env.ELECTRON_RUN_AS_NODE;
    return { title: `${sess.agent} (${sess.id}) · ${cfg.command}`, cwd: folder, file: resolveCommand(cfg.command).file, args: resumeArgsOf(cfg.type)(sess.providerSessionId), env };
  }

  // ---- Sessions screen: the CLIs' own conversations on this machine --------------------
  // Titles given on the Sessions screen, kept in the workspace (the CLIs' files are never edited).
  const titleKey = (provider, id) => `${provider}:${id}`;
  function sessionTitles() {
    try { return JSON.parse(fs.readFileSync(ctx.ws.sessionTitles, 'utf8')) || {}; } catch { return {}; }
  }
  function renameCliSession({ provider, id, title }) {
    const titles = sessionTitles();
    const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (clean) titles[titleKey(provider, id)] = clean;
    else delete titles[titleKey(provider, id)]; // empty: back to the CLI's own title
    fs.writeFileSync(ctx.ws.sessionTitles, JSON.stringify(titles, null, 2));
    return { title: clean || cliSessions.findCliSession(provider, id)?.title || null, renamed: !!clean };
  }

  // Every session with the project it belongs to and whether a workflow agent created it (a
  // headless CLI call, or a run's folder), plus which CLIs can start new sessions.
  function listCliSessions() {
    const within = folderMatcher();
    const projectList = projects.listProjects(ctx.ws.projects);
    const titles = sessionTitles();
    const sessions = cliSessions.listCliSessions().map((x) => {
      const owner = projectList.find((p) => [p.folder, ...(p.previousFolders || [])].some((d) => within(x.cwd, d)));
      const agent = x.headless || within(x.cwd, ctx.ws.runs) || within(x.cwd, ctx.ws.worktrees);
      const title = titles[titleKey(x.provider, x.id)];
      return { ...x, title: title || x.title, renamed: !!title, workflowAgent: !!agent, project: owner ? { id: owner.id, name: owner.name } : null };
    });
    const providers = Object.entries(cliSessions.CLI_PROVIDERS).map(([id, p]) => ({
      id, name: p.name, installed: !!resolveCommand(p.command), models: cliSessions.providerModels(id), efforts: p.efforts,
    }));
    return { sessions, providers };
  }

  // What to run for the Sessions screen: reopen a recorded session in its folder, or start a new
  // one (in a project's folder, a chosen folder, or the home folder) with a model and effort.
  function cliSessionSpec({ kind, provider, sessionId, model, effort, projectId, folder }) {
    const p = cliSessions.CLI_PROVIDERS[provider];
    if (!p) throw new Error(`Unknown provider: ${provider}`);
    simulation.refuseReal(`the ${p.command} CLI`);
    const cmd = resolveCommand(p.command);
    if (!cmd) throw new Error(`${p.name} (${p.command}) is not installed.`);
    if (kind === 'cli-resume') {
      const sess = cliSessions.findCliSession(provider, String(sessionId || ''));
      if (!sess) throw new Error('Session not found.');
      // the CLIs look conversations up by folder: resuming elsewhere would not find it
      if (!sess.cwd || !fs.existsSync(sess.cwd)) throw new Error(`The session's folder no longer exists: ${sess.cwd || 'unknown'}`);
      trustWorkspaceFolder(provider, sess.cwd);
      const title = sessionTitles()[titleKey(provider, sess.id)] || sess.title;
      return { title, cwd: sess.cwd, file: cmd.file, args: cliSessions.cliArgs(provider, { resume: sess.id }), env: cliEnv() };
    }
    const project = projectId ? projects.listProjects(ctx.ws.projects).find((x) => x.id === projectId) : null;
    if (projectId && !project) throw new Error(`Project not found: ${projectId}`);
    const cwd = folder || project?.folder || os.homedir();
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`Folder not found: ${cwd}`);
    trustWorkspaceFolder(provider, cwd);
    const title = `${project?.name || path.basename(cwd) || cwd} · ${model || p.name}`;
    return { title, cwd, file: cmd.file, args: cliSessions.cliArgs(provider, { model, effort }), env: cliEnv() };
  }

  // Folders inside the workspace are the app's own: the CLI does not ask whether to trust them.
  // Folders elsewhere keep the CLI's own question (asked once per folder).
  function trustWorkspaceFolder(provider, dir) {
    if (!folderMatcher()(dir, ctx.ws.root)) return;
    try { trustFolder(provider, canonicalPath(dir)); } catch (e) { console.warn(`folder trust (${provider}):`, e.message); }
  }

  return {
    cliSessionSpec,
    listCliSessions,
    logTarget,
    renameCliSession,
    terminalSpec,
  };
};
