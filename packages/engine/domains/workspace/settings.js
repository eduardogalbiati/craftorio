// The app's preferences: settings.json in the workspace (ws.settings, workspace.js layout), their
// defaults (DEFAULT_SETTINGS) and how they are read and written. A low-level utility (scripts/layers.js
// ENGINE_ROOT_UTILITIES): it requires only fs and packages/shared/, so the engine may require it too
// (#862, packages/engine/engine/run-settings.js). workspace.js re-exports it for its callers.

const fs = require('fs');
const TimeZone = require('@craftorio/shared/time-zone');
const { DEFAULT_PLATFORM } = require('@craftorio/shared/platforms');

const DEFAULT_SETTINGS = {
  // shows the Simulation checkboxes (checked by default) and the simulation scenarios; off = real runs only
  developerMode: false,
  openRunOnStart: true,   // when a workflow starts, switch to the run screen
  confirmStop: true,      // ask for confirmation before stopping a workflow
  // desktop notifications (see packages/engine/domains/workspace/notifications.js): run status changes, CLI sessions waiting for you,
  // the Product Owner's answers (#149), the Oracle's actions under Night watch (#123)
  notifyOracle: true,
  notifyPO: true,
  notifyRuns: true,
  notifySessions: true,
  // days the notification center keeps notifications (packages/engine/domains/workspace/store.js); older ones are deleted
  notificationRetentionDays: 30,
  // Phone gates (#226, packages/engine/domains/workspace/mobile-gates.js): the gates-only page the app serves on localhost:port to
  // paired phones; publicUrl: the private address that reaches it from outside (Tailscale serve,
  // Cloudflare Tunnel with access rules), used in the gate links; '' = the localhost address
  phoneGates: { enabled: false, port: 7400, publicUrl: '' },
  lastProject: null,
  lastWorkflow: null,
  // where the Backlog screen syncs issues from by default: github | gitlab | bitbucket
  backlogPlatform: DEFAULT_PLATFORM,
  // the most issues the Backlog sends as one run (one branch, one PR/MR)
  backlogMaxGroup: 5,
  // the Backlog suggests a Backlog Refresh run when the last one is older than this (#161); 0 = off
  backlogRefreshHours: 24,
  // (#790: the default development workflow is each project's, packages/engine/domains/project/projects.js
  // projectDefaultWorkflow; an old `defaultWorkflow` here is moved to the projects once, service/areas/workspace.js)
  // Live roadmap (#164, packages/engine/domains/roadmap/live-roadmap.js): the highest complexity:n a refill picks, the most stages
  // per refill, the spend over 24 h (USD, runs and refills; 0 = no cap) past which refills stop, and
  // whether the backlog is synced before the Product Owner reads it
  liveRoadmap: { complexityCap: 2, maxStages: 3, dailyBudgetUsd: 50, refreshFirst: true },
  // several workflows at the same time (Settings › Execution); disabled = one run at a time.
  // perProject: null = no limit per project; simulations count toward the limits only if countSimulations.
  concurrentRuns: { enabled: false, max: 2, perProject: null, countSimulations: false },
  // Machine profile (#367, packages/engine/domains/machine/machine-profile.js): 'auto' sizes the concurrent runs' maximum and the
  // test workers per run from this machine; 'manual' keeps { concurrentRuns, testWorkers } as set
  machineProfile: { mode: 'auto' },
  // Memory guard (#276, packages/engine/engine/memory-guard.js): a real run's process over limitPercent of the RAM
  // is stopped; suites and new runs wait while less than floorPercent is free (0 = no hold)
  memoryGuard: { enabled: true, limitPercent: 25, floorPercent: 10 },
  // Platform triggers (#568, packages/engine/domains/triggers/triggers.js): the projects whose repository
  // `triggers:` the app polls ({ <projectId>: true }; off by default) and the poll interval (0 = off)
  triggers: { enabled: {}, intervalMinutes: 2 },
  // Main stays green (#405, packages/engine/domains/project/base-health.js): what a red test on the base files: 'off', 'issue'
  // (a bug issue only) or 'fix' (the issue and a fix item at the front of the roadmap). #85: off by
  // default (no check, no base worktree after a merge); a saved choice is kept as it is
  baseCheck: { onRed: 'off' },
  // Keep awake (#162, apps/desktop/host/keep-awake.js): no sleep while runs, a roadmap or a queue have work to do
  keepAwake: false,
  // Control channel (#336, #32, packages/engine/control): outside sessions drive this app through a loopback
  // endpoint; on by default, Settings › Execution unticks it (a saved false stays off)
  controlChannel: true,
  // Findings button (#361, packages/ui-kit/findings.js): shown in a packaged app (and in screenshot
  // captures) only when on; the app run from source always shows it
  findingsButton: false,
  // the top bar's 24/7 chip (#188, packages/ui-kit/occupancy-chip.js): the last 24 h occupancy
  showOccupancyChip: true,
  // the project city's Glow (#450, fronts/analyser/views/project/project-city.js): the bloom over the
  // lights and the vignette start on; off for slower machines (the header's switch still turns it on)
  cityGlow: true,
  // warn when an agent shows no output for this long while a command it started is waiting; 0 = off
  idleWarningMinutes: 5,
  // monthly limits per provider (see packages/engine/domains/usage/usage.js); null = no limit
  budgets: {},
  // the spending budget (#206, packages/engine/domains/usage/budget.js): US$ per local day and per Night watch night (null = no
  // cap) past which the roadmaps pause before their next start; `raised`: "Raise for today" (one day/night)
  budget: { dailyUsd: null, nightlyUsd: null, raised: null },
  // the Oracle (packages/engine/domains/oracle/oracle.js): its daily spend limit in USD (0 = no cap) and the context size
  // (tokens) past which its next turn starts a new session from a handoff note; what wakes it (#123,
  // packages/engine/domains/oracle/oracle-wake.js): wakeScope all | watched | off, wakeOn the event kinds; selfHealing (#278):
  // its watch stays on day and night, with no end time (packages/engine/domains/oracle/oracle-actions.js watchState); appUpdate
  // (#279, needs selfHealing): apply merged fixes to this app after a roadmap stage ends (packages/engine/domains/workspace/app-update.js);
  // parkAfterMinutes (#395): the watch moves on past a roadmap run waiting this long at a human gate (skip permission)
  oracle: { dailyBudgetUsd: 20, compactAtTokens: 150000, wakeScope: 'all', wakeOn: ['finished', 'gate', 'interrupted', 'invalid', 'limit', 'merge', 'stall'], selfHealing: false, appUpdate: false, parkAfterMinutes: 15 },
  // USD per 1M tokens, for CLIs that do not report cost: { model: { input, output, cache_read } }
  prices: {},
  // #262: per provider, the ordered fallback chain of an agent whose workflow declares none:
  // { <provider>: { fallbacks: ['<provider>:<model>', ...] } } (a turn out of credits moves on to the next)
  // #312: and its accounts in order, { accounts: [{ name, dir, enabled }] } (dir: the CLI's config folder);
  // a turn out of credits moves to the next account first, the fallback chain only after the last one
  providers: {},
  // #312: how long an account stays out after a usage limit whose message gives no reset time
  accountCooldownMinutes: 60,
  // #262: limits that follow the model an agent runs on: { <model id>: { timeout_factor?, max_total_cost_usd? } }
  // (the workflow's own `models` win per model)
  models: {},
  // GitHub Actions quota minutes included per month (GitHub Free: 2,000), see packages/engine/domains/usage/actions-usage.js
  actionsIncludedMinutes: 2000,
  // voice input (packages/engine/domains/chat/speech.js): the whisper.cpp CLI (a name in PATH or a path), the model (an id
  // from speech.MODELS or a path to a ggml .bin) and the spoken language ('auto' = detect)
  voiceCommand: 'whisper-cli',
  voiceModel: 'small',
  voiceLanguage: 'pt',
  // the first-run Setup (#319, packages/ui-kit/setup.js): done once Finish or Skip is pressed; a
  // settings.json written before Setup existed reads true (readSettings), so current users skip it
  setupDone: false,
  // workflow ids (file names without .yaml) the Setup's Workflows step left unpicked: not offered by
  // Start (Home's Run a workflow opens it), shown again by Workflows › Definitions › Show in Start
  hiddenWorkflows: [],
  // #474: the files not bundled with the app the owner confirmed are code they trust, "workflows/<file>"
  // → the fingerprint of the text confirmed (packages/engine/service/areas/workflows.js); an edit elsewhere asks again
  trustedFiles: {},
  // the owner's IANA time zone (#273, packages/engine/domains/analytics/time-zone.js): screens, day/week/month cuts, the agents'
  // replies and the daily resets use it; null = this computer's (readSettings fills it in, unsaved)
  timeZone: null,
  // the languages agents write in (#327, #328, packages/shared/language.js): `agents` for chat replies, prose
  // and documents ('interface' = Same as the interface), `issues` for issues, PR/MR descriptions and
  // commit messages; `interface` (#329, packages/shared/i18n.js), the app's own language, is unset until
  // chosen: the computer's language when it has a catalog, else English
  language: { agents: 'interface', issues: 'en' },
};

// settings.json as saved: null when there is none, {} when it is not valid JSON
function savedSettings(ws) {
  let text;
  try { text = fs.readFileSync(ws.settings, 'utf8'); } catch { return null; }
  try { const saved = JSON.parse(text); return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}; } catch { return {}; }
}

function readSettings(ws) {
  const saved = savedSettings(ws);
  if (!saved) return { ...DEFAULT_SETTINGS, hiddenWorkflows: [], timeZone: TimeZone.systemZone() };
  // a maximum of concurrent runs raised by hand before the machine profile existed (#367) stays the
  // owner's: manual, never replaced by the machine's proposal
  const legacyMax = !saved.machineProfile && Number.isFinite(saved.concurrentRuns?.max) && saved.concurrentRuns.max !== DEFAULT_SETTINGS.concurrentRuns.max;
  const machineProfile = legacyMax ? { mode: 'manual', concurrentRuns: saved.concurrentRuns.max } : saved.machineProfile || DEFAULT_SETTINGS.machineProfile;
  // an existing settings.json without setupDone: a workspace in use before Setup existed (#319)
  return { ...DEFAULT_SETTINGS, hiddenWorkflows: [], setupDone: true, ...saved, machineProfile, timeZone: saved.timeZone || TimeZone.systemZone() };
}

function writeSettings(ws, patch) {
  if (patch?.timeZone && TimeZone.zoneOf(patch.timeZone) !== patch.timeZone) throw new Error(`Unknown time zone: ${patch.timeZone} (an IANA name, e.g. America/Sao_Paulo).`);
  const saved = savedSettings(ws);
  const next = { ...readSettings(ws), ...patch };
  for (const k of Object.keys(next)) if (!(k in DEFAULT_SETTINGS)) delete next[k];
  // a maximum of concurrent runs written without the machine profile's mode is the owner's (#367)
  if (Number.isFinite(patch?.concurrentRuns?.max) && !('machineProfile' in patch)) {
    next.machineProfile = { ...next.machineProfile, mode: 'manual', concurrentRuns: patch.concurrentRuns.max };
  }
  // the computer's zone is not saved until one is chosen (#273): the workspace follows the computer
  if (!(patch && patch.timeZone) && !(saved && saved.timeZone)) next.timeZone = null;
  // setupDone is written once known (#319: the Setup saves false when it opens, true at Finish or
  // Skip); a first write without it (a seeded or scripted workspace) leaves it out, so it reads as set up
  if (!(saved && 'setupDone' in saved) && !(patch && 'setupDone' in patch)) delete next.setupDone;
  fs.writeFileSync(ws.settings, JSON.stringify(next, null, 2));
  return { setupDone: true, ...next };
}

module.exports = {
  DEFAULT_SETTINGS,
  readSettings,
  savedSettings,
  writeSettings,
};
