// The GitLab platform adapter (#351): what the app knows about GitLab and its `glab` CLI, the twin of
// ./github.js (same members; see its header). Resolve it through the registry (./index.js, by either
// vocabulary: `gitlab` or `gl`). GitLab paths may have subgroups (g/sub/project); a self-hosted
// server is named by URL in --repo and by --hostname in `glab api`. Epics: a group epic when the
// project's issues carry one (paid tiers), otherwise an issue labelled epic whose members carry the
// scoped label epic::<slug> (src/epics.js).
// Browser: window.PlatformGitLab; Node: module.exports.
(function (root) {
  const OWN_HOST = 'gitlab.com';
  const cmd = (args) => ({ cli: 'glab', args });
  // the catalog's helper, at call time (in the browser i18n.js loads after this file)
  const t = (...a) => (typeof module === 'object' && module.exports ? require('../i18n') : root.I18n)?.t(...a) ?? a[0];

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

    // ---- a repository ({ host, path }: src/issues.js parseRepoUrl)
    cliTarget: ({ host, path }) => (host === OWN_HOST ? path : `https://${host}/${path}`),
    apiHostArgs: ({ host }) => (host === OWN_HOST ? [] : ['--hostname', host]),
    issuesUrl: ({ host, path }) => `https://${host}/${path}/-/issues/`,
    issueUrl: (base, number) => `${base}/-/issues/${number}`,
    // a file of the default branch (#486): the repository files API (raw text), else a public raw read
    fileCommand: ({ host, path }, file) => cmd(['api', ...gitlab.apiHostArgs({ host }), `projects/${encodeURIComponent(path)}/repository/files/${encodeURIComponent(file)}/raw?ref=HEAD`]),
    rawFileUrl: ({ host, path }, file) => `https://${host}/${path}/-/raw/HEAD/${file}`,

    // ---- issues
    issueListCommand: (target) => cmd(['issue', 'list', '--repo', target, '--all', '--per-page', '100', '--output', 'json']),
    issueViewCommand: (target, n) => cmd(['issue', 'view', n, '--repo', target, '--output', 'json']),
    issueCreateCommand: ({ target, title, labels, text }) => cmd(['issue', 'create', '--repo', target, '--title', title, '--description', text, ...(labels.length ? ['--label', labels.join(',')] : []), '--yes']),
    issueSaveCommand: ({ target, n, mode, text }) => cmd(mode === 'replace' ? ['issue', 'update', n, '--repo', target, '--description', text] : ['issue', 'note', n, '--repo', target, '--message', text]),
    issueCloseCommand: (target, n) => cmd(['issue', 'close', n, '--repo', target]),
    issueReopenCommand: (target, n) => cmd(['issue', 'reopen', n, '--repo', target]),
    // a scoped label (epic::x) replaces the issue's other label of the same scope
    issueLabelCommand: ({ target, n, label, add }) => cmd(['issue', 'update', n, '--repo', target, add ? '--label' : '--unlabel', label]),
    // `glab issue list|view --output json` → the app's issue (src/issues.js adds `tasks`)
    parseIssue: (i) => ({
      number: i.iid,
      title: i.title,
      state: i.state === 'opened' ? 'open' : 'closed',
      labels: (i.labels || []).map((name) => ({ name: typeof name === 'string' ? name : name.name, color: name.color || null })),
      url: i.web_url,
      author: i.author?.username || null,
      assignees: (i.assignees || []).map((a) => a.username),
      body: i.description || '',
      createdAt: i.created_at,
      updatedAt: i.updated_at,
      // a group epic (GitLab paid tiers): read by src/epics.js, not kept in the cache
      ...(i.epic?.iid ? { groupEpic: { iid: i.epic.iid, title: i.epic.title || null, groupId: i.epic.group_id ?? null, url: i.epic.web_url || i.epic.url || null } } : {}),
    }),

    // ---- labels: GitLab creates a missing label itself, so none is read or created first
    labelListCommand: () => null,
    labelCreateCommand: () => null,
    parseLabelNames: (out) => JSON.parse(out || '[]').map((l) => l.name),

    // ---- merge requests
    requestListCommand: (target) => cmd(['mr', 'list', '--repo', target, '--per-page', '100', '--output', 'json']),
    olderCli: () => false,
    // → { number, title, url, draft, body, closing: issue numbers }
    parseRequests: (out) => JSON.parse(out || '[]').map((m) => ({
      number: m.iid, title: m.title, url: m.web_url, draft: !!(m.draft || m.work_in_progress), body: m.description, closing: [],
    })),
    // t: parseTargetUrl's { host, repo, id }
    requestViewCommand: (t) => cmd(['mr', 'view', String(t.id), '--repo', `https://${t.host}/${t.repo}`, '--output', 'json']),
    runViewCommand: (t) => cmd(['api', `projects/${encodeURIComponent(t.repo)}/pipelines/${t.id}`, '--hostname', t.host]),

    // ---- epics (api: { path, hostArgs }, src/epics.js apiTarget)
    groupEpicCreateCommand: (api, groupId, title, body) => cmd(['api', ...api.hostArgs, '--method', 'POST', `groups/${groupId}/epics`, '-f', `title=${title}`, '-f', `description=${body}`]),
    projectIssueCommand: (api, n) => cmd(['api', ...api.hostArgs, `projects/${encodeURIComponent(api.path)}/issues/${n}`]),
    groupEpicAddIssueCommand: (api, groupId, iid, id) => cmd(['api', ...api.hostArgs, '--method', 'POST', `groups/${groupId}/epics/${iid}/issues/${id}`]),

    // ---- the Oracle's read tools (src/oracle-platform.js)
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
  };

  if (typeof module === 'object' && module.exports) module.exports = gitlab;
  else root.PlatformGitLab = gitlab;
})(typeof window !== 'undefined' ? window : globalThis);
