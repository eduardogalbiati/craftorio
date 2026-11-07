// @ts-check
// The run's checkout (#250, from packages/engine/engine/workflow.js): the per-run git worktree and its branch
// (`setupWorktree` / `finishWorktree`: removed or retired, the worktree summary, HEAD and branch),
// its dependencies from the shared cache (`prepareDeps`, `depsGuide`), the base worktree a suite
// compares against (`setupBaseWorktree`, `suiteBase`, `baseRefs`), the base brought into the branch
// before a suite round (`bringBaseIn`, #403), the scratch workspace (#120)
// and the processes agents leave running in it (`stopWorktreeProcesses`).
// The git operations themselves are packages/engine/engine/worktree.js.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  currentBranch,
  git,
  prepareBaseWorktree,
  prepareWorktree,
  removeRunTmp,
  removeScratch,
  removeWorktree,
  restoreWork,
  retireWorktree,
  syncWithBase,
} = require('../worktree');
const capabilities = require('../capabilities');
const checkStep = require('../check-step');
const depsCache = require('../deps-cache');
const { scratchWorkspace } = require('../../domains/local/local-preview');
const { render } = require('./templates');

// The `dependencies (<which>, <lockfile>): …` line of a deps-cache result (#198)
function depsLine(which, r) {
  const what = {
    hit: `linked from the cache (key ${r.key})`, linked: `linked from the cache (key ${r.key})`, miss: `installed once into the cache (key ${r.key})`,
    local: `installed in the worktree only: ${r.reason}`, failed: `not ready: ${r.reason}`, not_cached: `not cached: ${r.reason}`,
  }[r.status];
  // #599: a workspaces project's links to this worktree's own packages, made again
  const links = r.workspace_links != null && ['hit', 'miss'].includes(r.status) ? `; workspace links recreated (${r.workspace_links})` : '';
  return `dependencies (${which}, ${r.lockfile}): ${what}${links}${r.seconds != null ? ` in ${r.seconds.toFixed(1)} s` : ''}`;
}

// orchestrator.worktree with the run's values (`ctx`: at least { inputs }) → { repo, base, remote, fork }; also
// what says a run is local before it starts (#805, service/areas/local-push.js localRunTarget)
function worktreeTarget(cfg, ctx) {
  return {
    repo: render(cfg.repo, ctx).trim(),
    base: render(cfg.base, ctx).trim() || null,
    // remote: false = a local workflow: start from the local base and merge back into it;
    // #630: a template too (feature/fix: "{{ inputs.mode == 'remote' }}", the fetched origin/<base> in Remote mode)
    remote: cfg.remote !== false && render(String(cfg.remote ?? ''), ctx).trim().toLowerCase() !== 'false',
    // #738 Fork + PR (a template too: "{{ inputs.mode == 'fork' }}"): the fork's base is synced with upstream's first
    fork: cfg.fork === true || render(String(cfg.fork ?? ''), ctx).trim().toLowerCase() === 'true',
  };
}

const methods = {
  // ---- git worktree per run (orchestrator.worktree: { repo, base }) ------------------------
  // The run works in its own checkout, <worktreesDir>/<run_id>, detached at the freshly fetched
  // origin/<base>; `worktree_dir` in the templates points to it. A resumed run reuses the previous
  // run's folder (recreated from its branch if it was deleted), so resumed CLI sessions keep their cwd.
  // Not a git repository, or no worktreesDir (simulation): worktree_dir = the repository folder.
  async setupWorktree() {
    const cfg = this.wf.orchestrator?.worktree;
    if (!cfg) return;
    const { repo, base, remote, fork } = worktreeTarget(cfg, this.ctx);
    // #738: a dependent roadmap item (inputs.parent_branch) starts from its parent's branch on the fork;
    // #807: a stacked one (Remote mode) from its parent's branch on origin
    const parentBranch = fork || remote ? String(this.ctx.inputs?.parent_branch ?? '').trim() || undefined : undefined;
    this.ctx.worktree_dir = repo;
    const log = (level, message) => this.emitEvent('log', { level, message });
    if (!this.worktreesDir) {
      log('info', `worktree: ${this.machine.simulated ? 'simulation, ' : ''}no worktree for this run; agents work in ${repo}`);
      this.logRepoCommands(repo);
      return;
    }
    // #607: a recovered run continues in its own worktree (same id, same folder and branch)
    const prev = this.resume?.worktree || this.recovered?.worktree;
    const dir = prev?.dir || path.join(this.worktreesDir, this.runId);
    const info = await prepareWorktree({ repo, base, dir, branch: prev?.branch || null, log, remote, fork, parentBranch });
    if (!info) {
      log('info', `worktree: ${repo} is not a git repository; agents work in it directly`);
      this.logRepoCommands(repo);
      return;
    }
    this.worktree = info;
    this.ctx.worktree_dir = info.workDir;
    // #202: on the previous run's branch, whose WIP commit (saveWork) holds what that attempt left
    // uncommitted: back as uncommitted (staged) changes, whether the folder was recreated or reused
    // (its removal failed, EBUSY). The first agent prompt of the run tells it (a resume may start at a gate).
    if (prev?.branch && (await currentBranch(info.dir)) === prev.branch && await restoreWork(info.dir)) {
      info.commit = await git(['rev-parse', 'HEAD'], info.dir);
      this.restoredWorkNote = 'The worktree holds uncommitted work from the previous attempt of this run (saved as a WIP commit when it ended, restored as staged changes): check it with `git status` and `git diff --cached`, keep what is right and commit it with your own work.';
      log('info', `worktree: restored the previous attempt's uncommitted work on ${prev.branch}`);
    }
    const how = info.reused ? 'reusing' : info.recreated ? 'recreated' : 'created';
    this.emitEvent('worktree.ready', {
      dir: info.dir, work_dir: info.workDir, repo: info.repo, base: info.base, ref: info.ref, commit: info.commit, reused: info.reused, recreated: info.recreated, ...(info.fork ? { fork: true } : {}),
    });
    log('info', `worktree: ${how} ${info.dir} at ${info.ref || 'its branch'} (${String(info.commit || '').slice(0, 8)})`);
    this.logRepoCommands(info.workDir);
    await this.prepareDeps('worktree', info.workDir, 'worktree ready');
  },

  // #472 (SEC-7): one `log` event, before the install and the first step, naming the commands the
  // run executes from the repository (its dependency install, its check script, its test command),
  // so the recording shows the repository code the run is about to run
  logRepoCommands(dir) {
    if (!dir) return;
    const d = depsCache.detect(dir);
    const hasPackage = fs.existsSync(path.join(dir, 'package.json'));
    let install = null;
    if (d?.manager && !d.notCached) install = `\`${d.manager} ${depsCache.installArgs(d, this.ignoreInstallScripts).join(' ')}\``;
    else if (d?.notCached) install = `none by the run (${d.lockfile} is not cached: ${d.notCached})`;
    else if (hasPackage) install = 'none by the run (package.json without a lockfile: npm scripts run only when an agent runs them)';
    const check = checkStep.checkCommand(dir);
    const tests = this.suiteCommand();
    const parts = [
      install && `dependency install ${install}`,
      check && `check \`${check}\``,
      tests && `tests \`${tests}\``,
    ].filter(Boolean);
    if (!parts.length) return;
    this.emitEvent('log', { level: 'info', message: `repository commands: this run executes the repository's own scripts: ${parts.join('; ')}` });
  },

  // ---- dependencies from the shared cache (#198, packages/engine/engine/deps-cache.js) ---------------------
  // Installed once per lockfile content in <workspace>/cache/deps and linked into the worktree when
  // it is ready, again after each agent step (a lockfile the step changed: the new key is installed
  // once), and into the base worktree. Records `deps.ready`; agents are told in their command guide.
  // which: 'worktree' | 'base'. A simulated run has no worktree, so nothing is installed.
  async prepareDeps(which, dir, after) {
    if (this.machine.simulated || !dir) return null;
    this.deps ??= {};
    const previous = this.deps[which] || null;
    let r;
    try {
      r = await depsCache.ensureDeps({
        workDir: dir,
        cacheDir: path.join(path.dirname(path.dirname(this.runDir)), 'cache', 'deps'),
        project: this.projectId || path.basename(this.worktree?.repo || dir),
        env: capabilities.AGENT_ENV,
        signal: this.abort.signal,
        previous,
        log: (level, message) => this.emitEvent('log', { level, message }),
        ignoreScripts: !!this.ignoreInstallScripts,
      });
    } catch (e) {
      if (this.abort.signal.aborted) throw e;
      r = { status: 'failed', reason: e.message };
    }
    this.deps[which] = r.status === 'none' ? null : r;
    // nothing to say: no lockfile, or the folder already links its key
    if (r === previous || r.status === 'none' || (r.status === 'linked' && previous?.key === r.key) || (r.status === previous?.status && r.status === 'not_cached')) return r;
    const hit = r.status === 'hit' || r.status === 'linked';
    this.emitEvent('deps.ready', {
      for: which, dir, after, status: r.status, hit, lockfile: r.lockfile || null, manager: r.manager || null, key: r.key || null,
      entry: r.entry || null, seconds: r.seconds != null ? Math.round(r.seconds * 10) / 10 : null, waited: !!r.waited, reason: r.reason || null,
      ...(r.workspace_links != null ? { workspace_links: r.workspace_links } : {}),
    });
    this.emitEvent('log', { level: r.status === 'failed' || r.status === 'local' ? 'warn' : 'info', message: depsLine(which, r) });
    return r;
  },

  // The lines of an agent's command guide about dependencies: what is ready and what never to run
  depsGuide() {
    const w = this.deps?.worktree;
    const b = this.deps?.base;
    const lines = [];
    if (w?.entry && ['hit', 'linked', 'miss'].includes(w.status)) {
      lines.push(`- Dependencies are ready: \`node_modules\` links to the shared dependency cache (installed once per ${w.lockfile} content). Never run ${w.manager === 'npm' ? '`npm ci`' : `a clean ${w.manager} install`} and never delete \`node_modules\`: it would empty the cache for every run. Adding a package with the package manager (\`${w.manager} ${w.manager === 'npm' ? 'install' : 'add'} <pkg>\`) is fine: the engine installs the new lockfile into the cache after your turn. To check that the dependencies match package.json, use \`npm ls --all\`.`);
      // #599: the workspace packages are links into this worktree, not into the cache
      if (w.workspace_links != null) lines.push(`- The workspace packages in \`node_modules\` (${w.workspace_links}) link to this worktree's own folders: edit them there; the other runs never see your changes.`);
    } else if (w && w.status !== 'none') {
      lines.push(`- Dependencies are not linked from the shared cache (${w.reason || w.status}): install them yourself when they are missing.`);
    }
    if (b && this.ctx.base_worktree_dir) {
      lines.push(`- The base worktree \`${this.ctx.base_worktree_dir}\` (for a pre-existing-failure check) is ready${b.entry ? ' with its dependencies' : ''}: use it, never create another one${b.entry ? ' and never install in it' : ''}.`);
    }
    return lines.join('\n');
  },

  // `base_worktree: true` on a step: the run's checkout of the base, <worktreesDir>/<run_id>-base,
  // refreshed to the current base on each visit, with its dependencies from the same cache;
  // `base_worktree_dir` in the templates (empty without a worktree). Removed with the run's worktree.
  async setupBaseWorktree() {
    const wt = this.worktree;
    if (!wt || !this.worktreesDir) { this.ctx.base_worktree_dir = ''; return; }
    const log = (level, message) => this.emitEvent('log', { level, message });
    try {
      const info = await prepareBaseWorktree({ repo: wt.repo, base: wt.base, dir: path.join(this.worktreesDir, `${this.runId}-base`), log, remote: wt.remote !== false });
      if (!info) return;
      this.baseWorktree = info;
      this.ctx.base_worktree_dir = info.workDir;
      this.emitEvent('log', { level: 'info', message: `worktree: base checkout ${info.dir} at ${info.ref} (${String(info.commit || '').slice(0, 8)})` });
      await this.prepareDeps('base', info.workDir, 'base worktree ready');
    } catch (e) {
      if (this.abort.signal.aborted) throw e;
      this.ctx.base_worktree_dir = '';
      log('warn', `worktree: could not prepare the base checkout: ${e.message}`);
    }
  },

  // The base checkout the suite step checks its failures on (#211): the test writer's when it made
  // one, else prepared now (runs with unit_tests run_existing/off have no test writer). → { dir,
  // commit } or null (no worktree, or it could not be prepared).
  async suiteBase() {
    if (!this.baseWorktree) await this.setupBaseWorktree();
    return this.baseWorktree && this.ctx.base_worktree_dir ? { dir: this.ctx.base_worktree_dir, commit: this.baseWorktree.commit || null } : null;
  },

  // The run's scratch workspace (#120), { workspace, userData } under <run>/scratch: a copy of the
  // owner's agents, skills, workflows and settings with project entries pointing to empty folders
  // (local-preview.scratchWorkspace). Agents get it in their environment, so the app's tools they
  // run from the worktree (npm run run, npm run screenshot, the app itself) never write to the
  // owner's workspace. Only runs with a worktree; created on the first agent turn, removed with it.
  // #414: plus `tmp`, the run's temp folder (<run>/tmp, TMP/TEMP/TMPDIR in agentEnv) from the
  // machine adapter; none in a simulation.
  scratchWorkspace() {
    if (!this.worktree) return null;
    if (!this.scratch) {
      const scratch = scratchWorkspace({ root: path.dirname(path.dirname(this.runDir)) }, path.join(this.runDir, 'scratch'));
      const tmp = this.machine.runTmp?.(this.runDir);
      this.scratch = tmp ? { ...scratch, tmp } : scratch;
    }
    return this.scratch;
  },

  // Paused (#368): the folder stays as it is.
  // Success: remove the worktree and its local branch when merged, and the run's scratch workspace.
  // Otherwise (#202) the branch keeps the work (uncommitted changes as a WIP commit, a detached
  // worktree gets a branch) and the folder and the scratch go; a resume recreates the folder.
  // Any end but paused: the run's temp folder goes (#414), with or without a worktree.
  async finishWorktree(status) {
    const log = (level, message) => this.emitEvent('log', { level, message });
    if (status !== 'paused' && removeRunTmp(this.runDir)) log('info', `worktree: removed the run's temp folder ${path.join(this.runDir, 'tmp')}`);
    const wt = this.worktree;
    if (!wt) return;
    // the base checkout (base_worktree) is recreated when needed: it goes whatever the status
    if (this.baseWorktree) {
      const b = this.baseWorktree;
      await removeWorktree({ repo: b.repo, dir: b.dir, base: null, log, remote: false }).catch((e) => log('warn', `worktree: could not remove the base checkout: ${e.message}`));
      this.baseWorktree = null;
    }
    try {
      if (status === 'paused') {
        // #368: a paused run keeps its folder as it is (uncommitted work included): Resume continues in it
        Object.assign(wt, { removed: false, branch: await currentBranch(wt.dir) });
        this.emitEvent('worktree.kept', { dir: wt.dir, branch: wt.branch, paused: true });
        log('info', `worktree: kept ${wt.dir} (paused)${wt.branch ? ` on ${wt.branch}` : ''}`);
      } else if (status === 'success') {
        const r = await removeWorktree({ repo: wt.repo, dir: wt.dir, base: wt.base, log, remote: wt.remote !== false });
        Object.assign(wt, { removed: r.removed, branch: r.branch, branchDeleted: r.branchDeleted });
        this.emitEvent('worktree.removed', { dir: wt.dir, removed: r.removed, branch: r.branch, branch_deleted: r.branchDeleted });
        log('info', `worktree: removed ${wt.dir}${r.branch ? `; branch ${r.branch} ${r.branchDeleted ? 'deleted (merged)' : 'kept'}` : ''}`);
        if (r.removed && removeScratch(this.runDir)) log('info', `worktree: removed the run's scratch workspace ${path.join(this.runDir, 'scratch')}`);
      } else {
        const r = await retireWorktree({ repo: wt.repo, dir: wt.dir, runId: this.runId, log });
        Object.assign(wt, { removed: r.removed, branch: r.branch, branchDeleted: false });
        this.emitEvent('worktree.removed', { dir: wt.dir, removed: r.removed, branch: r.branch, branch_deleted: false, wip_commit: r.wipCommit });
        log('info', `worktree: ${r.removed ? 'removed' : 'could not remove (the cleanup retries)'} ${wt.dir}; branch ${r.branch} keeps the work to resume the run`);
        if (r.removed && removeScratch(this.runDir)) log('info', `worktree: removed the run's scratch workspace ${path.join(this.runDir, 'scratch')}`);
      }
    } catch (e) {
      log('warn', `worktree: cleanup failed: ${e.message}`);
      if (status !== 'success' && !wt.removed) {
        // the work could not be saved on the branch: the folder stays, as it is
        Object.assign(wt, { removed: false, branch: await currentBranch(wt.dir) });
        this.emitEvent('worktree.kept', { dir: wt.dir, branch: wt.branch });
      }
    }
  },

  // Programs an agent started from the worktree and left running (a UI check's electron.exe, a
  // dev server) hold its files: every later `npm ci` fails with EBUSY and no agent may stop them.
  // Stopped after each agent turn and at the end of the run; see packages/engine/engine/processes.js.
  async stopWorktreeProcesses(after) {
    if (this.baseWorktree?.dir) await this.stopProcessesIn(this.baseWorktree.dir, after);
    await this.stopProcessesIn(this.worktree?.dir, after);
  },

  async stopProcessesIn(dir, after) {
    if (!dir || !this.stopProcesses) return;
    let found;
    try {
      found = await this.stopProcesses(dir);
    } catch (e) {
      this.emitEvent('log', { level: 'warn', message: `worktree: could not check for processes left in ${dir}: ${e.message}` });
      return;
    }
    if (!found?.length) return;
    const processes = found.map((p) => ({ pid: p.pid, exe: p.exe || null, cwd: p.cwd || null, reason: p.reason, stopped: !!p.stopped, error: p.error }));
    this.emitEvent('worktree.processes_stopped', { dir, after, processes });
    const list = processes.map((p) => `${path.basename(p.exe || '?')} (pid ${p.pid}${p.stopped ? '' : `, not stopped: ${p.error}`})`).join(', ');
    this.emitEvent('log', { level: 'warn', kind: 'worktree_processes', message: `worktree: stopped ${processes.filter((p) => p.stopped).length} process(es) left running in ${dir} after ${after}: ${list}` });
  },

  worktreeSummary() {
    const wt = this.worktree;
    if (!wt) return this.ctx.worktree_dir ? { dir: null, work_dir: this.ctx.worktree_dir } : null;
    return {
      dir: wt.dir, work_dir: wt.workDir, repo: wt.repo, base: wt.base, ref: wt.ref, commit: wt.commit,
      branch: wt.branch || null, removed: !!wt.removed, branch_deleted: !!wt.branchDeleted,
    };
  },

  // The commit checked out in the run's worktree, or null (no worktree: a simulation, not a git repo).
  worktreeHead() {
    if (!this.worktree) return null;
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: this.worktree.workDir || this.worktree.dir, encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim() || null;
    } catch { return null; }
  },

  // The branch checked out in the run's worktree, or null (none, or a detached HEAD).
  worktreeBranch() {
    if (!this.worktree) return null;
    try {
      const b = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: this.worktree.workDir || this.worktree.dir, encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
      return b && b !== 'HEAD' ? b : null;
    } catch { return null; }
  },

  // The run's base branch, local and remote: commits reachable from it are not the agent's.
  baseRefs() {
    const base = this.worktree?.base || render(this.wf.orchestrator?.worktree?.base || '', this.ctx).trim();
    // #738: in Fork + PR the original's base (upstream) is not the agent's either
    return base ? [`refs/heads/${base}`, `refs/remotes/origin/${base}`, ...(this.worktree?.fork ? [`refs/remotes/upstream/${base}`] : [])] : [];
  },

  // #403: before a suite or E2E round of a local workflow (worktree.remote: false), the local base is
  // brought into the run's branch when it moved (worktree.js syncWithBase, real git in a simulation
  // too), so the round tests the change on top of the current base; a resumed run gets it before its
  // first round the same way. Skipped for `base_check: false` (the worktree is the base) and for a
  // remote workflow (its branch may be pushed: rebasing it would rewrite a pushed history). A log line
  // only when the base moved or did not apply; the next agent turn is told (baseSyncNote). A rebase
  // that could not be aborted (`blocked`) blocks the round (suiteRound). null: nothing checked.
  async bringBaseIn(step) {
    const wt = this.worktree;
    if (!wt?.dir || !wt.base || wt.remote !== false || step.base_check === false) return null;
    let sync;
    try {
      sync = await syncWithBase({ repo: wt.repo, dir: wt.workDir || wt.dir, base: wt.base });
    } catch (e) {
      this.emitEvent('log', { level: 'warn', kind: 'base_sync', step_id: step.id, message: `${step.id}: could not bring ${wt.base} into the branch (${e.message.split('\n')[0]}): tested as it is` });
      return null;
    }
    if (!sync) return null;
    const tip = sync.base_commit ? sync.base_commit.slice(0, 7) : '?';
    const list = sync.commits.length ? `: ${sync.commits.join('; ')}${sync.count > sync.commits.length ? ` (and ${sync.count - sync.commits.length} more)` : ''}` : '';
    if (sync.blocked) {
      this.emitEvent('log', { level: 'error', kind: 'base_sync', step_id: step.id, message: `${step.id}: ${sync.blocked}` });
    } else if (sync.moved) {
      this.emitEvent('log', { level: 'info', kind: 'base_sync', step_id: step.id, message: `${step.id}: brought ${wt.base} (${tip}) into the branch: ${sync.count} commit(s)${list}` });
      const note = `Before the ${step.id} round the orchestrator rebased the branch onto ${wt.base} (${tip}), which had moved: it got ${sync.count} commit(s)${list}. Your earlier commits now sit on top of them.`;
      this.baseSyncNote = this.baseSyncNote ? `${this.baseSyncNote}\n${note}` : note;
    } else if (sync.conflict || sync.skipped) {
      const why = sync.conflict ? `it conflicts with the branch${sync.files.length ? ` in ${sync.files.join(', ')}` : ''}` : sync.skipped;
      sync.note = `${wt.base} moved (${sync.count} commit(s)) but was not brought in: ${why}. The branch was tested as it is; ${sync.conflict ? 'the conflict is left to the final merge (resolve_merge).' : 'commit the changes to get the base in the next round.'}`;
      this.emitEvent('log', { level: 'warn', kind: 'base_sync', step_id: step.id, message: `${step.id}: ${sync.conflict ? 'base conflict: ' : ''}${sync.note}` });
    }
    return sync;
  },
};

module.exports = {
  methods,
  worktreeTarget,
};
