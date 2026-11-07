// The PRs / MRs screen (#812, packages/engine/service/areas/pulls.js): every open pull/merge request of a project,
// grouped by what it needs (run-pr.js listPulls), and its Merge / Close from the list, a PR no run opened too.
// The merge and the close go through the same rules as the Run screen's card (#810, run-pr.js mergePr / closePr).

const {
  args,
  FLAG,
  listOf,
  OBJECT,
  orNone,
  PROJECT_ID,
  shape,
  text,
} = require('../schemas');

const URL_ARG = text(500, 'The pull/merge request\'s URL, as the list gave it.');

module.exports = (ctx) => [
  // → { projects: [{ projectId, name, platform, error, reason, groups: { needYou, waiting, others } }] }; without a
  // project, every project
  {
    channel: 'pulls:list',
    method: 'listPullRequests',
    params: ['projectId'],
    schema: { params: args({ projectId: orNone(PROJECT_ID) }), result: shape({ projects: listOf(OBJECT) }, ['projects']) },
    fn: (opts) => ctx.listPullRequests(opts),
  },
  // merges a listed PR (a merge commit; admin: ignoring the protection, only with that permission), refused unless the
  // list offers it (a stack's bottom PR only) → { merged, commit?, error?, blockers? }
  {
    channel: 'pulls:merge',
    method: 'mergePullRequest',
    params: ['projectId', 'url', 'admin'],
    schema: { params: args({ projectId: PROJECT_ID, url: URL_ARG, admin: FLAG }, ['projectId', 'url']), result: OBJECT },
    fn: (opts) => ctx.mergePullRequest(opts),
  },
  // closes a listed PR without merging (after the card's confirmation) → { closed, error? }
  {
    channel: 'pulls:close',
    method: 'closePullRequest',
    params: ['projectId', 'url'],
    schema: { params: args({ projectId: PROJECT_ID, url: URL_ARG }, ['projectId', 'url']), result: OBJECT },
    fn: (opts) => ctx.closePullRequest(opts),
  },
];
