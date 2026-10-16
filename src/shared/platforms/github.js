// The GitHub platform adapter (#351): what the app knows about GitHub and its `gh` CLI, so the rest
// of src/ never branches on the platform. Resolve it through the registry (./index.js, by either
// vocabulary: `github` or `gh`); the GitLab twin (./gitlab.js) has the same members.
// - identity: id, short (workflow input `git_platform`, skill suffix `-gh`), cli, label, host;
// - request: the terms of a pull request ("PR #12"); epics, readsLabels, closeReason, actionsQuota:
//   what the platform offers (epics are issues whose sub-issues are their members, src/epics.js);
// - cliTarget / apiHostArgs / issuesUrl / issueUrl: a repository ({ host, path }) as the CLI and links want it;
// - *Command: the { cli, args } of each operation (issues, labels, pull requests, epics, the Oracle, probes);
// - parse*: the CLI's JSON → the app's objects;
// - parseIssueUrl / parseTargetUrl: issue, pull request and Actions run URLs.
// Browser: window.PlatformGitHub; Node: module.exports.
(function (root) {
  const OWN_HOST = 'github.com';
  const ISSUE_FIELDS = 'number,title,state,labels,url,author,assignees,body,createdAt,updatedAt';
  const REQUEST_FIELDS = 'number,title,url,isDraft,body';
  const CLOSING_FIELD = 'closingIssuesReferences';
  const TYPED_EPICS = '.[] | select(((.type.name // "") | ascii_downcase) == "epic") | .number';
  const cmd = (args) => ({ cli: 'gh', args });
  // the catalog's helper, at call time (in the browser i18n.js loads after this file)
  const t = (...a) => (typeof module === 'object' && module.exports ? require('../i18n') : root.I18n)?.t(...a) ?? a[0];

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
    // GitHub Actions minutes can run out (src/engine/probes.js withQuota)
    actionsQuota: true,

    // ---- a repository ({ host, path }: src/issues.js parseRepoUrl)
    cliTarget: ({ host, path }) => (host === OWN_HOST ? path : `${host}/${path}`),
    apiHostArgs: ({ host }) => (host === OWN_HOST ? [] : ['--hostname', host]),
    issuesUrl: ({ host, path }) => `https://${host}/${path}/issues/`,
    issueUrl: (base, number) => `${base}/issues/${number}`,

    // ---- issues
    issueListCommand: (target, limit) => cmd(['issue', 'list', '--repo', target, '--state', 'all', '--limit', String(limit), '--json', ISSUE_FIELDS]),
    issueViewCommand: (target, n) => cmd(['issue', 'view', n, '--repo', target, '--json', ISSUE_FIELDS]),
    issueCreateCommand: ({ target, title, labels, file }) => cmd(['issue', 'create', '--repo', target, '--title', title, '--body-file', file, ...labels.flatMap((l) => ['--label', l])]),
    issueSaveCommand: ({ target, n, mode, file }) => cmd(['issue', mode === 'replace' ? 'edit' : 'comment', n, '--repo', target, '--body-file', file]),
    issueCloseCommand: (target, n) => cmd(['issue', 'close', n, '--repo', target, '--reason', github.closeReason]),
    issueReopenCommand: (target, n) => cmd(['issue', 'reopen', n, '--repo', target]),
    issueLabelCommand: ({ target, n, label, add }) => cmd(['issue', 'edit', n, '--repo', target, add ? '--add-label' : '--remove-label', label]),
    // `gh issue list|view --json` → the app's issue (src/issues.js adds `tasks`)
    parseIssue: (i) => ({
      number: i.number,
      title: i.title,
      state: String(i.state).toLowerCase() === 'open' ? 'open' : 'closed',
      labels: (i.labels || []).map((l) => ({ name: l.name, color: l.color ? `#${l.color}` : null })),
      url: i.url,
      author: i.author?.login || null,
      assignees: (i.assignees || []).map((a) => a.login),
      body: i.body || '',
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    }),

    // ---- labels
    labelListCommand: (target) => cmd(['label', 'list', '--repo', target, '--limit', '500', '--json', 'name']),
    labelCreateCommand: ({ target, name, color, description, force }) => cmd(['label', 'create', name, '--repo', target, '--color', color, '--description', description, ...(force ? ['--force'] : [])]),
    parseLabelNames: (out) => JSON.parse(out || '[]').map((l) => l.name),

    // ---- pull requests
    // closing: false for gh versions that do not know closingIssuesReferences (see olderCli)
    requestListCommand: (target, limit, { closing = true } = {}) => cmd(['pr', 'list', '--repo', target, '--state', 'open', '--limit', String(limit), '--json', closing ? `${REQUEST_FIELDS},${CLOSING_FIELD}` : REQUEST_FIELDS]),
    olderCli: (message) => new RegExp(CLOSING_FIELD).test(String(message || '')),
    // → { number, title, url, draft, body, closing: issue numbers }
    parseRequests: (out) => JSON.parse(out || '[]').map((p) => ({
      number: p.number, title: p.title, url: p.url, draft: !!p.isDraft, body: p.body, closing: (p[CLOSING_FIELD] || []).map((i) => i.number),
    })),
    // t: parseTargetUrl's { host, repo, id }; fields: gh's --json list
    requestViewCommand: (t, fields) => cmd(['pr', 'view', String(t.id), '--repo', `${t.host}/${t.repo}`, '--json', fields]),
    runViewCommand: (t) => cmd(['run', 'view', String(t.id), '--repo', `${t.host}/${t.repo}`, '--json', 'status,conclusion,url,name']),

    // ---- epics (api: { path, hostArgs }, src/epics.js apiTarget)
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

    // ---- the Oracle's read tools (src/oracle-platform.js)
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
  };

  if (typeof module === 'object' && module.exports) module.exports = github;
  else root.PlatformGitHub = github;
})(typeof window !== 'undefined' ? window : globalThis);
