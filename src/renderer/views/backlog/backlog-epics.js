// Backlog epics (#138): the epic filter rule, its options with counts, and each epic's progress.
// The sync (src/domains/backlog/epics.js) gives each member issue `epic` (the epic's id: `#12`, or `&5` for a GitLab
// group epic) and the backlog `epics`; an epic issue itself has `isEpic`. The filter is '' (every
// issue), NONE (issues in no epic, epics themselves left out) or an epic's id; it combines with the
// label filter and the search in backlog.js (AND).
// No DOM here: backlog.js draws the select, the badges and the Epics view; a test feeds it issues.
// Browser: window.BacklogEpics; Node: module.exports.
(function (root) {
  const t = (...a) => (typeof module === 'object' && module.exports ? require('../../../shared/i18n') : root.I18n)?.t(...a) ?? a[0];
  const NONE = 'none';

  /** True when the issue passes the epic filter. */
  function matchesEpic(issue, filter) {
    if (!filter) return true;
    if (filter === NONE) return !issue?.epic && !issue?.isEpic;
    return issue?.epic === filter;
  }

  /**
   * The filter's options: every epic with how many of `shown` (the issues the other filters show)
   * are its members, then "No epic" with its count. [{ id, title, count }]
   */
  function epicOptions(epics, shown) {
    const list = shown || [];
    return [
      ...(epics || []).map((e) => ({ id: e.id, title: e.title, count: list.filter((i) => i.epic === e.id).length })),
      { id: NONE, title: t('backlog_epics.no_epic'), count: list.filter((i) => matchesEpic(i, NONE)).length },
    ];
  }

  /** A filter whose epic is gone after a sync falls back to every issue. */
  const pruneEpic = (filter, epics) => (!filter || filter === NONE || (epics || []).some((e) => e.id === filter) ? filter : '');

  /**
   * An epic's progress from its members as synced: open and closed on the platform, and how many
   * are done in the roadmap (or planned in it). { open, closed, total, roadmapDone, inRoadmap, done }
   * (done: closed, or done in the roadmap).
   */
  function epicProgress(epic, issues) {
    const byNumber = new Map((issues || []).map((i) => [i.number, i]));
    const members = (epic?.members || []).map((n) => byNumber.get(n)).filter(Boolean);
    const closed = members.filter((i) => i.state !== 'open').length;
    const roadmapDone = members.filter((i) => i.roadmap?.status === 'done').length;
    return {
      open: members.length - closed,
      closed,
      total: members.length,
      roadmapDone,
      inRoadmap: members.filter((i) => i.roadmap && i.roadmap.status !== 'skipped').length,
      done: members.filter((i) => i.state !== 'open' || i.roadmap?.status === 'done').length,
    };
  }

  const api = { epicOptions, epicProgress, matchesEpic, NONE, pruneEpic };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BacklogEpics = api;
})(typeof window !== 'undefined' ? window : globalThis);
