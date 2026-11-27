// @ts-check
// The GitLab platform adapter (#351): what the app knows about GitLab and its `glab` CLI, the twin of
// ./github.js (same members; see its header). Resolve it through the registry (./index.js, by either
// vocabulary: `gitlab` or `gl`). GitLab paths may have subgroups (g/sub/project); a self-hosted
// server is named by URL in --repo and by --hostname in `glab api`. Epics: a group epic when the
// project's issues carry one (paid tiers), otherwise an issue labelled epic whose members carry the
// scoped label epic::<slug> (packages/engine/domains/backlog/epics.js).
// Browser: window.PlatformGitLab; Node: module.exports.
(function (root) {
  const OWN_HOST = 'gitlab.com';
  const LIST_PAGES = [1, 2, 3, 4];
  const LIST_PAGE_SIZE = 25;
  const cmd = (args) => ({ cli: 'glab', args });
  // the catalog's helper, at call time (in the browser i18n.js loads after this file)
  const t = (...a) => (typeof module === 'object' && module.exports ? require('../i18n') : root.I18n)?.t(...a) ?? a[0];
  // The pipeline states. The one copy (#812): the engine's probes.js and run-pr.js use them too.
  const GL_PENDING = ['created', 'waiting_for_resource', 'preparing', 'pending', 'running', 'scheduled', 'waiting_for_callback'];
  const GL_FAILED = ['failed', 'canceled', 'canceling'];

  // An MR's JSON (`glab mr view` / `glab mr list --output json`) → its card's lines, one rule for the run's PR monitor
  // (run-pr.js glMonitor / glMrDisplay) and the MRs screen's list (#812).
  // The pipeline's status, lower case ('' when it has none)
  const pullPipeline = (m) => String((m.head_pipeline || m.pipeline || null)?.status || '').toLowerCase();

  // The CI line from the pipeline's status: none, failed, passed, manual (a manual or scheduled job never finishes by
  // itself: someone has to act) or running. `failed` (the failed jobs) is the monitor's to fill.
  function pullCi(ps) {
    if (!ps) return { status: 'none', failed: [] };
    if (GL_FAILED.includes(ps)) return { status: 'failed', failed: [] };
    if (['success', 'skipped'].includes(ps)) return { status: 'passed', failed: [] };
    return { status: ['manual', 'scheduled'].includes(ps) ? 'manual' : 'running', failed: [] };
  }

  // Whether the MR conflicts with its target branch
  const pullConflict = (m) => !!m.has_conflicts || m.detailed_merge_status === 'conflict';

  // The state the lists show (run-pr.js PR_STATES): merged | closed | draft | conflict | failing | pending | ready | open.
  // The merge status: detailed_merge_status (GitLab 15.6+), merge_status before it.
  function pullState(m) {
    const s = String(m.state || 'opened').toLowerCase();
    if (s === 'merged' || s === 'closed') return s;
    if (m.draft || m.work_in_progress) return 'draft';
    if (pullConflict(m)) return 'conflict';
    const ps = pullPipeline(m);
    const ci = pullCi(ps);
    if (ci.status === 'failed') return 'failing';
    if (GL_PENDING.includes(ps)) return 'pending';
    return ['passed', 'none'].includes(ci.status) && ['mergeable', 'can_be_merged'].includes(m.detailed_merge_status || m.merge_status) ? 'ready' : 'open';
  }

  // #812: one `glab mr list --output json` entry → a PR card's entry; the review from detailed_merge_status (the list
  // has no approvals)
  function parsePull(m) {
    const ci = pullCi(pullPipeline(m));
    const ms = m.detailed_merge_status || m.merge_status || '';
    const review = { status: ms === 'requested_changes' ? 'changes_requested' : ms === 'not_approved' ? 'required' : 'none', by: [] };
    const conflict = pullConflict(m);
    const draft = !!(m.draft || m.work_in_progress);
    const state = pullState(m);
    return {
      number: m.iid, title: m.title || '', url: m.web_url, author: m.author?.username || null, draft,
      head: m.source_branch || null, base: m.target_branch || null, state, ci, review, conflicts: { status: conflict ? 'base' : 'none' },
    };
  }

  const gitlab = {
    id: 'gitlab',
    short: 'gl',
    cli: 'glab',
    label: 'GitLab',
    host: OWN_HOST,
    request: Object.freeze({ noun: 'merge request', short: 'MR', sign: '!' }),
    epics: 'labels',
    get epicHelp() { return t('platform.gitlab.epic_help'); },
    readsLabels: false,
    closeReason: null,
    actionsQuota: false,
    // the pipeline states and an MR's card lines (#812: one copy, used by the engine's probes.js and run-pr.js)
    GL_FAILED,
    GL_PENDING,
    pullCi,
    pullConflict,
    pullPipeline,
    pullState,

    // ---- a repository ({ host, path }: packages/engine/domains/backlog/issues.js parseRepoUrl)
    cliTarget: ({ host, path }) => (host === OWN_HOST ? path : `https://${host}/${path}`),
    apiHostArgs: ({ host }) => (host === OWN_HOST ? [] : ['--hostname', host]),
    issuesUrl: ({ host, path }) => `https://${host}/${path}/-/issues/`,
    issueUrl: (base, number) => `${base}/-/issues/${number}`,
    // #845: where the project's Issues are turned on again
    settingsUrl: ({ host, path }) => `https://${host}/${path}/edit`,
    // a file of the default branch (#486): the repository files API (raw text), else a public raw read
    fileCommand: ({ host, path }, file) => cmd(['api', ...gitlab.apiHostArgs({ host }), `projects/${encodeURIComponent(path)}/repository/files/${encodeURIComponent(file)}/raw?ref=HEAD`]),
    rawFileUrl: ({ host, path }, file) => `https://${host}/${path}/-/raw/HEAD/${file}`,

    // ---- issues
    issueListCommand: (target) => cmd(['issue', 'list', '--repo', target, '--all', '--per-page', '100', '--output', 'json']),
    // #781: the list read in steps, so a count can grow: pages of the same 100 issues issueListCommand reads
    // (upTo: the most issues read once the step ended; adds: its answer joins the others')
    issueListSteps: (target) => LIST_PAGES.map((page) => ({
      ...cmd(['issue', 'list', '--repo', target, '--all', '--page', String(page), '--per-page', String(LIST_PAGE_SIZE), '--output', 'json']),
      upTo: page * LIST_PAGE_SIZE,
      adds: true,
    })),
    // how many issues the project has, in one cheap call (the "of 120" of the count)
    issueCountCommand: ({ host, path }) => cmd(['api', ...gitlab.apiHostArgs({ host }), `projects/${encodeURIComponent(path)}/issues_statistics`]),
    parseIssueCount: (out) => JSON.parse(out)?.statistics?.counts?.all ?? null,
    issueViewCommand: (target, n) => cmd(['issue', 'view', n, '--repo', target, '--output', 'json']),
    issueCreateCommand: ({ target, title, labels, text }) => cmd(['issue', 'create', '--repo', target, '--title', title, '--description', text, ...(labels.length ? ['--label', labels.join(',')] : []), '--yes']),
    issueSaveCommand: ({ target, n, mode, text }) => cmd(mode === 'replace' ? ['issue', 'update', n, '--repo', target, '--description', text] : ['issue', 'note', n, '--repo', target, '--message', text]),
    // a note on a merge request (#568: a trigger's report)
    prCommentCommand: ({ target, n, text }) => cmd(['mr', 'note', n, '--repo', target, '--message', text]),
    issueCloseCommand: (target, n) => cmd(['issue', 'close', n, '--repo', target]),
    issueReopenCommand: (target, n) => cmd(['issue', 'reopen', n, '--repo', target]),
    // a scoped label (epic::x) replaces the issue's other label of the same scope
    issueLabelCommand: ({ target, n, label, add }) => cmd(['issue', 'update', n, '--repo', target, add ? '--label' : '--unlabel', label]),
    // `glab issue list|view --output json` → the app's issue (packages/engine/domains/backlog/issues.js adds `tasks`)
    parseIssue: (i) => ({
      number: i.iid,
      title: i.title,
      state: i.state === 'opened' ? 'open' : 'closed',
      labels: (i.labels || []).map((name) => ({ name: typeof name === 'string' ? name : name.name, color: name.color || null })),
      url: i.web_url,
      author: i.author?.username || null,
      // #90: GitLab's issue has no association: fetchIssues maps the author through the members (issueAuthorsCommand)
      authorAssociation: null,
      assignees: (i.assignees || []).map((a) => a.username),
      body: i.description || '',
      createdAt: i.created_at,
      updatedAt: i.updated_at,
      // a group epic (GitLab paid tiers): read by packages/engine/domains/backlog/epics.js, not kept in the cache
      ...(i.epic?.iid ? { groupEpic: { iid: i.epic.iid, title: i.epic.title || null, groupId: i.epic.group_id ?? null, url: i.epic.web_url || i.epic.url || null } } : {}),
    }),
    // #90: the project's members (inherited ones too) → [{ login, accessLevel }]: an issue's author is mapped
    // through them (packages/engine/domains/backlog/issue-author.js gitlabAssociation, WRITE_LEVEL). Every page is
    // read (--paginate prints one JSON array per page, back to back): a member past the first 100 stays a member
    issueAuthorsCommand: ({ host, path }) => cmd(['api', ...gitlab.apiHostArgs({ host }), '--paginate', `projects/${encodeURIComponent(path)}/members/all?per_page=100`]),
    parseIssueAuthors: (out) => {
      const text = String(out || '').trim();
      const list = text ? JSON.parse(`[${text.replace(/\]\s*\[/g, ',').replace(/^\[|\]$/g, '')}]`) : [];
      return (Array.isArray(list) ? list : []).filter((m) => m && m.username).map((m) => ({ login: m.username, accessLevel: Number(m.access_level) || 0 }));
    },

    // ---- labels: GitLab creates a missing label itself, so none is read or created first
    labelListCommand: () => null,
    labelCreateCommand: () => null,
    parseLabelNames: (out) => JSON.parse(out || '[]').map((l) => l.name),

    // ---- merge requests
    requestListCommand: (target) => cmd(['mr', 'list', '--repo', target, '--per-page', '100', '--output', 'json']),
    olderCli: () => false,
    // #845: the project has Issues turned off (a setting, not a failed read)
    issuesDisabled: (message) => /issues? feature is disabled|issues are disabled/i.test(String(message || '')),
    // → { number, title, url, draft, body, closing: issue numbers }
    parseRequests: (out) => JSON.parse(out || '[]').map((m) => ({
      number: m.iid, title: m.title, url: m.web_url, draft: !!(m.draft || m.work_in_progress), body: m.description, closing: [],
    })),
    // t: parseTargetUrl's { host, repo, id }
    requestViewCommand: (t) => cmd(['mr', 'view', String(t.id), '--repo', `https://${t.host}/${t.repo}`, '--output', 'json']),
    // #810: the merge from the app is a merge commit (no --squash / --rebase); GitLab has no merge that ignores
    // the approval rules (admin → null)
    requestMergeCommand: (t, { admin = false, deleteBranch = false } = {}) => (admin ? null
      : cmd(['mr', 'merge', String(t.id), '--repo', `https://${t.host}/${t.repo}`, '--yes', ...(deleteBranch ? ['--remove-source-branch'] : [])])),
    requestCloseCommand: (t) => cmd(['mr', 'close', String(t.id), '--repo', `https://${t.host}/${t.repo}`]),
    runViewCommand: (t) => cmd(['api', `projects/${encodeURIComponent(t.repo)}/pipelines/${t.id}`, '--hostname', t.host]),
    // #812: the open MRs of a project (the MRs screen; open is glab's default)
    pullListCommand: (target, limit) => cmd(['mr', 'list', '--repo', target, '--per-page', String(limit), '--output', 'json']),
    // #812: the list's parsed JSON → [{ number, title, url, author, draft, head, base, state, ci, review, conflicts }], [] when not a list
    parsePulls: (json) => (Array.isArray(json) ? json.filter((m) => m && m.iid != null).map(parsePull) : []),

    // ---- epics (api: { path, hostArgs }, packages/engine/domains/backlog/epics.js apiTarget)
    groupEpicCreateCommand: (api, groupId, title, body) => cmd(['api', ...api.hostArgs, '--method', 'POST', `groups/${groupId}/epics`, '-f', `title=${title}`, '-f', `description=${body}`]),
    projectIssueCommand: (api, n) => cmd(['api', ...api.hostArgs, `projects/${encodeURIComponent(api.path)}/issues/${n}`]),
    groupEpicAddIssueCommand: (api, groupId, iid, id) => cmd(['api', ...api.hostArgs, '--method', 'POST', `groups/${groupId}/epics/${iid}/issues/${id}`]),

    // ---- the Oracle's read tools (packages/engine/domains/oracle/oracle-platform.js)
    searchCommand: ({ target, query, state, limit }) => cmd(['issue', 'list', '--repo', target, ...(query ? ['--search', query] : []), ...(state === 'open' ? [] : [`--${state}`]), '--per-page', String(limit), '--output', 'json']),
    viewCommand: (target, n) => cmd(['issue', 'view', n, '--repo', target, '--output', 'json']),
    labelsCommand: (target, limit) => cmd(['label', 'list', '--repo', target, '--per-page', String(limit), '--output', 'json']),
    // the CI's recent pipelines, read by an analysis seed that declares the need (#360)
    ciRunsCommand: ({ target, limit }) => cmd(['api', `projects/${encodeURIComponent(target)}/pipelines?per_page=${Number(limit) || 20}`]),
    parseCiRuns: (text) => {
      let list;
      try { list = JSON.parse(String(text || '')); } catch { return []; }
      return Array.isArray(list) ? list.map((p) => ({ id: p.id, name: p.ref || null, status: p.status, conclusion: null, createdAt: p.created_at, updatedAt: p.updated_at, url: p.web_url })) : [];
    },

    // ---- the signed-in account's repositories (#669, the wizard's list under the repository field)
    repoListCommand: (limit) => cmd(['repo', 'list', '--per-page', String(limit || 30), '--output', 'json']),
    // → [{ name: 'group/project', private, updatedAt }], [] when the output holds no JSON list
    parseRepos: (text) => {
      const s = String(text || '');
      let list;
      try { list = JSON.parse(s.slice(s.indexOf('['), s.lastIndexOf(']') + 1)); } catch { return []; }
      return Array.isArray(list) ? list.map((r) => ({ name: r.path_with_namespace, private: r.visibility !== 'public', updatedAt: r.last_activity_at || null })).filter((r) => typeof r.name === 'string' && r.name) : [];
    },
    // #632: a new project's private repository (run in its folder; never --public)
    repoCreateCommand: ({ name }) => cmd(['repo', 'create', name, '--private']),

    // ---- the push permission and the owner's fork (#738, the onboarding's Fork + PR)
    // a project is named by its full path (subgroups kept)
    subgroups: true,
    repoInfoCommand: (path) => cmd(['api', `projects/${encodeURIComponent(path)}`]),
    // the access level that may push: Developer (30) or more (parsePush; #811 run-pr.js, a comment's author)
    WRITE_LEVEL: 30,
    // `glab api projects/<path>` → WRITE_LEVEL or more in the project or its group
    // (permissions.project_access / group_access); undefined when the answer has no permissions
    parsePush: (info) => {
      const perms = info?.permissions;
      if (!perms || typeof perms !== 'object') return undefined;
      const levels = [perms.project_access, perms.group_access].map((a) => Number(a?.access_level) || 0);
      return Math.max(...levels) >= gitlab.WRITE_LEVEL;
    },
    // #810: whether the account may merge from the app (unknown: yes, the platform refuses otherwise); never a
    // bypass (requestMergeCommand has no admin form)
    parseMergeRights: (info) => ({ canMerge: gitlab.parsePush(info) !== false, canBypass: false }),
    userCommand: () => cmd(['api', 'user']),
    parseUser: (info) => info?.username,
    // the project info is a fork of the project `name` (its full path)
    isForkOf: (info, name) => info?.forked_from_project?.path_with_namespace === name,
    repoWebUrl: (info) => info?.web_url || null,
    // `glab repo fork` does not print the fork's URL: the caller reads the project again
    forkCommand: (name) => cmd(['repo', 'fork', name, '--clone=false']),
    parseForkUrl: () => null,

    // ---- git's push access (#79, workspace.js pushableUrl / checkPushAccess): the CLI's git protocol for a host;
    // glab has no command that sets git's credential helper (null: the fix says to configure one or use SSH)
    protocolCommand: (host) => cmd(['config', 'get', 'git_protocol', '--host', host]),
    setupGitCommand: () => null,

    // ---- URLs
    // https://host/group/sub/project/-/issues/7 → { host, repo, number }, or null
    parseIssueUrl(url) {
      const m = /^https?:\/\/([^/\s?#]+)\/([^\s?#]+?)\/-\/issues\/(\d+)(?:[/?#].*)?$/.exec(String(url ?? '').trim());
      return m ? { host: m[1], repo: m[2], number: +m[3] } : null;
    },
    // https://host/group/sub/project/-/merge_requests/12, .../-/pipelines/123 → { host, repo, kind: 'pr' | 'run', id }, or null
    parseTargetUrl(url) {
      const m = /^https:\/\/([A-Za-z0-9.-]+(?::\d+)?)\/([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)\/-\/(merge_requests|pipelines)\/(\d+)(?:[/?#].*)?$/.exec(String(url ?? '').trim());
      return m ? { host: m[1], repo: m[2], kind: m[3] === 'merge_requests' ? 'pr' : 'run', id: +m[4] } : null;
    },
    // #797: a merge request's URL from its repository's (https://host/group/repo) and its number
    requestUrl: (repo, number) => `${repo}/-/merge_requests/${number}`,
  };

  if (typeof module === 'object' && module.exports) module.exports = gitlab;
  else root.PlatformGitLab = gitlab;
})(typeof window !== 'undefined' ? window : globalThis);
