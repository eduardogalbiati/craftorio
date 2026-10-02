// The Oracle's actions (#123): what it may change, always as a card in its chat that runs only when
// the owner clicks "Do it" (src/oracle.js propose/act). This file only describes and checks them:
// the service performs them (src/service/channels/oracle.js, with the app's own functions).
// Each kind says what changes, where, the backup taken first, and whether Night watch may run it
// without asking (`night`). Never here: answering a human gate, pushing, closing issues, deleting
// data, starting a real run or a paid call without the click.
//
// Night watch (the owner's switch with an end time, <oracle dir>/night-watch.json): while it is on,
// the repairs that keep the roadmap producing run at once (NIGHT_WATCH_KINDS, `night` true for the
// params); everything else still waits for the click. An action requested by content the Oracle read
// (an issue body, a run output, a file: requestedBy 'content') always waits for the click.
// Every proposal, action and result is appended to <oracle dir>/actions.jsonl.

const fs = require('fs');
const path = require('path');

const REQUESTERS = ['content', 'oracle', 'owner'];
const ROADMAP_ITEM_ACTIONS = ['retry', 'skip'];

const s = (v) => String(v ?? '').trim();
const need = (params, names) => {
  const missing = names.filter((n) => !s(params[n]));
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}.`);
};
const roadmapBackup = 'A copy of the roadmap file, taken before the change (Undo puts it back).';

const ACTIONS = {
  'dispatch.restart': {
    label: 'Restart the dispatch',
    night: () => true,
    check: () => {},
    describe: () => ({ title: 'Restart the roadmap and queue dispatch', change: 'Starts the next planned items of the running roadmaps and queues, if any can start.', where: 'Every project\'s roadmap and queue', backup: 'Nothing changes on disk.' }),
  },
  'issue.file': {
    label: 'File an issue',
    night: () => false,
    check: (p) => need(p, ['projectId', 'title', 'body']),
    describe: (p) => ({ title: `File an issue: ${s(p.title)}`, change: `Creates a new issue "${s(p.title)}"${Array.isArray(p.labels) && p.labels.length ? ` with labels ${p.labels.join(', ')}` : ''}.`, where: `The issue tracker of project ${s(p.projectId)} (gh / glab)`, backup: 'Nothing is replaced: a new issue.' }),
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
    describe: (p) => ({ title: `${p.action === 'skip' ? 'Skip' : 'Retry'} roadmap item ${s(p.itemId)}`, change: p.action === 'skip' ? 'The item counts as finished; the roadmap goes on.' : 'The item runs again (a new run).', where: `The roadmap of project ${s(p.projectId)}`, backup: roadmapBackup }),
  },
  'roadmap.stages': {
    label: 'Edit the roadmap',
    night: () => true,
    check: (p) => {
      need(p, ['projectId']);
      if (!Array.isArray(p.stages)) throw new Error('stages is the whole list of stages (the roadmap tool\'s shape).');
    },
    describe: (p) => ({ title: 'Edit the roadmap (regroup, reorder, point items at runs)', change: `The roadmap becomes ${p.stages.length} stage(s): ${p.stages.map((x) => `${s(x.name) || '?'} (${(x.items || []).length} items)`).join(', ')}. Validated before it is written.`, where: `The roadmap of project ${s(p.projectId)}`, backup: roadmapBackup }),
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
    night: () => false,
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
const NIGHT_WATCH_KINDS = ['dispatch.restart', 'issue.update', 'roadmap.item', 'roadmap.stages', 'skill.restore', 'workflow.restore'];

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

const nightFile = (dir) => path.join(dir, 'night-watch.json');

/** The Night watch: { on, until, startedAt, active } (active = on and before its end time). */
function nightWatch(dir, now = Date.now()) {
  let j = {};
  try { j = JSON.parse(fs.readFileSync(nightFile(dir), 'utf8')); } catch { /* off */ }
  const until = j.until || null;
  const on = !!j.on;
  return { on, until, startedAt: j.startedAt || null, active: on && (!until || Date.parse(until) > now) };
}

/** Turns the Night watch on (with an end time, ISO) or off. → the new state. */
function setNightWatch(dir, { on, until } = {}, now = Date.now()) {
  if (on) {
    const t = until ? Date.parse(until) : NaN;
    if (until && !(t > now)) throw new Error('The end time of the Night watch must be in the future.');
    if (until && t - now > 24 * 3600e3) throw new Error('The Night watch lasts at most 24 hours.');
  }
  const prev = nightWatch(dir, now);
  const next = on ? { on: true, until: until ? new Date(Date.parse(until)).toISOString() : null, startedAt: prev.active ? prev.startedAt : new Date(now).toISOString() } : { on: false, until: null, startedAt: prev.startedAt };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nightFile(dir), JSON.stringify(next, null, 2));
  return nightWatch(dir, now);
}

/** Whether Night watch runs this card without the owner's click. */
function actsAlone(card, watch) {
  return !!watch?.active && card.requestedBy !== 'content' && NIGHT_WATCH_KINDS.includes(card.kind) && ACTIONS[card.kind].night(card.params);
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
  NIGHT_WATCH_KINDS,
  nightWatch,
  REQUESTERS,
  setNightWatch,
};
