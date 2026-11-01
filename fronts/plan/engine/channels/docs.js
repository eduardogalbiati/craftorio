// Documents (#647, fronts/plan/engine/domains/docs.js, docs/work/write-doc/spec.md): the work items'
// stage documents of a project's repository (docs/work/<item>/intent.md and spec.md with their pt-BR
// translations), the only way the Documents screen reads or writes them. Each request of the editor
// is one commit (docs:apply-request), listed by docs:changes and undone one by one (docs:undo); the
// reviewer's queue is the changes not marked reviewed in the write-doc run's folder; docs:accept is
// the SDLC gate (Accept intent, Sign off spec) that changes the front matter and commits.

const os = require('os');
const path = require('path');
const docs = require('../domains/docs');
const projects = require('@multiagent/engine/domains/project/projects');
const { clientError, gitOut } = require('@multiagent/engine/service/common');
const {
  args,
  INT,
  listOf,
  nullable,
  OBJECT,
  PROJECT_ID,
  RUN_ID,
  shape,
  STRING,
  text,
} = require('@multiagent/engine/service/schemas');

const ITEM = text(100);
const DOC = text(20);
const SHA = text(64);
// { lines: { start, end }, text }: the 1-based lines a request swaps in one file
const SWAP = shape({ lines: shape({ start: INT, end: INT }, ['start', 'end']), text: STRING }, ['lines', 'text']);
const onDoc = (properties = {}, required = []) => args({ projectId: PROJECT_ID, item: ITEM, doc: DOC, ...properties }, ['projectId', 'item', 'doc', ...required]);

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
  return [
    // the project's work items with their documents' status and stage
    {
      channel: 'docs:list',
      method: 'listDocItems',
      params: ['projectId'],
      schema: { params: args({ projectId: PROJECT_ID }, ['projectId']), result: listOf(OBJECT) },
      fn: ({ projectId }) => docs.listItems(repo(projectId)),
    },
    // one document and its translation, as markdown
    {
      channel: 'docs:read',
      method: 'readDoc',
      params: ['projectId', 'item', 'doc'],
      schema: { params: onDoc(), result: OBJECT },
      fn: ({ projectId, item, doc }) => docs.readDoc(repo(projectId), { item, doc }),
    },
    // a new document from the playbook's skeleton (a new item: its intent), one commit
    {
      channel: 'docs:create',
      method: 'createDoc',
      params: ['projectId', 'item', 'doc', 'title'],
      schema: { params: onDoc({ title: nullable(STRING) }), result: OBJECT },
      fn: ({ projectId, item, doc, title }) => docs.createDoc(repo(projectId), { item, doc, title: title || item }),
    },
    // the writer's whole draft, written only when it passes the machine lint
    {
      channel: 'docs:apply-draft',
      method: 'applyDocDraft',
      params: ['projectId', 'item', 'doc', 'source', 'translation'],
      schema: { params: onDoc({ source: STRING, translation: nullable(STRING) }, ['source']), result: OBJECT },
      fn: ({ projectId, item, doc, source, translation }) => docs.applyDraft(repo(projectId), { item, doc, source, translation }),
    },
    // one request: the lines swapped in the source and its translation, one commit
    {
      channel: 'docs:apply-request',
      method: 'applyDocRequest',
      params: ['projectId', 'item', 'doc', 'messageId', 'request', 'source', 'translation'],
      schema: { params: onDoc({ messageId: text(200), request: nullable(STRING), source: SWAP, translation: nullable(SWAP) }, ['messageId', 'source']), result: OBJECT },
      fn: ({ projectId, item, doc, messageId, request, source, translation }) => docs.applyRequest(repo(projectId), { item, doc, messageId, request, source, translation }),
    },
    // the changes by request, newest last; `base` the commit the run started from
    {
      channel: 'docs:changes',
      method: 'listDocChanges',
      params: ['projectId', 'item', 'doc', 'base', 'runId'],
      schema: { params: args({ projectId: PROJECT_ID, item: nullable(ITEM), doc: nullable(DOC), base: nullable(SHA), runId: nullable(RUN_ID) }, ['projectId']), result: OBJECT },
      fn: ({ projectId, item, doc, base, runId }) => {
        const dir = repo(projectId);
        const changes = docs.listChanges(dir, { base, item, doc });
        const pending = runId ? docs.unreviewed(dir, runDir(runId), { base }).map((c) => c.commit) : [];
        return { changes, unreviewed: pending };
      },
    },
    // undo one request: a revert commit, the later requests stay
    {
      channel: 'docs:undo',
      method: 'undoDocChange',
      params: ['projectId', 'commit'],
      schema: { params: args({ projectId: PROJECT_ID, commit: SHA }, ['projectId', 'commit']), result: OBJECT },
      fn: ({ projectId, commit }) => docs.undoChange(repo(projectId), { commit }),
    },
    // the reviewer saw this change: it leaves the run's unreviewed queue
    {
      channel: 'docs:mark-reviewed',
      method: 'markDocReviewed',
      params: ['runId', 'commit'],
      schema: { params: args({ runId: RUN_ID, commit: SHA }, ['runId', 'commit']), result: OBJECT },
      fn: ({ runId, commit }) => { docs.markReviewed(runDir(runId), commit); return { commit }; },
    },
    // the SDLC gate: Accept intent / Sign off spec, the front matter of both languages, one commit
    {
      channel: 'docs:accept',
      method: 'acceptDoc',
      params: ['projectId', 'item', 'doc'],
      schema: { params: onDoc(), result: OBJECT },
      // the approver: the repository's git identity, else the person at this machine
      fn: ({ projectId, item, doc }) => {
        const dir = repo(projectId);
        return docs.acceptDoc(dir, { item, doc, approver: gitName(dir) || owner() });
      },
    },
  ];
};
