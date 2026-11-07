// Electron main process of the Playwright E2E suite (#222): features/support/app.js launches
// `electron features/support/electron-main.js` with Playwright's _electron, on a scratch workspace
// it has already seeded. This file only sets what has to happen inside Electron, then loads the
// real app (apps/desktop/host/main.js):
// - the theme Electron reports (MULTIAGENT_E2E_THEME: light | dark), for the visual baselines;
// - a fixed window content size (MULTIAGENT_E2E_SIZE, default 1400x900);
// - the channels that would call a model (Product Owner, Oracle, supervisor chat, analysis) answer
//   with simulated data or previews, as in scripts/screenshot.js;
// - the window stays off-screen, so a run never takes the owner's screen (MULTIAGENT_E2E_SHOW=1
//   shows it, e.g. to watch a scenario); Chromium keeps painting it (no occlusion throttling);
// - the main process's clock starts at MULTIAGENT_E2E_NOW (ms) when set: the visual scenarios
//   render at a fixed instant (#362, features/support/fixed-clock.js);
// - the locale is en-US, so the interface is English until a scenario chooses another (#329);
// - the service's base-health area (packages/engine/service/areas/base-health.js) is kept in
//   global.multiagentE2E.baseHealth when the service loads it, so a step can start the base check a
//   real run's local merge starts (afterBaseMerge): a simulated run never reaches it (#527);
// - with MULTIAGENT_E2E_PR_FILE (a file name in the launch's scratch folder, which does not exist
//   before the launch), a run's PR is read from that JSON file on each call, at the service's
//   host.readPrJson: gh's answer, or { fail: message } for a read that fails. Sync then reaches the
//   real backlog:sync, with only its read of the platform's issues replaced by the cached ones, and
//   global.multiagentE2E.backlogSyncs counts the syncs answered (#797).

const fs = require('fs');
const path = require('path');
const { app, ipcMain, nativeTheme } = require('electron');
const { shiftClock } = require('./fixed-clock');

if (process.env.MULTIAGENT_E2E_NOW) shiftClock(Number(process.env.MULTIAGENT_E2E_NOW));
// the helpers only: scripts/screenshot.js runs its own capture in an Electron main process otherwise
global.multiagentScreenshotHelpers = true;
const { simulateChannels } = require('../../scripts/screenshot');

const theme = process.env.MULTIAGENT_E2E_THEME;
if (theme) nativeTheme.themeSource = theme;
const [width, height] = String(process.env.MULTIAGENT_E2E_SIZE || '1400x900').split('x').map(Number);
const show = process.env.MULTIAGENT_E2E_SHOW === '1';

// an off-screen or covered window must keep rendering: the steps and the screenshots read it
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
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
  global.multiagentE2E = { ...(global.multiagentE2E || {}), baseHealth: area };
  return area;
};

// #797: the PR's answers, and a sync that reads them (simulateChannels answers it with backlog:get, which
// reads no PR). The host is completed in place: it has getters to read later (locale). main.js requires
// the service by its package name, which resolves to this same file
if (process.env.MULTIAGENT_E2E_PR_FILE) {
  const engine = path.join(__dirname, '..', '..', 'packages', 'engine');
  const answers = path.resolve(path.dirname(process.env.MULTIAGENT_WORKSPACE), process.env.MULTIAGENT_E2E_PR_FILE);
  const readAnswer = () => JSON.parse(fs.readFileSync(answers, 'utf8'));
  // #810: the repository's permissions (bypass only with the file's viewerCanBypass) and the signed-in account
  const readPrJson = async (_cmd, args = []) => {
    const answer = readAnswer();
    if (answer.fail) throw new Error(answer.fail);
    if (args[0] === 'api' && args.includes('user')) return { login: 'e2e-owner' };
    if (args[0] === 'api' && args.some((a) => /^repos\/[^/]+\/[^/]+$/.test(a))) return { permissions: { push: true, admin: answer.viewerCanBypass === true } };
    return answer;
  };
  // #810: a merge or close from the app, recorded in prActions; a merge rewrites the PR file to MERGED unless it
  // has `merge_fail` (then the platform refuses it with that message), a close to CLOSED
  const writeAnswer = (answer) => {
    const tmp = `${answers}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(answer));
    fs.renameSync(tmp, answers);
  };
  const runPrCommand = async (_cmd, args = []) => {
    const action = args[1];
    const number = Number(args[2]);
    global.multiagentE2E.prActions.push(action === 'merge'
      ? { action, number, method: args.includes('--squash') ? 'squash' : args.includes('--rebase') ? 'rebase' : 'merge', admin: args.includes('--admin') }
      : { action, number });
    const answer = readAnswer();
    if (action === 'merge' && answer.merge_fail) return { exit_code: 1, output: answer.merge_fail };
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
  global.multiagentE2E = { ...(global.multiagentE2E || {}), backlogSyncs: 0, prActions: [] };
  const simulated = ipcMain.handle;
  ipcMain.handle = (channel, fn) => {
    if (channel !== 'backlog:sync') return simulated(channel, fn);
    return handleIpc(channel, async (e, arg) => {
      try { return await fn(e, arg); } finally { global.multiagentE2E.backlogSyncs += 1; }
    });
  };
}

require(path.join(__dirname, '..', '..', 'apps', 'desktop', 'host', 'main'));
