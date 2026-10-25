// Service area: Run locally at a gate (Run App, #70 #108 #115 #119, src/domains/local/local-preview.js). One
// preview per run, in the run's worktree, in an embedded terminal; stopped when the gate is
// answered or the run ends. It never answers the gate.

const fs = require('fs');
const path = require('path');
const projects = require('../../domains/project/projects');
const localPreview = require('../../domains/local/local-preview');
const { cliEnv } = require('../common');
const { isUnder } = require('../../engine/worktree');

module.exports = (ctx) => {
  const previews = new Map(); // runId -> { id (terminal), stepId, approvalId, title, url, dir, startedAt }

  // The config a gate runs, read now (a Local preview saved while the gate waits applies at once):
  // the project's, else the repository's .multiagent/local-preview.yaml (in the run's folder), else
  // the workflow's, else the one the gate was opened with.
  // confirmed: the owner typed it (the project's) or confirmed this exact command for the project.
  function gateRunConfig(run, gate) {
    const project = run.projectId ? projects.listProjects(ctx.ws.projects).find((p) => p.id === run.projectId) : null;
    const repo = localPreview.readRepoConfig(gate.work_dir);
    const resolved = localPreview.resolveSource(project, run.wf, repo?.error ? null : repo)
      || (gate.local_preview?.command ? { config: localPreview.cleanConfig(gate.local_preview), source: 'workflow', from: 'the workflow (local_preview)' } : null);
    const fp = resolved ? localPreview.fingerprint(resolved.config) : null;
    const confirmed = resolved?.source === 'project' || (!!fp && project?.localPreviewConfirmed === fp);
    return { project, config: resolved?.config || null, source: resolved?.source || null, from: resolved?.from || null, fingerprint: fp, confirmed, repoError: repo?.error || null };
  }

  function openRunAppGate({ runId, approvalId }) {
    const run = ctx.active.get(String(runId || ''));
    if (!run) throw new Error('The run is not in progress.');
    const gate = run.pendingGates().find((g) => g.approval_id === approvalId);
    if (!gate) throw new Error('The gate is no longer open.');
    if (!(gate.run_app || gate.local_preview) || !gate.work_dir) throw new Error('This gate does not offer Run locally (Run App): no local_preview on the step.');
    return { run, gate };
  }

  // What the gate's Run App button runs, and when nothing is configured, a setup prefilled from
  // the worktree (package.json scripts, the README, a known framework).
  // confirmed: false asks the owner once (one click) before a declared or detected command runs;
  // changed: the declared command differs from the one confirmed earlier (repo file edited).
  function runAppInfo({ runId, approvalId }) {
    const { run, gate } = openRunAppGate({ runId, approvalId });
    const { project, config, source, from, fingerprint, confirmed, repoError } = gateRunConfig(run, gate);
    const stateFile = path.join(ctx.ws.localPreviews, run.runId, 'install.json');
    const suggestion = config ? null : localPreview.suggestConfig(gate.work_dir);
    return {
      config, source, from, confirmed, repoError, dir: gate.work_dir,
      changed: !!config && !confirmed && !!project?.localPreviewConfirmed,
      fingerprint,
      project: project ? { id: project.id, name: project.name } : null,
      suggestion,
      // whether the install step of the config (or of the prefilled setup) would run in this
      // worktree now (#119): { state: 'none' | 'skipped' | 'will-run', text }
      install: localPreview.installState(gate.work_dir, stateFile, config || suggestion),
      running: previews.has(run.runId) && ctx.terminals.procs.has(previews.get(run.runId).id),
    };
  }

  // The screen a Run App copy of this app opens on (#119): from the files the gate's run changed
  // (diff_base); null without a diff or when none of them is a screen's.
  async function gateStartView(runId, approvalId, gate) {
    if (!gate.diff_base) return null;
    try {
      return localPreview.startView((await ctx.gateChanges({ runId, approvalId })).map((c) => c.file));
    } catch { return null; }
  }

  // Run App's Save (#115): the gate's config becomes the project's Local preview; writeRepoFile also
  // writes it to the project folder's .multiagent/local-preview.yaml (a change the owner commits).
  function saveLocalPreview({ runId, approvalId, config, writeRepoFile = false }) {
    const { run } = openRunAppGate({ runId, approvalId });
    const cfg = localPreview.cleanConfig(config);
    if (!cfg) throw new Error('Enter the command to run.');
    if (!run.projectId) throw new Error('The run has no project to save it to.');
    const project = projects.updateProject(ctx.ws.projects, run.projectId, { localPreview: cfg });
    const file = writeRepoFile ? localPreview.writeRepoConfig(project.folder, cfg) : null;
    return { project: { id: project.id, name: project.name }, config: cfg, file };
  }

  // Projects › Add / Edit (#115): what a folder declares or is detected to run with. Only a project's
  // folder (or a subfolder) or a run's worktree is read (SEC-26): over `npm run serve` the channel
  // would otherwise list what any folder of the engine's machine holds. Projects › Add detects
  // nothing until the project is saved (its Edit form then does).
  function suggestLocalPreview({ dir }) {
    if (!dir || !fs.existsSync(String(dir))) return null;
    const roots = [...projects.listProjects(ctx.ws.projects).map((p) => p.folder).filter(Boolean), ctx.ws.worktrees].filter(Boolean);
    if (!roots.some((root) => isUnder(root, String(dir)))) return null;
    const repo = localPreview.readRepoConfig(String(dir));
    if (repo?.command) return repo;
    return localPreview.suggestConfig(String(dir));
  }

  // config: a one-off command from the gate's setup when the run has no project to save it to.
  // confirm: the owner clicked Run on the gate's confirmation (a declared or detected command that
  // was never confirmed for this project, or changed since, never runs without it).
  async function startLocalPreview({ runId, approvalId, realWorkspace = false, cols, rows, config = null, confirm = false }) {
    const { ws, terminals } = ctx;
    const { run, gate } = openRunAppGate({ runId, approvalId });
    // a terminal that went away without reporting its exit does not block the next preview
    if (previews.has(run.runId) && !terminals.procs.has(previews.get(run.runId).id)) previews.delete(run.runId);
    if (previews.has(run.runId)) throw new Error('A local preview of this run is already running: stop it first.');
    const resolved = gateRunConfig(run, gate);
    if (resolved.config && !resolved.confirmed) {
      if (!confirm) throw new Error(`Confirm the command first: ${resolved.config.command} (from ${resolved.from}).`);
      if (resolved.project) projects.updateProject(ws.projects, resolved.project.id, { localPreviewConfirmed: resolved.fingerprint });
    }
    const cfg = resolved.config || localPreview.cleanConfig(config);
    if (!cfg) throw new Error('No command to run: set the project\'s Local preview (Run App opens its setup).');
    const dir = localPreview.runFolder(gate.work_dir, cfg);
    if (!fs.existsSync(dir)) throw new Error(`The run's folder no longer exists: ${dir}`);
    const port = cfg.url ? localPreview.portOf(cfg.url) : null;
    if (port && await localPreview.portInUse(port)) throw new Error(`Port ${port} (${cfg.url}) is already in use: stop what listens on it (another local preview?) and try again.`);
    const root = path.join(ws.localPreviews, run.runId);
    const target = realWorkspace ? { workspace: ws.root, userData: null } : localPreview.scratchWorkspace(ws, root);
    const stateFile = path.join(root, 'install.json');
    // a monorepo's lockfile is at the root, not in the app's cwd
    const due = localPreview.needsInstall(gate.work_dir, stateFile);
    const line = localPreview.commandLine(cfg, due.install);
    // the terminal's first line says whether the install runs (#119)
    const shown = localPreview.announced(line, localPreview.installState(gate.work_dir, stateFile, cfg).text);
    const view = await gateStartView(runId, approvalId, gate);
    const label = run.issues?.length ? run.issues.map((i) => `#${i.number}`).join(', ') : run.runId;
    const title = `Local preview · ${label}`;
    const win = process.platform === 'win32';
    const spec = {
      title, cwd: dir, env: localPreview.previewEnv(cliEnv(), target, cfg.env, { view }),
      file: win ? 'cmd.exe' : '/bin/sh', args: win ? `/d /s /c "${shown}"` : ['-c', shown],
      onExit: (exitCode) => {
        const p = previews.get(run.runId);
        if (!p || p.id !== opened.id) return;
        // the program ended by itself (or its terminal was closed): the install succeeded when it exits 0
        previews.delete(run.runId);
        if (exitCode === 0 && due.install) localPreview.recordInstall(stateFile, due.hash);
        if (['pending', 'running'].includes(run.status)) run.emitEvent('local_preview.stopped', { step_id: p.stepId, approval_id: p.approvalId, exit_code: exitCode });
      },
    };
    const opened = ctx.openProgram(spec, cols, rows);
    // an install that was not due: the lockfile hash is known now
    if (!due.install) localPreview.recordInstall(stateFile, due.hash);
    const info = { id: opened.id, stepId: gate.step_id, approvalId, title, url: cfg.url || null, dir, startedAt: new Date().toISOString() };
    previews.set(run.runId, info);
    run.emitEvent('local_preview.started', {
      step_id: gate.step_id, approval_id: approvalId, command: line, dir, url: cfg.url || null, terminal: opened.id,
      workspace: realWorkspace ? 'real' : 'scratch', installed: !!(due.install && cfg.install),
      ...(view ? { start_view: view } : {}),
    });
    return { ...opened, url: cfg.url || null, cwd: dir };
  }

  // Recorded here rather than on the program's exit: a killed tree does not always report one.
  function stopLocalPreview({ runId, reason = 'stopped by the owner' }) {
    const id = String(runId || '');
    const p = previews.get(id);
    if (!p) return false;
    previews.delete(id);
    ctx.terminals.kill(p.id);
    // a run that ended records nothing after its workflow.finished
    const run = ctx.active.get(id);
    if (run && ['pending', 'running'].includes(run.status)) run.emitEvent('local_preview.stopped', { step_id: p.stepId, approval_id: p.approvalId, reason });
    return true;
  }

  const listLocalPreviews = () => [...previews.entries()].map(([runId, p]) => ({ runId, id: p.id, stepId: p.stepId, approvalId: p.approvalId, title: p.title, url: p.url, dir: p.dir, startedAt: p.startedAt }));

  return {
    listLocalPreviews,
    runAppInfo,
    saveLocalPreview,
    startLocalPreview,
    stopLocalPreview,
    suggestLocalPreview,
  };
};
