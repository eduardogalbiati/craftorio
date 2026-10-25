// The Oracle's platform read tools (#184): issues_search, issue_view and labels on a project's
// GitHub or GitLab repository, through gh / glab, read-only (list, view and label list only: the
// commands are built here, never taken from the model). The repository and platform are the ones the
// project's synced backlog uses (src/domains/backlog/backlog.js cliTarget), else the project's repository URL.
// The commands come from the platform's adapter (src/shared/platforms/, #351; GitHub when unset).

const { platformOrDefault } = require('../../shared/platforms');

const ISSUE_STATES = ['all', 'closed', 'open'];
const SEARCH_LIMIT = 30;
const LABEL_LIMIT = 200;
const MAX_BODY = 20000;

/** gh / glab arguments that search a repository's issues ({ cli, args }). */
function searchCommand({ platform, target, query, state = 'open' }) {
  const s = ISSUE_STATES.includes(state) ? state : 'open';
  const q = String(query || '').trim();
  return platformOrDefault(platform).searchCommand({ target, query: q, state: s, limit: SEARCH_LIMIT });
}

/** gh / glab arguments that read one issue with its body and labels. */
function viewCommand({ platform, target, number }) {
  const n = String(Math.floor(Number(number)));
  if (!(Number(n) > 0)) throw new Error(`Not an issue number: ${number}`);
  return platformOrDefault(platform).viewCommand(target, n);
}

/** gh / glab arguments that list a repository's labels. */
function labelsCommand({ platform, target }) {
  return platformOrDefault(platform).labelsCommand(target, LABEL_LIMIT);
}

const labelNames = (labels) => (Array.isArray(labels) ? labels.map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean) : []);
const parse = (out) => { try { return JSON.parse(String(out || '')); } catch { return null; } };

// compact forms for the Oracle's context
function searchResult(out) {
  const list = parse(out);
  if (!Array.isArray(list)) return String(out || '').trim();
  return list.map((i) => ({ number: i.number ?? i.iid, title: i.title, state: i.state, labels: labelNames(i.labels), url: i.url || i.web_url }));
}
function viewResult(out) {
  const i = parse(out);
  if (!i || typeof i !== 'object') return String(out || '').trim();
  const body = String(i.body ?? i.description ?? '');
  return {
    number: i.number ?? i.iid, title: i.title, state: i.state, labels: labelNames(i.labels), url: i.url || i.web_url,
    body: body.length > MAX_BODY ? `${body.slice(0, MAX_BODY)}… (cut at ${MAX_BODY} characters)` : body,
    comments: Array.isArray(i.comments) ? i.comments.length : undefined,
  };
}
function labelsResult(out) {
  const list = parse(out);
  if (!Array.isArray(list)) return String(out || '').trim();
  return list.map((l) => (l.description ? { name: l.name, description: l.description } : { name: l.name }));
}

// #360: the CI's recent runs, the network read an analysis seed may declare (read-only)
const CI_RUNS_LIMIT = 20;
const ciRunsCommand = (platform, { target, limit = CI_RUNS_LIMIT }) => platformOrDefault(platform).ciRunsCommand({ target, limit });
const ciRunsResult = (platform, text) => platformOrDefault(platform).parseCiRuns(text);

module.exports = {
  ciRunsCommand,
  ciRunsResult,
  ISSUE_STATES,
  labelsCommand,
  labelsResult,
  searchCommand,
  searchResult,
  viewCommand,
  viewResult,
};
