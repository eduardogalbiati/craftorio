// Engine service: everything the UI can ask of the engine, with no dependency on Electron or on a
// transport. `api` maps a channel name ('projects:list', 'run:start', ...) to a function taking
// one argument; `notifications` are the fire-and-forget channels (no reply). Both come from one
// file per area in src/service/channels/ (a new channel is one edit there), and `manifest` is what
// the clients build `window.api` from (see src/service/manifest.js). Pushed data
// ('run:event', 'run:meta', 'supervisor:watch', 'term:data', 'term:exit') is emitted on `events`, and so are desktop notifications
// ('notify', see src/notifications.js), already filtered by the settings and what the UI shows.
// The service owns the workspace's SQLite index (src/store.js, #76): it writes the run index, the
// pending gates and every notification as the engine emits, and pushes 'notifications:changed'.
//
// This file only composes (#155): the state and helpers live in one file per area in
// src/service/areas/ (found by listing the folder, like the channels): workspace, index-db,
// notifications, runs, run-meta (PR and title), run-lists, resume, gates, local-preview,
// local-push, backlog, roadmap, chain (#134), sessions, terminals, artifacts, usage, workflows, settings. Each
// exports (ctx) => { helpers }; they all land on one shared `ctx` (with host, events, code), which
// the channels receive too. An area reads another's helper or state through ctx at call time
// (`ctx.ws`, `ctx.active`, `ctx.startWorkflowRun(...)`), never when it is created; a name two
// areas both define is refused. A new feature adds or edits an area file, not this one.
// Pure helpers the areas share: src/service/common.js.
//
// Today src/main.js exposes it over Electron IPC; the same object can be exposed over HTTP +
// WebSocket so the engine runs on a server and the UI connects to it.
//
// What depends on the machine the engine runs on comes from `host`:
//   trashItem(path)  moves a file to the trash (skills and workflows are never hard-deleted)
//   appVersion       shown in Settings
//   isPackaged       the packaged app can't run itself as node (see terminalSpec)
//   assertCanRun({ mock })  optional; throws when the account may not start or resume a run
//   readPrJson(cmd, args)   optional; replaces the gh/glab call that reads a run's PR (tests, UI checks)
//   userDataDir      optional; the app's user data folder, where speech models live (src/speech.js)

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const projects = require('../projects');
const { createCodeVersion } = require('../code-version');
const { BUNDLED_SKILLS_DIR, BUNDLED_WORKFLOWS_DIR } = require('./common');
const {
  authChannels,
  declarations,
  DESKTOP,
  loadChannels,
} = require('./manifest');

const AREAS_DIR = path.join(__dirname, 'areas');

// Every area file exports (ctx) => { helpers }; its properties (getters included, e.g. `ws`) are
// defined on ctx as they are. Refuses a name already on ctx (two areas would shadow each other).
function loadAreas(ctx, dir = AREAS_DIR) {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) {
    const props = Object.getOwnPropertyDescriptors(require(path.join(dir, f))(ctx));
    for (const name of Object.keys(props)) {
      if (name in ctx) throw new Error(`Service areas: ${name} is defined twice (${f}).`);
    }
    Object.defineProperties(ctx, props);
  }
  return ctx;
}

function createService({ host }) {
  const events = new EventEmitter();
  // the code this process started with, to tell a window it runs newer code (#83)
  const code = createCodeVersion({ appVersion: host.appVersion, isPackaged: host.isPackaged });
  const ctx = loadAreas({ host, events, code, BUNDLED_SKILLS_DIR });

  const entries = loadChannels(ctx);
  // Every channel needs an open workspace (checked once here instead of in each handler).
  const withWorkspace = (fn) => (arg) => { ctx.workspaceDir(); return fn(arg); };
  const api = Object.fromEntries(entries.filter((e) => e.channel).map((e) => [e.channel, withWorkspace(e.fn)]));
  const notifications = Object.fromEntries(entries.filter((e) => e.send).map((e) => [e.send, e.fn]));
  // what window.api is built from (src/preload.js, src/renderer/api-http.js), desktop and account included
  const manifest = declarations([...entries, ...DESKTOP, ...authChannels(null)]);

  return {
    api,
    notifications,
    manifest,
    events,
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
    // the runs the app had in progress when it last closed, as notifications (call at startup)
    notifyInterruptedRun: ctx.notifyInterruptedRun,
    // before a restart (the code changed on disk, #83), see src/service/areas/runs.js
    prepareRestart: ctx.prepareRestart,
    shutdown() {
      ctx.stopPrTimer();
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
