// #333: the channels the hostile-input sweep (test/slow/service-channel-sweep-333.slow.test.js) does
// not call, each with why: they have effects outside the process (the desktop shell, the network,
// gh/glab, a push, the machine's shared caches, the app's own checkout), or they are not answered by
// the service at all. Every other channel of the manifest is swept. To add one: an entry with the
// channel (or `<area>:*` for every channel of an area) and a reason; docs/agents/testing.md says when.
// A helper module: it registers no test.

module.exports = [
  // answered by src/main.js (the desktop shell), not by the service
  { channel: 'agents-window:agent', reason: 'desktop only (src/main.js): the Agents window' },
  { channel: 'agents-window:navigate', reason: 'desktop only (src/main.js): navigates the main window' },
  { channel: 'agents-window:open', reason: 'desktop only (src/main.js): opens a window' },
  { channel: 'app:relaunch', reason: 'desktop only (src/main.js): restarts the app' },
  { channel: 'artifacts:open', reason: 'desktop only (src/main.js): opens a file with its app' },
  { channel: 'clipboard:read', reason: 'desktop only (src/main.js): the system clipboard' },
  { channel: 'clipboard:write', reason: 'desktop only (src/main.js): the system clipboard' },
  { channel: 'clipboard:writeFile', reason: 'desktop only (src/main.js): the system clipboard' },
  { channel: 'clipboard:writeImage', reason: 'desktop only (src/main.js): the system clipboard' },
  { channel: 'control:state', reason: 'desktop only (src/main.js): the control channel endpoint (test/control-channel-336.test.js)' },
  { channel: 'dialog:pickFolder', reason: 'desktop only (src/main.js): a native dialog' },
  { channel: 'engine:openConnection', reason: 'desktop only (src/main.js): opens the engine connection window (test/engine-connection-window.test.js)' },
  { channel: 'keepAwake:state', reason: 'desktop only (src/main.js): the power save blocker' },
  { channel: 'path:open', reason: 'desktop only (src/main.js): opens the file explorer' },
  { channel: 'run:openDir', reason: 'desktop only (src/main.js): opens the file explorer' },
  { channel: 'session:terminal', reason: 'desktop only (src/main.js): opens an external terminal window' },
  { channel: 'window:capture', reason: 'desktop only (src/main.js): captures the window' },
  { channel: 'workspace:change', reason: 'desktop only (src/main.js): a native dialog, then switches the workspace' },
  { channel: 'workspace:open', reason: 'desktop only (src/main.js): opens the file explorer' },
  // answered by src/auth.js (system browser sign-in), not by the service
  { channel: 'auth:*', reason: 'the account module (src/auth.js): sign-in opens the system browser' },
  // effects outside the process
  { channel: 'app-update:back', reason: "moves the app's own checkout to another commit and relaunches it" },
  { channel: 'app-update:state', reason: "fetches the app's repository (network)" },
  { channel: 'audio:downloadModel', reason: 'downloads a speech model (network)' },
  { channel: 'backlog:archive', reason: 'closes an issue with gh/glab' },
  { channel: 'backlog:push', reason: 'git push of a project base branch' },
  { channel: 'backlog:resolve-push', reason: 'git fetch/push of a project base branch' },
  { channel: 'backlog:restore', reason: 'reopens an issue with gh/glab' },
  { channel: 'backlog:save-doc', reason: 'writes an issue with gh/glab' },
  { channel: 'backlog:sync', reason: 'reads the issues with gh/glab and fetches origin' },
  { channel: 'backlog:update-push', reason: 'git fetch/rebase/push of a project base branch' },
  { channel: 'depsCache:clear', reason: "empties the machine's shared dependency cache, used by every run" },
  { channel: 'env:details', reason: 'runs every installed CLI (--version) and gh auth status (network): ~5 s on a machine with the CLIs' },
  { channel: 'localPreview:start', reason: "starts a project's dev server process" },
  { channel: 'phonegates:check', reason: 'HTTP requests to the phone page and its public URL (network)' },
  { channel: 'phonegates:configure', reason: 'starts or restarts the phone page web server (a listening port)' },
  { channel: 'phonegates:pair', reason: 'turns the phone page web server on (a listening port)' },
  { channel: 'refactor:file', reason: 'files an issue and creates the refactor label with gh/glab' },
  { channel: 'releases:start', reason: 'creates and pushes a release tag' },
  { channel: 'runs:prState', reason: "reads a run's PR with gh/glab (network)" },
  { channel: 'usage:actions', reason: 'reads CI usage with gh api (network)' },
  { channel: 'voice:mic-access', reason: 'asks the OS for microphone access' },
];
