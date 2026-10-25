// The channel manifest: the single list of what `window.api` offers. Each area of the service
// declares its channels in its own file under packages/engine/service/channels/ (found by listing the folder,
// so a new area edits no shared list); this module merges them and adds the channels the desktop
// layer (src/host/main.js) and the account module (src/host/auth.js) answer. The clients build `window.api`
// from it at runtime: src/host/preload.js asks main (`api:manifest`, sync IPC) and
// src/renderer/api-http.js asks the server (`GET /api/manifest`). No generated file.
//
// An entry is one of:
//   { channel, method, params?, fn }  request/reply (ipcRenderer.invoke, POST /api/<channel>)
//   { send, method, params?, fn }     fire-and-forget (ipcRenderer.send, WebSocket message)
//   { event, method }                 pushed data: `method(cb)` subscribes and returns an unsubscribe
// `method` is the window.api name (none: the channel is not exposed, e.g. kept for older clients).
// `params` is the argument shape: absent = no argument; a string = the first argument as is; an
// array of names = an object built from the positional arguments, where `...name` spreads that
// argument (an object) into it. `desktop` (desktop-only entries): what the browser says it can't do.
// `schema` (#338, the service's entries): `{ params, result }` in JSON Schema, plain JSON published
// with the manifest. `params` describes the argument fn receives (for named params, the object built
// from them); the service refuses a call that breaks it before fn runs, and the tests check what fn
// answers against `result` (packages/engine/service/contract.js). Shared definitions: packages/engine/service/schemas.js.

const fs = require('fs');
const path = require('path');

const CHANNELS_DIR = path.join(__dirname, 'channels');

// Answered by src/host/main.js (native dialogs, the file explorer, the clipboard, console windows).
const DESKTOP = [
  { channel: 'path:open', method: 'openPath', params: 'path', desktop: 'Opening folders' },
  { channel: 'dialog:pickFolder', method: 'pickFolder', desktop: 'Picking a folder' },
  { channel: 'workspace:change', method: 'changeWorkspace', desktop: 'Changing the workspace' },
  { channel: 'workspace:open', method: 'openWorkspace', desktop: 'Opening the workspace folder' },
  { channel: 'run:openDir', method: 'openRunDir', params: ['runId'], desktop: 'Opening the log folder' },
  // mode: 'live' (follow the session's log) or 'cli' (resume the conversation in the provider's CLI)
  { channel: 'session:terminal', method: 'openSessionTerminal', params: ['sessionId', 'mode', 'runId'], desktop: 'External terminal windows' },
  { channel: 'artifacts:open', method: 'openArtifact', params: ['path', 'reveal'], desktop: 'Opening files with their app' },
  { channel: 'clipboard:read', method: 'clipboardRead', desktop: 'The clipboard' },
  { channel: 'clipboard:write', method: 'clipboardWrite', params: ['text'], desktop: 'The clipboard' },
  // an artifact's image or the file itself (#114); only a run's artifacts are accepted
  { channel: 'clipboard:writeImage', method: 'clipboardWriteImage', params: ['path'], desktop: 'Copying an image' },
  { channel: 'clipboard:writeFile', method: 'clipboardWriteFile', params: ['path'], desktop: 'Copying a file' },
  // restarts the app (the code changed on disk); refuses with runs in progress unless interruptRuns
  { channel: 'app:relaunch', method: 'relaunchApp', params: ['interruptRuns'], desktop: 'Restarting the app' },
  // the engine connection page (src/host/engine-connection-window.js): this computer or a remote engine;
  // the desktop app showing a remote engine opens it through api-http.js (CONNECTION_PATH)
  { channel: 'engine:openConnection', method: 'openEngineConnection', desktop: 'Choosing where the engine runs' },
  // a click on a desktop notification ({ runId, workflow } | { terminalId })
  { event: 'notify:open', method: 'onNotificationClick' },
  // Keep awake (#162, src/host/keep-awake.js): the blocker's state, re-checked; pushed when it changes
  { channel: 'keepAwake:state', method: 'keepAwakeState', desktop: 'Keeping the computer awake' },
  { event: 'keepAwake:changed', method: 'onKeepAwakeChange' },
  // Control channel (#336, packages/engine/control): { enabled, url, port, file, error, ctlPath }, re-checked; pushed when it changes
  { channel: 'control:state', method: 'controlChannelState', desktop: 'The control channel for outside sessions' },
  { event: 'control:changed', method: 'onControlChannelChange' },
  // The Agents window (#263, src/host/agents-window.js): open it on an agent ({ agent }), tell it which
  // agent it shows (remembered for the next open), and the main process asking it to switch
  { channel: 'agents-window:open', method: 'openAgentsWindow', params: 'options', desktop: 'The Agents window' },
  { send: 'agents-window:agent', method: 'setAgentsWindowAgent', params: 'options', desktop: 'The Agents window' },
  { event: 'agents-window:show', method: 'onAgentsWindowShow' },
  // a link in the window's chats (a run, an issue, a file, a request) opens its screen in the main
  // window: the window sends the target, main relays it to the main window (AgentsWindow.onNavigate)
  { send: 'agents-window:navigate', method: 'navigateMainWindow', params: 'target', desktop: 'The Agents window' },
  { event: 'main-window:navigate', method: 'onMainWindowNavigate' },
  // the Findings button (#361): the calling window's capture, a PNG data URL
  { channel: 'window:capture', method: 'captureWindow', desktop: 'Capturing the window' },
];

// Account: sign-in with an OAuth provider (system browser); it only counts users. Declared even when
// there is no account module (the server without one), so window.api always has the methods.
function authChannels(auth) {
  return [
    { channel: 'auth:state', method: 'authState', fn: () => auth.state() },
    { channel: 'auth:refresh', method: 'authRefresh', fn: () => auth.refresh() },
    { channel: 'auth:signIn', method: 'signIn', params: 'provider', fn: (provider) => auth.signIn(String(provider)) },
    { channel: 'auth:cancel', method: 'cancelSignIn', fn: () => auth.cancelSignIn() },
    { channel: 'auth:signOut', method: 'signOut', fn: () => auth.signOut() },
    { event: 'auth:changed', method: 'onAuthChange' },
  ];
}

// The service events relayed to every window: by the main process (IPC) and the engine server (WebSocket)
const PUSHED_EVENTS = [
  'backlog:changed',
  'baseCheck:changed',
  'chat:progress',
  'notifications:changed',
  'oracle:changed',
  'run:event',
  'run:meta',
  'settings:changed',
  'supervisor:watch',
  'term:data',
  'term:exit',
];

// Every area file exports (ctx) => [entries]; ctx is the service's shared state and helpers.
function loadChannels(ctx, dir = CHANNELS_DIR) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  return files.flatMap((f) => require(path.join(dir, f))(ctx));
}

// What the clients receive: the entries without their functions. Refuses a channel or a method
// declared twice (two areas adding the same name would silently shadow each other).
function declarations(entries) {
  const seen = new Set();
  return entries.map((e) => {
    for (const key of [e.channel || e.send || e.event, e.method && `method ${e.method}`].filter(Boolean)) {
      if (seen.has(key)) throw new Error(`Channel manifest: ${key} is declared twice.`);
      seen.add(key);
    }
    const { fn, ...decl } = e;
    return decl;
  });
}

module.exports = {
  authChannels,
  CHANNELS_DIR,
  declarations,
  DESKTOP,
  loadChannels,
  PUSHED_EVENTS,
};
