// The Oracle's actions (#123): what it may change, always as a card in its chat that runs only when
// the owner clicks "Do it" (packages/engine/domains/oracle/oracle.js propose/act). This file only describes and checks them:
// the service performs them (packages/engine/service/channels/oracle.js, with the app's own functions).
// Each kind says what changes, where, the backup taken first, and whether Night watch may run it
// without asking (`night`). Never here: answering a human gate, pushing, closing issues, deleting
// data, starting a real run or a paid call without the click.
//
// Night watch (the owner's switch with an end time, <oracle dir>/night-watch.json): while it is on,
// an action runs at once only when the owner allowed its permission on the Night watch screen
// (#172, packages/engine/domains/night/night-watch.js permissionOf / readPermissions; NIGHT_WATCH_KINDS, `night` true for the
// params) and the item had fewer than LOOP_CAP watch actions that night (nightDecision); everything
// else still waits for the click. An action requested by content the Oracle read (an issue body, a
// run output, a file: requestedBy 'content') always waits for the click.
// Every proposal, action and result is appended to <oracle dir>/actions.jsonl.
// Self-healing (#278, settings.oracle.selfHealing): the same watch, standing: active day and night
// with no end time (watchState), under the same permissions and LOOP_CAP (counted per UTC day:
// watchSince). <oracle dir>/self-healing.json { since } records when it was turned on (markSelfHealing).
// #241: each area has one owner. The kinds an owner holds (OWNED: the Backlog's for the Product Owner,
// the runs', workflows' and skills' for the Supervisor) keep their checks and descriptions here (the
// owners' inboxes run them through the service), but the Oracle never performs them: ownerOf() routes
// them to the owner's inbox (request_agent). Its own cards are ORACLE_KINDS: check.run, process.stop.

const fs = require('fs');
const path = require('path');
const { DEFAULT_PERMISSIONS, LOOP_CAP, permissionOf } = require('../night/night-watch');

const REQUESTERS = ['content', 'oracle', 'owner'];
const ROADMAP_ITEM_ACTIONS = ['retry', 'skip'];

const s = (v) => String(v ?? '').trim();
const need = (params, names) => {
  const missing = names.filter((n) => !s(params[n]));
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}.`);
};
const roadmapBackup = 'A copy of the roadmap file, taken before the change (Undo puts it back).';

const ACTIONS = {
  // #184: a check that costs money or takes long (packages/engine/domains/oracle/oracle-check.js); a quick one is the checker delegate
  'check.run': {
    label: 'Run a check',
    night: () => false,
    check: (p) => need(p, ['projectId', 'branch', 'command']),
    describe: (p) => ({ title: `Run \`${s(p.command)}\` on ${s(p.branch)}`, change: `Runs \`${s(p.command)}\` on a scratch checkout of branch ${s(p.branch)} with MULTIAGENT_SIMULATION_ONLY=1 (up to 20 min) and posts the result with its evidence.`, where: `A scratch checkout of project ${s(p.projectId)}, removed afterwards (the project's own checkout is untouched)`, backup: 'Nothing changes: the checkout is removed after the check.' }),
  },
  'dispatch.restart': {
    label: 'Restart the dispatch',
    night: () => true,
    check: () => {},
    describe: () => ({ title: 'Restart the roadmap and queue dispatch', change: 'Starts the next planned items of the running roadmaps and queues, if any can start.', where: 'Every project\'s roadmap and queue', backup: 'Nothing changes on disk.' }),
  },
  'issue.file': {
    label: 'File an issue',
    night: () => true,
    check: (p) => need(p, ['projectId', 'title', 'body']),
    // #184: the card says whether a duplicate was searched (issues_search) and what was found
    describe: (p) => ({ title: `File an issue: ${s(p.title)}`, change: `Creates a new issue "${s(p.title)}"${Array.isArray(p.labels) && p.labels.length ? ` with labels ${p.labels.join(', ')}` : ''}. ${s(p.duplicateSearch) ? `Duplicate search: ${s(p.duplicateSearch)}` : 'No duplicate search was recorded: check the backlog for one first.'}`, where: `The issue tracker of project ${s(p.projectId)} (gh / glab)`, backup: 'Nothing is replaced: a new issue.' }),
  },
  'issue.update': {
    label: 'Update an issue',
    // refreshing the text keeps the roadmap going; a comment waits for the owner
    night: (p) => p.mode !== 'comment',
    check: (p) => {
      need(p, ['projectId', 'number', 'body']);
      if (p.mode && !['replace', 'comment'].includes(p.mode)) throw new Error('mode is replace or comment.');
    },
    describe: (p) => ({
      title: `${p.mode === 'comment' ? 'Comment on' : 'Update the text of'} issue #${s(p.number)}`,
      change: p.mode === 'comment' ? 'Adds a comment.' : 'Replaces the issue\'s description with the new text.',
      where: `Issue #${s(p.number)} of project ${s(p.projectId)} (gh / glab)`,
      backup: p.mode === 'comment' ? 'Nothing is replaced.' : 'The current description, saved before the change (Undo writes it back).',
    }),
  },
  'process.stop': {
    label: 'Stop a stray process',
    night: () => false,
    check: (p) => need(p, ['folder']),
    describe: (p) => ({ title: 'Stop the processes that hold a folder', change: 'Stops the processes started inside the folder (not this app).', where: s(p.folder), backup: 'Nothing on disk; the processes end.' }),
  },
  'roadmap.item': {
    label: 'Retry or skip a roadmap item',
    night: () => true,
    check: (p) => {
      need(p, ['projectId', 'itemId', 'action']);
      if (!ROADMAP_ITEM_ACTIONS.includes(p.action)) throw new Error('action is retry or skip.');
    },
    // fresh: a retry from scratch over the kept work of an earlier run (#170)
    describe: (p) => ({
      title: `${p.action === 'skip' ? 'Skip' : p.fresh ? 'Retry from scratch' : 'Retry'} roadmap item ${s(p.itemId)}`,
      change: p.action === 'skip' ? 'The item counts as finished; the roadmap goes on.' : p.fresh ? 'The item runs again from scratch (a new run); the kept work of its earlier run stays in its branch.' : 'The item runs again (a new run).',
      where: `The roadmap of project ${s(p.projectId)}`, backup: roadmapBackup,
    }),
  },
  'roadmap.stages': {
    label: 'Edit the roadmap',
    night: () => true,
    check: (p) => {
      need(p, ['projectId']);
      if (!Array.isArray(p.stages)) throw new Error('stages is the whole list of stages (the roadmap tool\'s shape).');
    },
    // append: only adds items after the planned ones (#164), checked against the roadmap when performed
    describe: (p) => ({ title: p.append ? 'Append items to the roadmap' : 'Edit the roadmap (regroup, reorder, point items at runs)', change: `${p.append ? 'Only new items are added; nothing planned moves. ' : ''}The roadmap becomes ${p.stages.length} stage(s): ${p.stages.map((x) => `${s(x.name) || '?'} (${(x.items || []).length} items)`).join(', ')}. Validated before it is written.`, where: `The roadmap of project ${s(p.projectId)}`, backup: roadmapBackup }),
  },
  'run.resume': {
    label: 'Resume a run from a step',
    night: () => false,
    check: (p) => need(p, ['runId', 'step']),
    describe: (p) => ({ title: `Resume run ${s(p.runId)} from ${s(p.step)}`, change: `A new run continues from "${s(p.step)}" with the previous outputs${s(p.instruction) ? ` and the instruction: ${s(p.instruction)}` : ''}. It never goes past a decided human gate. A real run costs money.`, where: `Run ${s(p.runId)}`, backup: 'The old run is kept as it is.' }),
  },
  'run.retry': {
    label: 'Retry a run',
    night: () => false,
    check: (p) => need(p, ['runId']),
    describe: (p) => ({ title: `Retry run ${s(p.runId)}`, change: 'A new run continues from the step that failed (or where the run stopped), with the previous outputs. A real run costs money.', where: `Run ${s(p.runId)}`, backup: 'The old run is kept as it is.' }),
  },
  'run.stop': {
    label: 'Stop a run',
    night: () => false,
    check: (p) => need(p, ['runId']),
    describe: (p) => ({ title: `Stop run ${s(p.runId)}`, change: 'The run stops; it can be resumed from a step later.', where: `Run ${s(p.runId)}`, backup: 'The run folder and its worktree are kept.' }),
  },
  'skill.restore': {
    label: 'Restore a skill to its default',
    night: () => true,
    check: (p) => need(p, ['id']),
    describe: (p) => ({ title: `Restore skill ${s(p.id)} to its default`, change: 'The edited copy is replaced by the bundled default.', where: `skills/${s(p.id)} in the workspace`, backup: 'The edited copy goes to the trash first, and a copy is kept for Undo.' }),
  },
  'workflow.commit': {
    label: 'Commit a workflow or skill change',
    night: () => true,
    check: (p) => {
      need(p, ['projectId', 'message']);
      if (!Array.isArray(p.files) || !p.files.length || p.files.some((f) => !s(f?.path) || typeof f.content !== 'string')) throw new Error('files is a list of { path, content }.');
      const bad = p.files.find((f) => !/^(workflows|skills)\//.test(s(f.path).replace(/\\/g, '/')) || s(f.path).includes('..'));
      if (bad) throw new Error(`${bad.path}: only files under workflows/ or skills/ can be committed.`);
    },
    describe: (p) => ({ title: `Commit to the local main: ${s(p.message)}`, change: `Writes ${p.files.map((f) => f.path).join(', ')} and commits them on the local main (never pushed).`, where: `The repository of project ${s(p.projectId)}`, backup: 'The previous version stays in git history (git revert undoes it).' }),
  },
  'workflow.restore': {
    label: 'Restore a workflow to its default',
    night: () => true,
    check: (p) => need(p, ['file']),
    describe: (p) => ({ title: `Restore workflow ${s(p.file)} to its default`, change: 'The edited copy is replaced by the bundled default.', where: `workflows/${s(p.file)} in the workspace`, backup: 'The edited copy goes to the trash first, and a copy is kept for Undo.' }),
  },
};
const ACTION_KINDS = Object.keys(ACTIONS).sort();
// #241: the kinds an owner holds (the Product Owner: the Backlog; the Supervisor: workflows, skills and
// runs) → { to, kind(params) }: the Oracle routes them to that owner's inbox (request_agent), it never
// performs them. kind() is the owner's request kind, null when no owner takes that variant.
const OWNED = {
  'dispatch.restart': { to: 'supervisor' },
  'issue.file': { to: 'po' },
  'issue.update': { to: 'po' },
  'roadmap.item': { to: 'po', kind: (p) => (p.action === 'skip' ? 'roadmap.skip' : null) },
  'roadmap.stages': { to: 'po', kind: () => 'roadmap.regroup' },
  'run.resume': { to: 'supervisor' },
  'run.retry': { to: 'supervisor' },
  'run.stop': { to: 'supervisor' },
  'skill.restore': { to: 'supervisor' },
  'workflow.commit': { to: 'supervisor' },
  'workflow.restore': { to: 'supervisor' },
};
// what the Oracle still proposes as its own cards: a check, and stopping a stray process (no owner)
const ORACLE_KINDS = ACTION_KINDS.filter((k) => !OWNED[k]);
const NIGHT_WATCH_KINDS = [
  'dispatch.restart',
  'issue.file',
  'issue.update',
  'roadmap.item',
  'roadmap.stages',
  'skill.restore',
  'workflow.commit',
  'workflow.restore',
];

/**
 * A proposed action as a card: { kind, params, why, requestedBy, source, title, change, where,
 * backup }. Throws for an unknown kind or missing parameters. `requestedBy`: 'owner' (the owner asked
 * for it), 'oracle' (its own judgment) or 'content' (text the Oracle read asks for it: shown as such).
 */
function actionCard({ kind, params, why, requestedBy, source } = {}) {
  const def = ACTIONS[kind];
  if (!def) throw new Error(`Unknown action: ${kind}. The actions are ${ACTION_KINDS.join(', ')}.`);
  const p = params && typeof params === 'object' ? params : {};
  def.check(p);
  return {
    kind, params: p, why: s(why), requestedBy: REQUESTERS.includes(requestedBy) ? requestedBy : 'oracle', source: s(source) || null,
    ...def.describe(p), label: def.label,
  };
}

/**
 * The owner of an action kind (#241): { to ('po' | 'supervisor'), kind (the owner's request kind, or
 * null when no owner takes that variant), params } or null for the Oracle's own kinds (ORACLE_KINDS).
 */
function ownerOf(kind, params) {
  const owned = OWNED[kind];
  if (!owned) return null;
  const p = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
  const to = owned.kind ? owned.kind(p) : kind;
  const { action: _action, ...rest } = p;
  return { to: owned.to, kind: to, params: kind === 'roadmap.item' ? rest : p };
}

const nightFile = (dir) => path.join(dir, 'night-watch.json');

/** The Night watch: { on, until, startedAt, by, active } (active = on and before its end time; never without one; by: who turned it on). */
function nightWatch(dir, now = Date.now()) {
  let j = {};
  try { j = JSON.parse(fs.readFileSync(nightFile(dir), 'utf8')); } catch { /* off */ }
  const until = j.until || null;
  const on = !!j.on;
  return { on, until, startedAt: j.startedAt || null, by: j.by || null, active: on && !!until && Date.parse(until) > now };
}

/** Turns the Night watch on (with a required end time, ISO, within 24 hours) or off; `by`: who turned it on. → the new state. */
function setNightWatch(dir, { on, until, by } = {}, now = Date.now()) {
  if (on) {
    const t = until ? Date.parse(until) : NaN;
    if (!until || Number.isNaN(t)) throw new Error('The Night watch needs an end time.');
    if (!(t > now)) throw new Error('The end time of the Night watch must be in the future.');
    if (t - now > 24 * 3600e3) throw new Error('The Night watch lasts at most 24 hours.');
  }
  const prev = nightWatch(dir, now);
  const next = on
    ? { on: true, until: new Date(Date.parse(until)).toISOString(), startedAt: prev.active ? prev.startedAt : new Date(now).toISOString(), by: prev.active ? prev.by : s(by) || 'the owner' }
    : { on: false, until: null, startedAt: prev.startedAt, by: prev.by };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nightFile(dir), JSON.stringify(next, null, 2));
  return nightWatch(dir, now);
}

const selfHealingFile = (dir) => path.join(dir, 'self-healing.json');

/**
 * The watch in force (#278): { on, until, startedAt, by, active, selfHealing }. With
 * settings.oracle.selfHealing on it is the standing watch: active with no end time (until null),
 * whatever night-watch.json says; otherwise the Night watch (nightWatch), with selfHealing false.
 */
function watchState(dir, settings, now = Date.now()) {
  if (settings?.oracle?.selfHealing !== true) return { ...nightWatch(dir, now), selfHealing: false };
  let since = null;
  try { since = JSON.parse(fs.readFileSync(selfHealingFile(dir), 'utf8')).since || null; } catch { /* not recorded yet */ }
  return { on: true, until: null, startedAt: since, by: 'Self-healing', active: true, selfHealing: true };
}

/**
 * Records the standing watch turned on (writes self-healing.json { since }) or off (removes it).
 * → { changed (false when it already was in that state: nothing to log), since }.
 */
function markSelfHealing(dir, on, now = Date.now()) {
  let since = null;
  try { since = JSON.parse(fs.readFileSync(selfHealingFile(dir), 'utf8')).since || null; } catch { /* off */ }
  if (!!on === !!since) return { changed: false, since };
  if (!on) {
    fs.rmSync(selfHealingFile(dir), { force: true });
    return { changed: true, since };
  }
  fs.mkdirSync(dir, { recursive: true });
  const started = new Date(now).toISOString();
  fs.writeFileSync(selfHealingFile(dir), JSON.stringify({ since: started }, null, 2));
  return { changed: true, since: started };
}

/** Since when a watch's actions on an item count for LOOP_CAP (ISO): the night's start; under Self-healing, the start of the UTC day (or of the watch, if later). */
function watchSince(watch, now = Date.now()) {
  if (!watch?.selfHealing) return watch?.startedAt || null;
  const day = `${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`;
  return watch.startedAt && watch.startedAt > day ? watch.startedAt : day;
}

/**
 * Whether Night watch runs this card without the owner's click (#172): { alone, reason, permission }.
 * Under an active watch, reason says why not: 'content' (content asked for it), 'permission' (the
 * owner did not allow it, or it never runs alone), 'loop' (the item already had LOOP_CAP watch
 * actions this night). `allowed`: the owner's permissions; `actionsOnTarget`: watch actions on the item so far.
 */
function nightDecision(card, watch, { allowed = DEFAULT_PERMISSIONS, actionsOnTarget = 0 } = {}) {
  const permission = permissionOf(card.kind, card.params);
  if (!watch?.active) return { alone: false, reason: null, permission };
  if (card.requestedBy === 'content') return { alone: false, reason: 'content', permission };
  if (!permission || !NIGHT_WATCH_KINDS.includes(card.kind) || !ACTIONS[card.kind].night(card.params) || !allowed.includes(permission)) return { alone: false, reason: 'permission', permission };
  if (actionsOnTarget >= LOOP_CAP) return { alone: false, reason: 'loop', permission };
  return { alone: true, reason: null, permission };
}

/** Whether Night watch runs this card without the owner's click (nightDecision's `alone`). */
function actsAlone(card, watch, allowed = DEFAULT_PERMISSIONS) {
  return nightDecision(card, watch, { allowed }).alone;
}

/** Appends one entry to <dir>/actions.jsonl (the action log). */
function logAction(dir, entry) {
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'actions.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
}

module.exports = {
  ACTION_KINDS,
  actionCard,
  ACTIONS,
  actsAlone,
  logAction,
  markSelfHealing,
  NIGHT_WATCH_KINDS,
  nightDecision,
  nightWatch,
  ORACLE_KINDS,
  ownerOf,
  REQUESTERS,
  setNightWatch,
  watchSince,
  watchState,
};
