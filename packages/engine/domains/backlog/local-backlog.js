// The local backlog (#35): a project with no remote keeps its issues in the workspace, in
// <workspace>/backlog/<project id>.local-issues.json, apart from the synced cache (<id>.json, which a sync
// rewrites) and the push status (<id>.local.json). Each issue has the shape of a synced one (fetchIssues), with
// `url: null` and `local: true`, so the runs, the roadmap and the Product Owner read it unchanged; its number is
// the next free one in the file (renumberLocalIssues moves it past the platform's numbers when a repository is
// added later: backlog.js syncBacklog). Reading and writing them never calls a platform CLI or git: nothing leaves the machine.
// packages/engine/domains/backlog/backlog.js readBacklog joins these issues to the synced ones; once a repository
// is added the owner may file them on the platform (fileLocalIssues, backlog:file-local: a preview, then the only
// CLI call here, on the owner's click), which removes the filed ones from here.

const fs = require('fs');
const path = require('path');
const {
  ARCHIVED_COLOR,
  execCli,
  issueCreateCommand,
  sameLabel,
  taskProgress,
} = require('./issues');
const { ARCHIVED_LABEL, archiveBlockReason } = require('@craftorio/shared/backlog-archive');

const fileOf = (dir, projectId) => path.join(dir, `${path.basename(String(projectId))}.local-issues.json`);
const labelsOf = (labels) => (labels || []).map((l) => (typeof l === 'string' ? { name: l, color: null } : l)).filter((l) => l?.name);

/** The project's local issues, or null when it never had one (no file). */
function readLocalIssues(dir, projectId) {
  try {
    const data = JSON.parse(fs.readFileSync(fileOf(dir, projectId), 'utf8'));
    return Array.isArray(data?.issues) ? data.issues : [];
  } catch { return null; }
}

function writeLocalIssues(dir, projectId, issues) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fileOf(dir, projectId), JSON.stringify({ projectId: path.basename(String(projectId)), issues }, null, 2));
  return issues;
}

/** The local backlog as backlog:get answers it: the synced cache's shape, no platform, no repository. */
function localBacklog(projectId, issues = []) {
  const sorted = [...issues].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { projectId: path.basename(String(projectId)), platform: null, repo: null, local: true, syncedAt: null, issues: sorted, epics: [] };
}

/** New issue: { number, ... } with the next free number (`taken`: numbers used elsewhere, e.g. the synced ones). */
function createLocalIssue(dir, projectId, { title, body = '', labels = [], taken = [] }) {
  const name = String(title || '').trim();
  if (!name) throw new Error('An issue needs a title.');
  const issues = readLocalIssues(dir, projectId) || [];
  const number = Math.max(0, ...issues.map((i) => i.number), ...taken.map(Number).filter(Number.isInteger)) + 1;
  const now = new Date().toISOString();
  const text = String(body || '');
  const issue = {
    number, title: name, state: 'open', labels: labelsOf(labels), url: null, local: true, author: null, assignees: [],
    body: text, createdAt: now, updatedAt: now, tasks: taskProgress(text),
  };
  writeLocalIssues(dir, projectId, [...issues, issue]);
  return issue;
}

// Changes one local issue with `fn`; throws when it is not a local issue of the project.
function patchLocalIssue(dir, projectId, number, fn) {
  const issues = readLocalIssues(dir, projectId) || [];
  const at = issues.findIndex((i) => i.number === Number(number));
  if (at < 0) throw new Error(`Issue #${number} is not in the local backlog.`);
  const issue = { ...fn(issues[at]), updatedAt: new Date().toISOString() };
  issue.tasks = taskProgress(issue.body);
  issues[at] = issue;
  writeLocalIssues(dir, projectId, issues);
  return issue;
}

/** Edit: a new title and/or body. */
function updateLocalIssue(dir, projectId, number, { title, body } = {}) {
  return patchLocalIssue(dir, projectId, number, (i) => ({
    ...i,
    ...(typeof title === 'string' && title.trim() ? { title: title.trim() } : {}),
    ...(typeof body === 'string' ? { body } : {}),
  }));
}

function closeLocalIssue(dir, projectId, number) {
  return patchLocalIssue(dir, projectId, number, (i) => ({ ...i, state: 'closed', closedAt: new Date().toISOString() }));
}

const isLocal = (dir, projectId, number) => (readLocalIssues(dir, projectId) || []).some((i) => i.number === Number(number));

// Each number on its own: { number, ok, error? }, as archiveIssues answers for a synced issue.
function eachIssue(dir, projectId, numbers, fn) {
  return {
    results: (numbers || []).map(Number).map((number) => {
      try {
        fn(number);
        return { number, ok: true };
      } catch (e) { return { number, ok: false, error: e.message }; }
    }),
  };
}

/** Archive (#238's rules): closed with the `archived` label; `issues`: the Backlog's, with their roadmap and run links (the guards). */
function archiveLocalIssues(dir, projectId, { numbers, issues = [] }) {
  const known = new Map((issues || []).map((i) => [i.number, i]));
  return eachIssue(dir, projectId, numbers, (number) => {
    const refused = archiveBlockReason(known.get(number));
    if (refused) throw new Error(refused);
    patchLocalIssue(dir, projectId, number, (i) => ({
      ...i, state: 'closed', closedAt: new Date().toISOString(),
      labels: [...(i.labels || []).filter((l) => !sameLabel(l, ARCHIVED_LABEL)), { name: ARCHIVED_LABEL, color: `#${ARCHIVED_COLOR}` }],
    }));
  });
}

/** Restore: open again, without the `archived` label. */
function restoreLocalIssues(dir, projectId, { numbers }) {
  return eachIssue(dir, projectId, numbers, (number) => patchLocalIssue(dir, projectId, number, (i) => {
    const { closedAt: _closed, ...rest } = i;
    return { ...rest, state: 'open', labels: (i.labels || []).filter((l) => !sameLabel(l, ARCHIVED_LABEL)) };
  }));
}

/**
 * A repository added after the local issues: the local issues whose number a synced issue has (`taken`) get the
 * next free numbers, so no number names two issues. Answers { old: new } ({} when none moved). A moved issue keeps
 * its earlier numbers in `was` (renumberedFrom): the runs and the Discovery card that name them stay its own.
 */
function renumberLocalIssues(dir, projectId, taken = []) {
  const own = readLocalIssues(dir, projectId) || [];
  const used = new Set(taken.map(Number).filter(Number.isInteger));
  let next = Math.max(0, ...used, ...own.map((i) => i.number)) + 1;
  const moved = {};
  const issues = own.map((i) => {
    if (!used.has(i.number)) return i;
    moved[i.number] = next;
    return { ...i, number: next++, was: [...(i.was || []), i.number] };
  });
  if (Object.keys(moved).length) writeLocalIssues(dir, projectId, issues);
  return moved;
}

/** The earlier numbers of the renumbered local issues among `issues`: old number → its current one. */
function renumberedFrom(issues = []) {
  const out = new Map();
  for (const i of issues || []) if (i?.local) for (const old of i.was || []) out.set(Number(old), i.number);
  return out;
}

/** What an issue-create command answered: { url, number } (the number in the platform's URL, or the local backlog's). */
function filedIssue(out, command = {}) {
  const text = String(out || '');
  const url = text.match(/https?:\/\/\S+/)?.[0] || null;
  const number = Number(url?.match(/\/(\d+)\/?$/)?.[1]) || (command.local && Number(text)) || null;
  return { url, number };
}

/**
 * The issue workflow's run on a project with no remote (workflows/issue.yaml): the drafts the owner approved
 * (steps.write.output.issues) go into the local backlog, as its filer would have filed them. `create` and
 * `create_assign` add each draft; `add_to` appends the addition (or the draft's body) to the local issue it names.
 * Answers the filer's `filed` shape: [{ action, number, url: '', title }] ([] for any other choice).
 */
function fileRunDrafts(dir, projectId, steps = {}) {
  const reviewed = steps.review?.output?.choice;
  const choice = reviewed || (steps.file?.output ? 'create' : null);
  const draft = steps.write?.output || {};
  const drafts = (draft.issues || []).filter((i) => String(i?.title || '').trim());
  if (choice === 'add_to') {
    const number = Number(String(steps.review?.output?.feedback || '').match(/#(\d+)/)?.[1]) || Number(draft.existing_issue);
    if (!isLocal(dir, projectId, number)) return [];
    const text = draft.addition || drafts[0]?.body || '';
    const issue = patchLocalIssue(dir, projectId, number, (i) => ({ ...i, body: `${String(i.body || '').trimEnd()}\n\n${text}` }));
    return [{ action: 'edited', number: issue.number, url: '', title: issue.title }];
  }
  if (!['create', 'create_assign'].includes(choice)) return [];
  return drafts.map((d) => {
    const issue = createLocalIssue(dir, projectId, { title: d.title, body: d.body, labels: d.labels });
    return { action: 'created', number: issue.number, url: '', title: issue.title };
  });
}

/** Drops local issues (filed on the platform since): the others stay. */
function removeLocalIssues(dir, projectId, numbers) {
  const gone = new Set((numbers || []).map(Number));
  return writeLocalIssues(dir, projectId, (readLocalIssues(dir, projectId) || []).filter((i) => !gone.has(i.number)));
}

/**
 * Once a repository was added: files the open local issues on its platform, on the owner's click only. `preview`
 * names each issue and the command, and runs nothing. A filed issue leaves the local backlog (the next sync reads it
 * from the platform); one that fails stays, with its error. { preview, issues: [{ number, title, command, url?, error? }] }
 */
async function fileLocalIssues({ dir, projectId, platform, repo, preview = true, exec = execCli }) {
  if (!repo) throw new Error('Add a repository in Projects › Edit first: the local issues are filed there.');
  const open = (readLocalIssues(dir, projectId) || []).filter((i) => i.state === 'open');
  const file = path.join(dir, `${path.basename(String(projectId))}.file-local.md`);
  const issues = [];
  const filed = [];
  for (const i of open) {
    const labels = (i.labels || []).map((l) => l.name);
    const command = issueCreateCommand({ platform, repo, title: i.title, labels, file, text: i.body || '' });
    const entry = { number: i.number, title: i.title, command: command.display };
    if (!preview) {
      try {
        fs.writeFileSync(file, i.body || '');
        entry.url = filedIssue(await exec(command.cli, command.args), command).url;
        filed.push(i.number);
      } catch (e) { entry.error = e.message; }
    }
    issues.push(entry);
  }
  if (!preview) {
    fs.rmSync(file, { force: true });
    removeLocalIssues(dir, projectId, filed);
  }
  return { preview: !!preview, issues };
}

// The Product Owner's filing into the local backlog (packages/engine/domains/po/product-owner.js fileDraft): what a
// platform command is for a repository, with `run` instead of a CLI. `run` answers the issue's number (as text).
const LOCAL_DISPLAY = 'add it to the local backlog (in the workspace; nothing is sent to a platform)';

/** A new issue in the local backlog, as a command { local, display, run }. */
function localCreateCommand({ dir, projectId, title, labels = [], text = '' }) {
  return { local: true, display: LOCAL_DISPLAY, run: async () => String(createLocalIssue(dir, projectId, { title, labels, body: text }).number) };
}

/** A local issue's new body (`replace`) or `text` added at its end (`comment`: a local issue has no comments). */
function localSaveCommand({ dir, projectId, number, mode, text = '' }) {
  return {
    local: true,
    display: LOCAL_DISPLAY,
    run: async () => {
      const add = (i) => (mode === 'comment' ? `${String(i.body || '').trimEnd()}\n\n${text}` : text);
      return String(patchLocalIssue(dir, projectId, number, (i) => ({ ...i, body: add(i) })).number);
    },
  };
}

module.exports = {
  archiveLocalIssues,
  closeLocalIssue,
  createLocalIssue,
  filedIssue,
  fileLocalIssues,
  fileRunDrafts,
  isLocal,
  labelsOf,
  localBacklog,
  localCreateCommand,
  localSaveCommand,
  readLocalIssues,
  removeLocalIssues,
  renumberedFrom,
  renumberLocalIssues,
  restoreLocalIssues,
  updateLocalIssue,
};
