// Electron main process of the Playwright E2E suite (#222): features/support/app.js launches
// `electron features/support/electron-main.js` with Playwright's _electron, on a scratch workspace
// it has already seeded. This file only sets what has to happen inside Electron, then loads the
// real app (apps/desktop/host/main.js):
// - the theme Electron reports (CRAFTORIO_E2E_THEME: light | dark), for the visual baselines;
// - a fixed window content size (CRAFTORIO_E2E_SIZE, default 1400x900);
// - the channels that would call a model (Product Owner, Oracle, supervisor chat, analysis) answer
//   with simulated data or previews, as in scripts/screenshot.js;
// - the window stays off-screen, so a run never takes the owner's screen (CRAFTORIO_E2E_SHOW=1
//   shows it, e.g. to watch a scenario); Chromium keeps painting it (no occlusion throttling);
// - the main process's clock starts at CRAFTORIO_E2E_NOW (ms) when set: the visual scenarios
//   render at a fixed instant (#362, features/support/fixed-clock.js);
// - the locale is en-US, so the interface is English until a scenario chooses another (#329);
// - the service's base-health area (packages/engine/service/areas/base-health.js) is kept in
//   global.craftorioE2E.baseHealth when the service loads it, so a step can start the base check a
//   real run's local merge starts (afterBaseMerge): a simulated run never reaches it (#527); with it,
//   global.craftorioE2E.runEventListeners() counts the service's listeners of run:event (#76);
// - the main process's log is recorded from before the app loads (#76): global.craftorioE2E.warnings, each
//   process warning as { name, type, message } (a listener leak is a MaxListenersExceededWarning), and
//   global.craftorioE2E.errors, the text of each console.error (still written), which is how Electron says a
//   channel's handler failed ("Error occurred in handler for '<channel>': …");
// - with CRAFTORIO_E2E_PR_FILE (a file name in the launch's scratch folder, which does not exist
//   before the launch), a run's PR is read from that JSON file on each call, at the service's
//   host.readPrJson: gh's answer, or { fail: message } for a read that fails. Sync then reaches the
//   real backlog:sync, with only its read of the platform's issues replaced by the cached ones, and
//   global.craftorioE2E.backlogSyncs counts the syncs answered (#797). A file of several pull requests
//   ({ pulls: [...] }, #812's PRs screen) answers `gh pr list` with its open ones and `gh pr view <n>` with
//   that one; a merge or close changes only the pull request it names.

const fs = require('fs');
const path = require('path');
const { format } = require('util');
const { app, ipcMain, nativeTheme } = require('electron');
const { shiftClock } = require('./fixed-clock');

// #76: the log's warnings and errors, recorded before anything of the app is loaded
const warnings = [];
const errors = [];
global.craftorioE2E = { ...(global.craftorioE2E || {}), warnings, errors };
process.on('warning', (w) => warnings.push({ name: w.name, type: w.type, message: w.message }));
const writeError = console.error.bind(console);
console.error = (...args) => {
  errors.push(format(...args));
  writeError(...args);
};

if (process.env.CRAFTORIO_E2E_NOW) shiftClock(Number(process.env.CRAFTORIO_E2E_NOW));
// the helpers only: scripts/screenshot.js runs its own capture in an Electron main process otherwise
global.craftorioScreenshotHelpers = true;
const { simulateChannels } = require('../../scripts/screenshot');

const theme = process.env.CRAFTORIO_E2E_THEME;
if (theme) nativeTheme.themeSource = theme;
const [width, height] = String(process.env.CRAFTORIO_E2E_SIZE || '1400x900').split('x').map(Number);
const show = process.env.CRAFTORIO_E2E_SHOW === '1';

// an off-screen or covered window must keep rendering: the steps and the screenshots read it
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
// #849: a machine without a usable GPU (Xvfb on Linux, WSL, a CI runner) has WebGL turned off, so the
// City and the run's 3D view would only say "WebGL is not available". A scenario tagged @webgl
// (CRAFTORIO_E2E_SOFTWARE_WEBGL=1, features/steps/fixtures.js) gets Chromium's software WebGL
// (SwiftShader), only a fallback: where the GPU works, WebGL stays on it, and nothing but WebGL changes
// (compositing and rasterization stay as they were). Not for every scenario: a city drawn in software
// keeps the renderer busy, and a scenario that watches a short simulated run (the City's "Analyzing")
// would miss it.
if (process.env.CRAFTORIO_E2E_SOFTWARE_WEBGL === '1') app.commandLine.appendSwitch('enable-unsafe-swiftshader');
// #329: the scenarios run in English whatever the computer's language (the interface follows it until chosen)
app.commandLine.appendSwitch('lang', 'en-US');

app.on('browser-window-created', (_e, win) => {
  win.setMinimumSize(400, 300);
  win.setContentSize(width, height);
  if (!show) {
    win.setPosition(-(width + 4000), 0);
    win.setSkipTaskbar(true);
  }
});

const handleIpc = ipcMain.handle.bind(ipcMain);
simulateChannels(ipcMain);

// the base-health area as the service creates it (the service requires the area files by path: the
// cached module's export is the factory it calls)
const baseHealthArea = require.resolve(path.join(__dirname, '..', '..', 'packages', 'engine', 'service', 'areas', 'base-health'));
const makeBaseHealth = require(baseHealthArea);
require.cache[baseHealthArea].exports = (ctx) => {
  const area = makeBaseHealth(ctx);
  global.craftorioE2E = { ...(global.craftorioE2E || {}), baseHealth: area, runEventListeners: () => ctx.events.listenerCount('run:event') };
  return area;
};

// #797: the PR's answers, and a sync that reads them (simulateChannels answers it with backlog:get, which
// reads no PR). The host is completed in place: it has getters to read later (locale). main.js requires
// the service by its package name, which resolves to this same file
if (process.env.CRAFTORIO_E2E_PR_FILE) {
  const engine = path.join(__dirname, '..', '..', 'packages', 'engine');
  const answers = path.resolve(path.dirname(process.env.CRAFTORIO_WORKSPACE), process.env.CRAFTORIO_E2E_PR_FILE);
  const readAnswer = () => JSON.parse(fs.readFileSync(answers, 'utf8'));
  let threadsOf = null; // #811: the PR number the review threads were last read for
  // #810: the repository's permissions (bypass only with the file's viewerCanBypass) and the signed-in account
  const readPrJson = async (_cmd, args = []) => {
    const answer = readAnswer();
    if (answer.fail) throw new Error(answer.fail);
    if (args[0] === 'api' && args.includes('user')) return { login: 'e2e-owner' };
    // #811: the review threads' query (the file's reviewThreads) and each author's access (e2ePermissions, read when absent)
    // (the PR file has no number: the reply records the one the threads were last read for, `-F n=<number>`)
    const asked = args[0] === 'api' && args[1] === 'graphql' && args.map((a) => /^n=(\d+)$/.exec(a)).find(Boolean);
    if (asked) threadsOf = Number(asked[1]);
    if (args[0] === 'api' && args[1] === 'graphql' && args.some((a) => /reviewThreads/.test(a))) return { data: { repository: { pullRequest: { reviewThreads: { nodes: answer.reviewThreads || [] } } } } };
    const access = args[0] === 'api' && args.map((a) => /^repos\/[^/]+\/[^/]+\/collaborators\/([^/]+)\/permission$/.exec(a)).find(Boolean);
    if (access) return { permission: answer.e2ePermissions?.[access[1]] || 'read' };
    if (args[0] === 'api' && args.some((a) => /^repos\/[^/]+\/[^/]+$/.test(a))) return { permissions: { push: true, admin: answer.viewerCanBypass === true } };
    // #812: a file of several pull requests ({ pulls: [...] }): `gh pr list` answers the open ones, `gh pr view <n|url>` that one
    if (Array.isArray(answer.pulls)) {
      if (args[0] === 'pr' && args[1] === 'list') return answer.pulls.filter((p) => p.state === 'OPEN');
      if (args[0] === 'pr' && args[1] === 'view') return answer.pulls.find((p) => p.number === pullNumber(args[2])) || {};
    }
    return answer;
  };
  // #812: a PR named by its number or its URL (…/pull/<n>)
  const pullNumber = (ref) => Number((/(\d+)\/?$/.exec(String(ref || '')) || [])[1]);
  // #810: a merge or close from the app, recorded in prActions; a merge rewrites the PR file to MERGED unless it
  // has `merge_fail` (then the platform refuses it with that message), a close to CLOSED
  const writeAnswer = (answer) => {
    const tmp = `${answers}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(answer));
    fs.renameSync(tmp, answers);
  };
  // #811: a reply on a review thread (run-pr.js replyToFixed: `gh api graphql … -f thread=<id>`), recorded and added
  // to the thread in the file, the thread left unresolved (resolving it is the reviewer's)
  const replyOnThread = (args) => {
    const thread = args.map((a) => /^thread=(.+)$/.exec(a)).find(Boolean)?.[1];
    const body = args.map((a) => /^body=([\s\S]*)$/.exec(a)).find(Boolean)?.[1] || '';
    const answer = readAnswer();
    global.craftorioE2E.prActions.push({ action: 'reply', number: Number(answer.number) || threadsOf, thread });
    const reviewThreads = (answer.reviewThreads || []).map((t) => (t.id !== thread ? t : {
      ...t, comments: { nodes: [...(t.comments?.nodes || []), { id: `${thread}_reply`, author: { login: 'e2e-owner' }, body, createdAt: new Date().toISOString() }] },
    }));
    writeAnswer({ ...answer, reviewThreads });
    return { exit_code: 0, output: '{}' };
  };
  const runPrCommand = async (_cmd, args = []) => {
    if (args[0] === 'api' && args[1] === 'graphql' && args.some((a) => /^thread=/.test(a))) return replyOnThread(args);
    const action = args[1];
    const number = pullNumber(args[2]);
    global.craftorioE2E.prActions.push(action === 'merge'
      ? { action, number, method: args.includes('--squash') ? 'squash' : args.includes('--rebase') ? 'rebase' : 'merge', admin: args.includes('--admin') }
      : { action, number });
    const answer = readAnswer();
    if (action === 'merge' && answer.merge_fail) return { exit_code: 1, output: answer.merge_fail };
    // #812: in a file of several pull requests, only the one named changes state
    if (Array.isArray(answer.pulls)) {
      const state = action === 'merge' ? { state: 'MERGED', mergeStateStatus: 'UNKNOWN', mergeCommit: { oid: 'e2e812merge0commit' } } : action === 'close' ? { state: 'CLOSED' } : null;
      if (state) writeAnswer({ ...answer, pulls: answer.pulls.map((p) => (p.number === number ? { ...p, ...state } : p)) });
      return { exit_code: 0, output: '' };
    }
    if (action === 'merge') writeAnswer({ ...answer, state: 'MERGED', mergeStateStatus: 'UNKNOWN', mergeCommit: { oid: 'e2e810merge0commit' } });
    else if (action === 'close') writeAnswer({ ...answer, state: 'CLOSED' });
    return { exit_code: 0, output: '' };
  };
  const serviceFile = require.resolve(path.join(engine, 'service'));
  const service = require(serviceFile);
  require.cache[serviceFile].exports = {
    ...service,
    createService: (options) => service.createService({ ...options, host: Object.assign(options.host, { readPrJson, runPrCommand }) }),
  };
  const backlog = require(path.join(engine, 'domains', 'backlog', 'backlog'));
  backlog.syncBacklog = async ({ dir, project }) => backlog.readBacklog(dir, project.id);
  global.craftorioE2E = { ...(global.craftorioE2E || {}), backlogSyncs: 0, prActions: [] };
  const simulated = ipcMain.handle;
  ipcMain.handle = (channel, fn) => {
    if (channel !== 'backlog:sync') return simulated(channel, fn);
    return handleIpc(channel, async (e, arg) => {
      try { return await fn(e, arg); } finally { global.craftorioE2E.backlogSyncs += 1; }
    });
  };
}

require(path.join(__dirname, '..', '..', 'apps', 'desktop', 'host', 'main'));
