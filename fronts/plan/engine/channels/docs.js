// Documents (#647, fronts/plan/engine/domains/docs.js, docs/work/write-doc/spec.md): the work items'
// stage documents of a project's repository (docs/work/<item>/intent.md and spec.md with their pt-BR
// translations), the only way the Documents screen reads or writes them. Each request of the editor
// is one commit (docs:apply-request), listed by docs:changes and undone one by one (docs:undo); the
// reviewer's queue is the changes not marked reviewed in the write-doc run's folder; docs:accept is
// the SDLC gate (Accept intent, Sign off spec) that changes the front matter and commits.
// Where they are written (spec R11): with a runId, the write-doc run's worktree, on the run's branch
// (`write-doc/<item>-<doc>-<runId>`, merged into the local base at the accept, merge: local); without
// a worktree (a simulated run, a folder without git) and without a run, the project's folder. The
// list adds the items of the write-doc runs in progress (their worktree's documents, with `runId`).
// The run's own steps are written here too, from its events, whether the screen is open or not: at
// its first step the document's skeleton (a new item) and the run's base commit
// (<runDir>/docs-base.json); at the end of `draft` the writer's draft, only when the run created the
// document (an existing one is never replaced whole: the writer edits it by request).
// A run stopped or failed leaves its commits on its branch, not merged (the worktree keeps them).
// #650 (spec R16): docs:intents lists every item's intent (the Intents tab); docs:read and docs:changes
// also read an item's maintain.md (written by the Monitor and the Night watch, areas/docs-maintain.js).

const fs = require('fs');
const os = require('os');
const path = require('path');
const docs = require('../domains/docs');
const projects = require('@multiagent/engine/domains/project/projects');
const { clientError, gitOut } = require('@multiagent/engine/service/common');
const schemas = require('@multiagent/engine/service/schemas');

const { args, INT, listOf, nullable, OBJECT, PROJECT_ID, RUN_ID, shape, STRING, text } = schemas;

const WORKFLOW = 'write-doc';
const BASE_FILE = 'docs-base.json';
const ITEM = text(100);
const DOC = text(20);
const SHA = text(64);
// { lines: { start, end }, text }: the 1-based lines a request swaps in one file
const SWAP = shape({ lines: shape({ start: INT, end: INT }, ['start', 'end']), text: STRING }, ['lines', 'text']);
const RUN = nullable(RUN_ID);
const onDoc = (properties = {}, required = []) => args({ projectId: PROJECT_ID, item: ITEM, doc: DOC, runId: RUN, ...properties }, ['projectId', 'item', 'doc', ...required]);

// who accepts an intent or signs off a spec from this app
function owner() {
  try { return os.userInfo().username || 'owner'; } catch { return 'owner'; }
}

const gitName = (dir) => gitOut(dir, ['config', 'user.name']);

module.exports = (ctx) => {
  // the project's repository folder, or a client error for an unknown project
  const repo = (projectId) => {
    let folder = null;
    try { folder = projects.readProject(ctx.ws.projects, projectId).folder; } catch { folder = null; }
    if (!folder) throw clientError(`Unknown project or a project without a folder: ${projectId}`);
    return folder;
  };
  const runDir = (runId) => (ctx.runFolder ? ctx.runFolder(runId) : path.join(ctx.ws.runs, path.basename(String(runId))));
  const liveRun = (runId) => (runId && ctx.active?.get?.(runId)) || null;
  const isDocRun = (r) => r?.wf?.metadata?.name === WORKFLOW;
  // a run's worktree, else the project's folder
  const dirOf = (projectId, runId) => liveRun(runId)?.worktree?.workDir || repo(projectId);
  const runFolderOf = (r) => r.worktree?.workDir || r.inputs?.project_path || null;
  const savedBase = (runId) => {
    try { return JSON.parse(fs.readFileSync(path.join(runDir(runId), BASE_FILE), 'utf8')); } catch { return null; }
  };

  // the write-doc runs of the project in progress, with the item and the document each writes
  const docRuns = (projectId) => [...(ctx.active?.values?.() || [])]
    .filter((r) => isDocRun(r) && r.projectId === projectId && r.inputs?.item)
    .map((r) => ({ runId: r.runId, item: r.inputs.item, doc: r.inputs.document || 'intent', dir: runFolderOf(r) }));

  function listWithRuns(projectId) {
    const items = new Map(docs.listItems(repo(projectId)).map((it) => [it.item, it]));
    for (const run of docRuns(projectId)) {
      const there = run.dir ? docs.listItems(run.dir).find((it) => it.item === run.item) : null;
      const it = there || items.get(run.item) || { item: run.item, stage: run.doc, docs: [] };
      items.set(run.item, { ...it, runId: run.runId, runDoc: run.doc });
    }
    return [...items.values()].sort((a, b) => a.item.localeCompare(b.item));
  }

  // the run's first step: its branch, the skeleton of a new document and its base commit
  function prepareRun(r) {
    const dir = runFolderOf(r);
    const item = r.inputs.item;
    const doc = r.inputs.document || 'intent';
    if (r.worktree) docs.ensureBranch(dir, `write-doc/${item}-${doc}-${r.runId}`);
    let fresh = false;
    try { docs.readDoc(dir, { item, doc }); } catch {
      docs.createDoc(dir, { item, doc, title: r.inputs.title || item });
      fresh = true;
    }
    const base = gitOut(dir, ['rev-parse', 'HEAD']);
    fs.mkdirSync(runDir(r.runId), { recursive: true });
    fs.writeFileSync(path.join(runDir(r.runId), BASE_FILE), JSON.stringify({ base, fresh }, null, 2));
  }

  // the writer's draft of a document the run created, kept by the service whoever watches the run (a
  // turn paid for); an existing document stays as it is and the edit goes on from it
  function writeDraft(r, output) {
    if (!savedBase(r.runId)?.fresh) return;
    const dir = runFolderOf(r);
    docs.applyDraft(dir, { item: r.inputs.item, doc: r.inputs.document || 'intent', source: output.source_text, translation: output.translation_text || null });
  }

  function onRunEvent(ev) {
    const r = ev && liveRun(ev.run_id);
    if (!isDocRun(r) || !r.inputs?.item || !runFolderOf(r)) return;
    try {
      if (ev.type === 'step.started' && !savedBase(r.runId)) prepareRun(r);
      else if (ev.type === 'step.finished' && ev.step_id === 'draft' && typeof ev.output?.source_text === 'string') writeDraft(r, ev.output);
    } catch (e) { console.error('Documents:', e.message); }
  }
  ctx.events?.on?.('run:event', onRunEvent);

  return [
    // the project's work items with their documents' status and stage, and the runs writing them
    {
      channel: 'docs:list',
      method: 'listDocItems',
      params: ['projectId'],
      schema: { params: args({ projectId: PROJECT_ID }, ['projectId']), result: listOf(OBJECT) },
      fn: ({ projectId }) => listWithRuns(projectId),
    },
    // #650 every item's intent with its status and its link back (`from`, an incident's maintain.md): the
    // Documents' Intents tab; an intent a write-doc run writes is read from its worktree (accepted there
    // before the run merges it), with `runId`
    {
      channel: 'docs:intents',
      method: 'listDocIntents',
      params: ['projectId'],
      schema: { params: args({ projectId: PROJECT_ID }, ['projectId']), result: listOf(OBJECT) },
      fn: ({ projectId }) => {
        const rows = new Map(docs.listIntents(repo(projectId)).map((i) => [i.item, i]));
        for (const run of docRuns(projectId)) {
          const there = run.doc === 'intent' && run.dir ? docs.listIntents(run.dir).find((i) => i.item === run.item) : null;
          if (there) rows.set(run.item, { ...there, runId: run.runId });
        }
        return [...rows.values()].sort((a, b) => a.item.localeCompare(b.item));
      },
    },
    // one document and its translation, as markdown (a run's: from its worktree)
    {
      channel: 'docs:read',
      method: 'readDoc',
      params: ['projectId', 'item', 'doc', 'runId'],
      schema: { params: onDoc(), result: OBJECT },
      fn: ({ projectId, item, doc, runId }) => docs.readDoc(dirOf(projectId, runId), { item, doc }),
    },
    // a new document from the playbook's skeleton (a new item: its intent), one commit
    {
      channel: 'docs:create',
      method: 'createDoc',
      params: ['projectId', 'item', 'doc', 'title', 'runId'],
      schema: { params: onDoc({ title: nullable(STRING) }), result: OBJECT },
      fn: ({ projectId, item, doc, title, runId }) => docs.createDoc(dirOf(projectId, runId), { item, doc, title: title || item }),
    },
    // the writer's whole draft, written only when it passes the machine lint
    {
      channel: 'docs:apply-draft',
      method: 'applyDocDraft',
      params: ['projectId', 'item', 'doc', 'source', 'translation', 'runId'],
      schema: { params: onDoc({ source: STRING, translation: nullable(STRING) }, ['source']), result: OBJECT },
      fn: ({ projectId, item, doc, source, translation, runId }) => docs.applyDraft(dirOf(projectId, runId), { item, doc, source, translation }),
    },
    // one request: the lines swapped in the source and its translation, one commit
    {
      channel: 'docs:apply-request',
      method: 'applyDocRequest',
      params: ['projectId', 'item', 'doc', 'messageId', 'request', 'source', 'translation', 'runId'],
      schema: { params: onDoc({ messageId: text(200), request: nullable(STRING), source: SWAP, translation: nullable(SWAP) }, ['messageId', 'source']), result: OBJECT },
      fn: ({ projectId, item, doc, messageId, request, source, translation, runId }) => docs.applyRequest(dirOf(projectId, runId), { item, doc, messageId, request, source, translation }),
    },
    // the changes by request, newest last; `base` the commit the run started from (the run's own by default)
    {
      channel: 'docs:changes',
      method: 'listDocChanges',
      params: ['projectId', 'item', 'doc', 'base', 'runId'],
      schema: { params: args({ projectId: PROJECT_ID, item: nullable(ITEM), doc: nullable(DOC), base: nullable(SHA), runId: RUN }, ['projectId']), result: OBJECT },
      fn: ({ projectId, item, doc, base, runId }) => {
        const dir = dirOf(projectId, runId);
        const from = base || (runId ? savedBase(runId)?.base : null) || null;
        const changes = docs.listChanges(dir, { base: from, item, doc });
        const pending = runId ? docs.unreviewed(dir, runDir(runId), { base: from, item, doc }).map((c) => c.commit) : [];
        return { changes, unreviewed: pending, base: from };
      },
    },
    // undo one request: a revert commit, the later requests stay
    {
      channel: 'docs:undo',
      method: 'undoDocChange',
      params: ['projectId', 'commit', 'runId'],
      schema: { params: args({ projectId: PROJECT_ID, commit: SHA, runId: RUN }, ['projectId', 'commit']), result: OBJECT },
      fn: ({ projectId, commit, runId }) => docs.undoChange(dirOf(projectId, runId), { commit }),
    },
    // the reviewer saw this change: it leaves the run's unreviewed queue
    {
      channel: 'docs:mark-reviewed',
      method: 'markDocReviewed',
      params: ['runId', 'commit'],
      schema: { params: args({ runId: RUN_ID, commit: SHA }, ['runId', 'commit']), result: OBJECT },
      fn: ({ runId, commit }) => { docs.markReviewed(runDir(runId), commit); return { commit }; },
    },
    // #671 the source before a change by request and at it, for the Diff tab's sections
    {
      channel: 'docs:read-at',
      method: 'readDocAt',
      params: ['projectId', 'item', 'doc', 'commit', 'runId'],
      schema: { params: onDoc({ commit: SHA }, ['commit']), result: OBJECT },
      fn: ({ projectId, item, doc, commit, runId }) => docs.readAt(dirOf(projectId, runId), { item, doc, commit }),
    },
    // the SDLC gate: Accept intent / Sign off spec, the front matter of both languages, one commit
    {
      channel: 'docs:accept',
      method: 'acceptDoc',
      params: ['projectId', 'item', 'doc', 'runId'],
      schema: { params: onDoc(), result: OBJECT },
      // the approver: the repository's git identity, else the person at this machine
      fn: ({ projectId, item, doc, runId }) => {
        const dir = dirOf(projectId, runId);
        return docs.acceptDoc(dir, { item, doc, approver: gitName(dir) || owner() });
      },
    },
  ];
};
