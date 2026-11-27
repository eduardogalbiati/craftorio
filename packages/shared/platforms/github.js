// @ts-check
// The GitHub platform adapter (#351): what the app knows about GitHub and its `gh` CLI, so the rest
// of src/ never branches on the platform. Resolve it through the registry (./index.js, by either
// vocabulary: `github` or `gh`); the GitLab twin (./gitlab.js) has the same members.
// - identity: id, short (workflow input `git_platform`, skill suffix `-gh`), cli, label, host;
// - request: the terms of a pull request ("PR #12"); epics, readsLabels, closeReason, actionsQuota:
//   what the platform offers (epics are issues whose sub-issues are their members, packages/engine/domains/backlog/epics.js);
// - cliTarget / apiHostArgs / issuesUrl / issueUrl / settingsUrl: a repository ({ host, path }) as the CLI and links want it;
// - olderCli / issuesDisabled: what a CLI error message means (an older CLI; Issues turned off, #845);
//   fileCommand / rawFileUrl: one file of its default branch, through the CLI or a public raw read;
// - *Command: the { cli, args } of each operation (issues, labels, pull requests, epics, the Oracle, probes);
// - parse*: the CLI's JSON → the app's objects;
// - parseIssueUrl / parseTargetUrl: issue, pull request and Actions run URLs.
// Browser: window.PlatformGitHub; Node: module.exports.
(function (root) {
  const OWN_HOST = 'github.com';
  const ISSUE_FIELDS = 'number,title,state,labels,url,author,assignees,body,createdAt,updatedAt';
  const REQUEST_FIELDS = 'number,title,url,isDraft,body';
  // #812: the PRs screen's list, the fields of a PR card (run-pr.js fetchPrMonitor's) and of a stack (the branches)
  const PULL_FIELDS = 'number,title,url,author,isDraft,headRefName,baseRefName,state,mergeable,mergeStateStatus,reviewDecision,latestReviews,statusCheckRollup';
  const GH_FAILED = ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'];
  const GH_PASSED = ['SUCCESS', 'NEUTRAL', 'SKIPPED'];
  const CLOSING_FIELD = 'closingIssuesReferences';
  const TYPED_EPICS = '.[] | select(((.type.name // "") | ascii_downcase) == "epic") | .number';
  const LIST_STEPS = [40, 100, 200];
  const ISSUE_COUNT_QUERY = 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){issues{totalCount}}}';
  const cmd = (args) => ({ cli: 'gh', args });
  // the catalog's helper, at call time (in the browser i18n.js loads after this file)
  const t = (...a) => (typeof module === 'object' && module.exports ? require('../i18n') : root.I18n)?.t(...a) ?? a[0];

  // One check of statusCheckRollup → pass | fail | pending: statusCheckRollup mixes check runs (status + conclusion)
  // and commit statuses (state). The one copy of the rule (#812): the engine's probes.js and run-pr.js use it too.
  function checkBucket(c) {
    const bucket = (s) => (GH_FAILED.includes(s) ? 'fail' : GH_PASSED.includes(s) ? 'pass' : 'pending');
    if (c?.__typename === 'StatusContext' || (c?.state && !c?.status)) return bucket(String(c.state || '').toUpperCase());
    if (String(c?.status || '').toUpperCase() !== 'COMPLETED') return 'pending';
    return bucket(String(c.conclusion || '').toUpperCase());
  }

  // A PR's JSON (`gh pr view` / `gh pr list --json`) → its card's lines, one rule for the run's PR monitor (run-pr.js
  // ghMonitor / ghPrDisplay) and the PRs screen's list (#812).
  // The CI line: none, failed (its checks), running or passed
  function pullCi(p) {
    const buckets = (p.statusCheckRollup || []).map(checkBucket);
    const failed = (p.statusCheckRollup || []).filter((c, i) => buckets[i] === 'fail').map((c) => c.name || c.context || '?');
    return { status: !buckets.length ? 'none' : failed.length ? 'failed' : buckets.includes('pending') ? 'running' : 'passed', failed };
  }

  // The review line: changes requested (by whom), required, approved or none. A branch rule that requires no review
  // leaves reviewDecision empty: a latest review asking for changes still blocks.
  function pullReview(p) {
    const by = (s) => (p.latestReviews || []).filter((r) => r.state === s).map((r) => r.author?.login).filter(Boolean);
    const decision = String(p.reviewDecision || '').toUpperCase();
    if (decision === 'CHANGES_REQUESTED' || (decision !== 'APPROVED' && by('CHANGES_REQUESTED').length)) return { status: 'changes_requested', by: by('CHANGES_REQUESTED') };
    if (decision === 'REVIEW_REQUIRED') return { status: 'required', by: [] };
    return decision === 'APPROVED' || by('APPROVED').length ? { status: 'approved', by: by('APPROVED') } : { status: 'none', by: [] };
  }

  // Whether the PR conflicts with its base
  const pullConflict = (p) => p.mergeable === 'CONFLICTING' || p.mergeStateStatus === 'DIRTY';

  // The state the lists show (run-pr.js PR_STATES): merged | closed | draft | conflict | failing | pending | ready | open
  function pullState(p, ci = pullCi(p), conflict = pullConflict(p)) {
    const s = String(p.state || 'OPEN').toUpperCase();
    if (s === 'MERGED' || s === 'CLOSED') return s.toLowerCase();
    if (p.isDraft) return 'draft';
    if (conflict) return 'conflict';
    if (ci.status === 'failed') return 'failing';
    if (ci.status === 'running') return 'pending';
    return p.mergeable === 'MERGEABLE' && String(p.mergeStateStatus || '').toUpperCase() === 'CLEAN' ? 'ready' : 'open';
  }

  // #812: one `gh pr list --json` entry → a PR card's entry, read from the list's fields only
  function parsePull(p) {
    const ci = pullCi(p);
    const review = pullReview(p);
    const conflict = pullConflict(p);
    const state = pullState(p, ci, conflict);
    return {
      number: p.number, title: p.title || '', url: p.url, author: p.author?.login || null, draft: !!p.isDraft,
      head: p.headRefName || null, base: p.baseRefName || null, state, ci, review, conflicts: { status: conflict ? 'base' : 'none' },
    };
  }

  const github = {
    id: 'github',
    short: 'gh',
    cli: 'gh',
    label: 'GitHub',
    host: OWN_HOST,
    request: Object.freeze({ noun: 'pull request', short: 'PR', sign: '#' }),
    epics: 'sub-issues',
    get epicHelp() { return t('platform.github.epic_help'); },
    // the repository's labels are read before one is used (GitLab creates a missing label itself)
    readsLabels: true,
    closeReason: 'not planned',
    // GitHub Actions minutes can run out (packages/engine/engine/probes.js withQuota)
    actionsQuota: true,
    // the check conclusions and a PR's card lines (#812: one copy, used by the engine's probes.js and run-pr.js)
    GH_FAILED,
    GH_PASSED,
    checkBucket,
    pullCi,
    pullConflict,
    pullReview,
    pullState,

    // ---- a repository ({ host, path }: packages/engine/domains/backlog/issues.js parseRepoUrl)
    cliTarget: ({ host, path }) => (host === OWN_HOST ? path : `${host}/${path}`),
    apiHostArgs: ({ host }) => (host === OWN_HOST ? [] : ['--hostname', host]),
    issuesUrl: ({ host, path }) => `https://${host}/${path}/issues/`,
    issueUrl: (base, number) => `${base}/issues/${number}`,
    // #845: where the repository's Issues are turned on again
    settingsUrl: ({ host, path }) => `https://${host}/${path}/settings`,
    // a file of the default branch (#486): the contents API (JSON, base64 content), else a public raw read
    fileCommand: ({ host, path }, file) => cmd(['api', ...github.apiHostArgs({ host }), `repos/${path}/contents/${file}`]),
    rawFileUrl: ({ path }, file) => `https://raw.githubusercontent.com/${path}/HEAD/${file}`,

    // ---- issues
    issueListCommand: (target, limit) => cmd(['issue', 'list', '--repo', target, '--state', 'all', '--limit', String(limit), '--json', ISSUE_FIELDS]),
    // #781: the list read in steps, so a count can grow: `gh issue list` has no offset, so each step reads the list
    // again with a higher limit (upTo: the most issues read once the step ended; adds: its answer joins the others')
    issueListSteps: (target, limit) => [...LIST_STEPS.filter((n) => n < limit), limit].map((upTo) => ({ ...github.issueListCommand(target, upTo), upTo, adds: false })),
    // how many issues the repository has, in one cheap call (the "of 120" of the count)
    issueCountCommand: ({ host, path }) => {
      const [owner, name] = path.split('/');
      return cmd(['api', 'graphql', ...github.apiHostArgs({ host }), '-f', `query=${ISSUE_COUNT_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '--jq', '.data.repository.issues.totalCount']);
    },
    parseIssueCount: (out) => (/^\d+$/.test(String(out).trim()) ? Number(out) : null),
    issueViewCommand: (target, n) => cmd(['issue', 'view', n, '--repo', target, '--json', ISSUE_FIELDS]),
    issueCreateCommand: ({ target, title, labels, file }) => cmd(['issue', 'create', '--repo', target, '--title', title, '--body-file', file, ...labels.flatMap((l) => ['--label', l])]),
    issueSaveCommand: ({ target, n, mode, file }) => cmd(['issue', mode === 'replace' ? 'edit' : 'comment', n, '--repo', target, '--body-file', file]),
    // a comment on a pull request (#568: a trigger's report; `gh issue comment` may refuse a PR's number)
    prCommentCommand: ({ target, n, file }) => cmd(['pr', 'comment', n, '--repo', target, '--body-file', file]),
    issueCloseCommand: (target, n) => cmd(['issue', 'close', n, '--repo', target, '--reason', github.closeReason]),
    issueReopenCommand: (target, n) => cmd(['issue', 'reopen', n, '--repo', target]),
    issueLabelCommand: ({ target, n, label, add }) => cmd(['issue', 'edit', n, '--repo', target, add ? '--add-label' : '--remove-label', label]),
    // `gh issue list|view --json` → the app's issue (packages/engine/domains/backlog/issues.js adds `tasks`)
    parseIssue: (i) => ({
      number: i.number,
      title: i.title,
      state: String(i.state).toLowerCase() === 'open' ? 'open' : 'closed',
      labels: (i.labels || []).map((l) => ({ name: l.name, color: l.color ? `#${l.color}` : null })),
      url: i.url,
      author: i.author?.login || null,
      // #90: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE… (GraphQL's authorAssociation, REST's author_association)
      authorAssociation: String(i.authorAssociation ?? i.author_association ?? '').toUpperCase() || null,
      assignees: (i.assignees || []).map((a) => a.login),
      body: i.body || '',
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    }),
    // #90: `gh issue list --json` has no authorAssociation: one GraphQL call reads it for the listed issues
    // (an alias per number) → [{ number, authorAssociation }]; null when there is nothing to read
    issueAuthorsCommand: ({ host, path }, numbers) => {
      const [owner, name] = path.split('/');
      const list = (numbers || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
      if (!list.length) return null;
      const query = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${list.map((n) => `i${n}:issue(number:${n}){number authorAssociation}`).join(' ')}}}`;
      return cmd(['api', 'graphql', ...github.apiHostArgs({ host }), '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '--jq', '[.data.repository[] | select(. != null)]']);
    },
    parseIssueAuthors: (out) => {
      const list = JSON.parse(out || '[]');
      return (Array.isArray(list) ? list : []).filter((x) => x && x.number != null)
        .map((x) => ({ number: Number(x.number), authorAssociation: String(x.authorAssociation ?? x.author_association ?? '').toUpperCase() || null }));
    },

    // ---- labels
    labelListCommand: (target) => cmd(['label', 'list', '--repo', target, '--limit', '500', '--json', 'name']),
    labelCreateCommand: ({ target, name, color, description, force }) => cmd(['label', 'create', name, '--repo', target, '--color', color, '--description', description, ...(force ? ['--force'] : [])]),
    parseLabelNames: (out) => JSON.parse(out || '[]').map((l) => l.name),

    // ---- pull requests
    // closing: false for gh versions that do not know closingIssuesReferences (see olderCli)
    requestListCommand: (target, limit, { closing = true } = {}) => cmd(['pr', 'list', '--repo', target, '--state', 'open', '--limit', String(limit), '--json', closing ? `${REQUEST_FIELDS},${CLOSING_FIELD}` : REQUEST_FIELDS]),
    olderCli: (message) => new RegExp(CLOSING_FIELD).test(String(message || '')),
    // #845: the repository has Issues turned off (a setting, not a failed read)
    issuesDisabled: (message) => /has disabled issues/i.test(String(message || '')),
    // → { number, title, url, draft, body, closing: issue numbers }
    parseRequests: (out) => JSON.parse(out || '[]').map((p) => ({
      number: p.number, title: p.title, url: p.url, draft: !!p.isDraft, body: p.body, closing: (p[CLOSING_FIELD] || []).map((i) => i.number),
    })),
    // t: parseTargetUrl's { host, repo, id }; fields: gh's --json list
    requestViewCommand: (t, fields) => cmd(['pr', 'view', String(t.id), '--repo', `${t.host}/${t.repo}`, '--json', fields]),
    // #810: the merge from the app is always a merge commit (never --squash / --rebase / --auto); admin ignores
    // the branch protection (the account's permission is checked before), deleteBranch the project's setting
    requestMergeCommand: (t, { admin = false, deleteBranch = false } = {}) => cmd(['pr', 'merge', String(t.id), '--repo', `${t.host}/${t.repo}`, '--merge', ...(admin ? ['--admin'] : []), ...(deleteBranch ? ['--delete-branch'] : [])]),
    requestCloseCommand: (t) => cmd(['pr', 'close', String(t.id), '--repo', `${t.host}/${t.repo}`]),
    runViewCommand: (t) => cmd(['run', 'view', String(t.id), '--repo', `${t.host}/${t.repo}`, '--json', 'status,conclusion,url,name']),
    // #812: the open PRs of a repository (the PRs screen), each with what its card shows
    pullListCommand: (target, limit) => cmd(['pr', 'list', '--repo', target, '--state', 'open', '--limit', String(limit), '--json', PULL_FIELDS]),
    // #812: the list's parsed JSON → [{ number, title, url, author, draft, head, base, state, ci, review, conflicts }], [] when not a list
    parsePulls: (json) => (Array.isArray(json) ? json.filter((p) => p && p.number != null).map(parsePull) : []),

    // ---- epics (api: { path, hostArgs }, packages/engine/domains/backlog/epics.js apiTarget)
    typedEpicsCommand: (api) => cmd(['api', ...api.hostArgs, '--paginate', `repos/${api.path}/issues?state=all&per_page=100`, '--jq', TYPED_EPICS]),
    parseTypedEpics: (out) => new Set(String(out || '').split(/\s+/).filter((s) => /^\d+$/.test(s)).map(Number)),
    subIssuesCommand: (api, n) => cmd(['api', ...api.hostArgs, `repos/${api.path}/issues/${Number(n)}/sub_issues?per_page=100`]),
    // the sub-issues of the same repository
    parseSubIssues: (out, api) => {
      const own = `/repos/${api.path}`.toLowerCase();
      return JSON.parse(out || '[]')
        .filter((x) => !x.repository_url || String(x.repository_url).toLowerCase().endsWith(own))
        .map((x) => Number(x.number)).filter(Boolean);
    },
    issueIdCommand: (api, n) => cmd(['api', ...api.hostArgs, `repos/${api.path}/issues/${n}`, '--jq', '.id']),
    addSubIssueCommand: (api, epic, id) => cmd(['api', ...api.hostArgs, '--method', 'POST', `repos/${api.path}/issues/${epic}/sub_issues`, '-F', `sub_issue_id=${id}`, '-F', 'replace_parent=true']),

    // ---- the Oracle's read tools (packages/engine/domains/oracle/oracle-platform.js)
    searchCommand: ({ target, query, state, limit }) => cmd(['issue', 'list', '--repo', target, ...(query ? ['--search', query] : []), '--state', state, '--limit', String(limit), '--json', 'number,title,state,labels,url,updatedAt']),
    viewCommand: (target, n) => cmd(['issue', 'view', n, '--repo', target, '--json', 'number,title,state,body,labels,url,comments']),
    labelsCommand: (target, limit) => cmd(['label', 'list', '--repo', target, '--limit', String(limit), '--json', 'name,description']),
    // the CI's recent runs, read by an analysis seed that declares the need (#360)
    ciRunsCommand: ({ target, limit }) => cmd(['run', 'list', '--repo', target, '--limit', String(limit || 20), '--json', 'databaseId,name,status,conclusion,createdAt,updatedAt,url']),
    parseCiRuns: (text) => {
      let list;
      try { list = JSON.parse(String(text || '')); } catch { return []; }
      return Array.isArray(list) ? list.map((r) => ({ id: r.databaseId, name: r.name, status: r.status, conclusion: r.conclusion || null, createdAt: r.createdAt, updatedAt: r.updatedAt, url: r.url })) : [];
    },

    // ---- the signed-in account's repositories (#669, the wizard's list under the repository field)
    repoListCommand: (limit) => cmd(['repo', 'list', '--limit', String(limit || 30), '--json', 'nameWithOwner,isPrivate,updatedAt']),
    // → [{ name: 'owner/repo', private, updatedAt }], [] when the output holds no JSON list
    parseRepos: (text) => {
      const s = String(text || '');
      let list;
      try { list = JSON.parse(s.slice(s.indexOf('['), s.lastIndexOf(']') + 1)); } catch { return []; }
      return Array.isArray(list) ? list.map((r) => ({ name: r.nameWithOwner, private: !!r.isPrivate, updatedAt: r.updatedAt || null })).filter((r) => typeof r.name === 'string' && r.name) : [];
    },
    // #632: a new project's private repository, from its local folder (origin is added; never --public)
    repoCreateCommand: ({ name, folder }) => cmd(['repo', 'create', name, '--private', '--source', folder, '--remote', 'origin']),

    // ---- the push permission and the owner's fork (#738, the onboarding's Fork + PR)
    // a repository is named owner/repo (no subgroups)
    subgroups: false,
    repoInfoCommand: (path) => cmd(['api', `repos/${path}`]),
    // `gh api repos/<path>` → permissions.push (true / false), undefined when the answer has none
    parsePush: (info) => info?.permissions?.push,
    // #810: whether the account may merge from the app (unknown: yes, the platform refuses otherwise) and
    // bypass the branch protection (`--admin`: a repository admin)
    parseMergeRights: (info) => ({ canMerge: info?.permissions?.push !== false, canBypass: info?.permissions?.admin === true }),
    userCommand: () => cmd(['api', 'user']),
    parseUser: (info) => info?.login,
    // the repository info is a fork of the repository `name` (owner/repo)
    isForkOf: (info, name) => !!info?.fork && info.parent?.full_name === name,
    repoWebUrl: (info) => info?.html_url || (info?.full_name ? `https://${OWN_HOST}/${info.full_name}` : null),
    // `gh repo fork` never sets remotes here (--clone=false); its output ends with the fork's URL
    forkCommand: (name) => cmd(['repo', 'fork', name, '--clone=false']),
    parseForkUrl: (out) => (String(out || '').match(/https:\/\/\S+/g) || []).slice(-1)[0] || null,

    // ---- git's push access (#79, workspace.js pushableUrl / checkPushAccess): the CLI's git protocol for a
    // host (ssh | https), and the command that makes git push over HTTPS with the CLI's login
    protocolCommand: (host) => cmd(['config', 'get', 'git_protocol', '-h', host]),
    setupGitCommand: () => cmd(['auth', 'setup-git']),

    // ---- URLs
    // https://host/owner/repo/issues/12 → { host, repo, number }, or null
    parseIssueUrl(url) {
      const m = /^https?:\/\/([^/\s?#]+)\/([^/\s?#]+\/[^/\s?#]+)\/issues\/(\d+)(?:[/?#].*)?$/.exec(String(url ?? '').trim());
      return m ? { host: m[1], repo: m[2], number: +m[3] } : null;
    },
    // https://host/owner/repo/pull/12, https://host/owner/repo/actions/runs/123[/job/4] → { host, repo, kind: 'pr' | 'run', id }, or null
    parseTargetUrl(url) {
      const m = /^https:\/\/([A-Za-z0-9.-]+(?::\d+)?)\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(pull|actions\/runs)\/(\d+)(?:[/?#].*)?$/.exec(String(url ?? '').trim());
      return m ? { host: m[1], repo: m[2], kind: m[3] === 'pull' ? 'pr' : 'run', id: +m[4] } : null;
    },
    // #797: a pull request's URL from its repository's (https://host/owner/repo) and its number
    requestUrl: (repo, number) => `${repo}/pull/${number}`,
  };

  if (typeof module === 'object' && module.exports) module.exports = github;
  else root.PlatformGitHub = github;
})(typeof window !== 'undefined' ? window : globalThis);
