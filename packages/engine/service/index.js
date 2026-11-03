// Engine service: everything the UI can ask of the engine, with no dependency on Electron or on a
// transport. `api` maps a channel name ('projects:list', 'run:start', ...) to a function taking
// one argument; `notifications` are the fire-and-forget channels (no reply). Both come from one
// file per area in packages/engine/service/channels/ (a new channel is one edit there), and `manifest` is what
// the clients build `window.api` from (see packages/engine/service/manifest.js). Pushed data
// ('chat:progress', 'run:event', 'run:meta', 'supervisor:watch', 'term:data', 'term:exit') is emitted on `events`, and so are desktop notifications
// ('notify', see packages/engine/domains/workspace/notifications.js), already filtered by the settings and what the UI shows.
// The service owns the workspace's SQLite index (packages/engine/domains/workspace/store.js, #76): it writes the run index, the
// pending gates and every notification as the engine emits, and pushes 'notifications:changed'.
//
// This file only composes (#155): the state and helpers live in one file per area in
// packages/engine/service/areas/ (found by listing the folder, like the channels): workspace, index-db,
// notifications, runs, run-meta (PR and title), run-lists, resume, gates, local-preview,
// local-push, backlog, roadmap, chain (#134), phone-gates (#226), sessions, terminals, artifacts, usage, workflows, settings. Each
// exports (ctx) => { helpers }; they all land on one shared `ctx` (with host, events, code), which
// the channels receive too. An area reads another's helper or state through ctx at call time
// (`ctx.ws`, `ctx.active`, `ctx.startWorkflowRun(...)`), never when it is created; a name two
// areas both define is refused. A new feature adds or edits an area file, not this one. A front's
// own areas and channels (fronts/<id>/engine/, phase 4 of the study, #590) load next to these when
// the composition serves the front: docs/agents/engine/fronts.md.
// Pure helpers the areas share: packages/engine/service/common.js.
//
// Today apps/desktop/host/main.js exposes it over Electron IPC; the same object can be exposed over HTTP +
// WebSocket so the engine runs on a server and the UI connects to it.
//
// What depends on the machine the engine runs on comes from `host`:
//   trashItem(path)  moves a file to the trash (skills and workflows are never hard-deleted)
//   appVersion       shown in Settings
//   isPackaged       the packaged app can't run itself as node (see terminalSpec)
//   readPrJson(cmd, args)   optional; replaces the gh/glab call that reads a run's PR (tests, UI checks)
//   fileIssue(draft) optional; files a refactor issue (#435, packages/engine/domains/refactor/refactor-issues.js issueDraft) and
//                    returns { number, url }, instead of gh/glab, in a simulation too (tests, UI checks)
//   userDataDir      optional; the app's user data folder, where speech models live (packages/engine/domains/chat/speech.js)
//   appDir           optional; the app folder Self-healing updates (#279, areas/app-update.js)
//   relaunch()       optional; restarts the app (apps/desktop/host/main.js); without it the app never updates itself
//   cliHome          optional; the folder the CLIs' config folders (.claude, .codex, .grok) are read under
//                    (#408, packages/engine/domains/cli/cli-config-dirs.js); the user's home (and CLAUDE_CONFIG_DIR/CODEX_HOME) without it
//   secrets          optional; the system keychain, { get(key), set(key, value) } (async): the Monitor's source
//                    tokens (#634, fronts/ai/engine/areas/monitor.js); without it they stay in this process's memory

const path = require('path');
const { EventEmitter } = require('events');
const pastedImages = require('../domains/chat/pasted-images');
const projects = require('../domains/project/projects');
const { createCodeVersion } = require('../domains/workspace/code-version');
const {
  BUNDLED_SKILLS_DIR,
  BUNDLED_WORKFLOWS_DIR,
  requireArgs,
} = require('./common');
const {
  checkParams,
  checkResult,
  contractHash,
} = require('./contract');
const {
  authChannels,
  declarations,
  DESKTOP,
  loadChannels,
} = require('./manifest');
const { servedFronts, serviceFiles } = require('./fronts');

const AREAS_DIR = path.join(__dirname, 'areas');

// Every area file exports (ctx) => { helpers }; its properties (getters included, e.g. `ws`) are
// defined on ctx as they are. Refuses a name already on ctx (two areas would shadow each other).
// The files come from this folder and from each served front's engine/areas/ (phase 4, #590;
// packages/engine/service/fronts.js serviceFiles: one order by file name). A kernel file uses a
// helper a front's area defines only as an optional call (`ctx.x?.()`): the front may not be served.
function loadAreas(ctx, fronts = [], dir = AREAS_DIR) {
  for (const { file, name } of serviceFiles(dir, fronts, 'areas')) {
    const props = Object.getOwnPropertyDescriptors(require(file)(ctx));
    for (const prop of Object.keys(props)) {
      if (prop in ctx) throw new Error(`Service areas: ${prop} is defined twice (${name}).`);
    }
    Object.defineProperties(ctx, props);
  }
  return ctx;
}

// `fronts` (phase 4, #590): the ids of the fronts this engine serves, from the app's composition
// (apps/desktop/composition.js, apps/web/composition.js, the bin's --fronts); absent, every installed
// front. `installed` replaces the scan of the app root (tests). Their channels and areas load next to
// the kernel's; a channel of a front not served is unknown (the server answers 404).
function createService({ host, fronts = null, installed = undefined }) {
  const events = new EventEmitter();
  // the code this process started with, to tell a window it runs newer code (#83)
  const code = createCodeVersion({ appVersion: host.appVersion, isPackaged: host.isPackaged });
  const served = servedFronts(fronts, installed);
  const ctx = loadAreas({ host, events, code, BUNDLED_SKILLS_DIR, fronts: served.map((f) => f.id) }, served);

  const entries = loadChannels(ctx, served);
  // Every channel needs an open workspace, and a channel with named params an object argument whose
  // runId, projectId and cardId are file names (#333, requireArgs in packages/engine/service/common.js): checked
  // once here instead of in each handler. #338: then the argument is checked against the entry's
  // schema.params (packages/engine/service/contract.js), so fn never sees one its schema refuses; under the test
  // runner, the result against schema.result. Each call is recorded for a finding's context (#361,
  // areas/findings.js). An async handler's channel answers every error as a rejected promise, its
  // argument's included (#371), still checked synchronously.
  const checked = (e, arg) => checkParams(e, requireArgs(arg, e.params));
  const isAsync = (fn) => fn.constructor.name === 'AsyncFunction';
  const guarded = (e) => (arg) => {
    try {
      return ctx.recordCall(e.channel, () => { ctx.workspaceDir(); return checkResult(e, e.fn(checked(e, arg))); });
    } catch (err) {
      if (isAsync(e.fn)) return Promise.reject(err);
      throw err;
    }
  };
  const api = Object.fromEntries(entries.filter((e) => e.channel).map((e) => [e.channel, guarded(e)]));
  const notifications = Object.fromEntries(entries.filter((e) => e.send).map((e) => [e.send, (arg) => e.fn(checked(e, arg))]));
  // what window.api is built from (apps/desktop/host/preload.js, apps/web/renderer/api-http.js), desktop and account included
  const manifest = declarations([...entries, ...DESKTOP, ...authChannels(null)]);
  // its contract (#339), which app:version answers
  ctx.contract = contractHash(manifest);

  return {
    api,
    notifications,
    manifest,
    events,
    // the ids of the fronts this engine serves (phase 4, #590), by id
    fronts: ctx.fronts,
    // the code version (#83): main.js calls code.markLoaded() when a window loads
    code,
    workspace: () => ctx.ws,
    setWorkspace: ctx.setWorkspace,
    isRunning: ctx.isRunning,
    // the runs, roadmaps and queued items Keep awake keeps the computer awake for (#162)
    pendingWork: ctx.pendingWork,
    // a run's folder (the run in progress without an id), for "Open log folder"
    runDir: (runId) => {
      if (!runId) return ctx.liveRun(null)?.runDir || null;
      try { return ctx.runFolder(runId); } catch { return null; }
    },
    // folders the UI may open on this machine: the workspace and the projects' folders
    openableFolders: () => [ctx.ws.root, ...projects.listProjects(ctx.ws.projects).map((x) => x.folder)],
    existingArtifact: ctx.existingArtifact,
    findArtifact: ctx.findArtifact,
    terminalSpec: ctx.terminalSpec,
    // run worktrees left behind (call at startup; the worktrees of runs in progress are never touched)
    cleanupWorktrees: ctx.cleanupRunWorktrees,
    // images pasted into prompt fields and never submitted (#130; call at startup)
    clearPastedImages: () => { if (ctx.ws?.attachments) pastedImages.clearPending(pastedImages.pendingDir(ctx.ws)); },
    // the runs the app had in progress when it last closed, as notifications (call at startup)
    notifyInterruptedRun: ctx.notifyInterruptedRun,
    // before a restart (the code changed on disk, #83), see packages/engine/service/areas/runs.js
    prepareRestart: ctx.prepareRestart,
    // the owner's answer from a paired phone (#226, packages/engine/domains/workspace/mobile-gates.js): never a channel
    answerPhoneGate: ctx.answerPhoneGate,
    // #634: an error source's push to the Monitor's webhook (the engine server's POST /hooks/monitor/<project>,
    // fronts/ai/engine/areas/monitor.js): never a channel; null when the ai front is not served
    monitorWebhook: ctx.monitorWebhookIngest ? (arg) => ctx.monitorWebhookIngest(arg) : null,
    shutdown() {
      ctx.stopPhoneGates();
      ctx.stopPrTimer();
      ctx.stopBacklogWatch();
      ctx.stopDispatchTimers();
      // #634: the Monitor's poll timer (fronts/ai/engine/areas/monitor.js; the ai front may not be served)
      ctx.stopMonitorWatch?.();
      ctx.waiting.closeAll();
      ctx.terminals.killAll();
      for (const run of ctx.active.values()) run.stop();
      // what the stopped runs write afterwards goes to the files only (the next listing indexes it)
      ctx.closeIndex();
    },
  };
}

module.exports = {
  BUNDLED_SKILLS_DIR,
  BUNDLED_WORKFLOWS_DIR,
  createService,
};
