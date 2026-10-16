// Backlog archive rules (#238): an archived issue is closed on the platform (GitHub: not planned)
// and labelled `archived`; the state chips put it under Archived, not Closed. An issue planned in
// the roadmap (planned or running item) or with a run in progress cannot be archived. The retired
// `deprioritized` label is only read, to offer archiving the issues that still carry it.
// No DOM here: backlog.js draws the actions, src/backlog.js applies the guard, a test feeds it issues.
// Browser: window.BacklogArchive; Node: module.exports.
(function (root) {
  const ARCHIVED_LABEL = 'archived';
  const RETIRED_LABEL = 'deprioritized';
  const ACTIVE_RUN = new Set(['paused', 'running', 'waiting']);
  const key = (name) => String(name || '').trim().toLowerCase();
  // whether `issue` carries the label `name` (lowercase), its labels as names or { name }
  const hasLabel = (issue, name) => (issue?.labels || []).some((l) => key(typeof l === 'string' ? l : l?.name) === name);
  const isClosed = (issue) => key(issue?.state) === 'closed';

  function isArchived(issue) {
    return isClosed(issue) && hasLabel(issue, ARCHIVED_LABEL);
  }

  // 'open' | 'closed' | 'archived': the Backlog's state chips.
  function issueState(issue) {
    if (!isClosed(issue)) return 'open';
    return isArchived(issue) ? 'archived' : 'closed';
  }

  // Why the issue cannot be archived, or null. `roadmap` and `runs` are the service's links
  // (withIssueRuns): a planned or running roadmap item, or a run in progress.
  function archiveBlockReason(issue) {
    const item = issue?.roadmap;
    if (item?.status === 'planned') return `Planned in stage ${item.stage}: remove it from the roadmap first`;
    if (item?.status === 'running') return `Running in stage ${item.stage} of the roadmap: wait for it or remove it from the roadmap first`;
    if ((issue?.runs || []).some((r) => ACTIVE_RUN.has(r?.status))) return 'A run is in progress for this issue: wait for it to end first';
    return null;
  }

  // the platform registry (./platforms, #351): required in Node, a global loaded before this in the browser
  const platforms = () => (typeof module === 'object' && module.exports ? require('./platforms') : root.Platforms);

  function archiveConfirmText(numbers, platform) {
    const list = (numbers || []).map((n) => `#${n}`).join(', ');
    const them = (numbers || []).length === 1 ? 'it' : 'them';
    const p = platforms().platformOrDefault(platform);
    return `Close ${list}${p.closeReason ? ` as ${p.closeReason}` : ''} on ${p.label} and label ${them} archived?`;
  }

  function deprioritizedIssues(issues) {
    return (issues || []).filter((i) => !isClosed(i) && hasLabel(i, RETIRED_LABEL));
  }

  const api = { ARCHIVED_LABEL, archiveBlockReason, archiveConfirmText, deprioritizedIssues, hasLabel, isArchived, issueState };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BacklogArchive = api;
})(typeof window !== 'undefined' ? window : globalThis);
