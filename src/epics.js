// Epics (#138): the level above the issue in a project's backlog.
// GitHub: an issue labelled `epic` or whose issue type is "Epic" (`typedEpics`, organizations with
// issue types), whose members are its sub-issues (`gh api .../sub_issues`).
// GitLab: a group epic when the project's issues carry one (`epic` in glab's JSON, paid tiers),
// otherwise an issue labelled `epic` whose members carry the scoped label `epic::<slug>` (the epic
// issue carries it too, or its slug is its title's).
// `readEpics` runs on every backlog sync (src/backlog.js syncBacklog): each issue gets `epic` (the
// epic's id: `#12` for an issue epic, `&5` for a GitLab group epic) and the cache gets `epics`
// ({ id, number, iid?, groupId?, kind: issue | label | group, slug?, title, url, state, members,
// progress: { open, closed, total } }). A failed read leaves `epicsError`, not a failed sync.
// `applyEpic` creates an epic and/or moves issues into it; it writes to the platform, so it runs
// only on the owner's click (the Product Owner's proposals, src/product-owner.js applyEpicProposal)
// or, for a new issue the PO registers or the issue tracker files (`filedToEpic`), when the project's
// `autoEpic` option is on. A preview never
// calls the CLI: it returns the commands it would run.

const fs = require('fs');
const path = require('path');
const backlog = require('./backlog');

const EPIC_LABEL = 'epic';
const SCOPE = 'epic::';
const MAX_EPICS = 60;
const EPIC_COLOR = '5319E7';

const names = (issue) => (issue?.labels || []).map((l) => String(typeof l === 'string' ? l : l?.name || '').trim());
const isEpicIssue = (issue) => names(issue).some((n) => n.toLowerCase() === EPIC_LABEL);
const scopedSlug = (issue) => names(issue).find((n) => n.toLowerCase().startsWith(SCOPE))?.slice(SCOPE.length).trim().toLowerCase() || null;

/** A label-friendly slug of an epic's title: "Run safety and recovery" → run-safety-and-recovery. */
function slugify(title) {
  return String(title || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'epic';
}

// gh api / glab api need the path without the host, and the host apart for a self-hosted server.
function apiTarget(platform, repo) {
  const parsed = backlog.parseRepoUrl(repo);
  if (!parsed) throw new Error(`The project's repository is not a recognizable git URL: ${repo || '(none)'}`);
  const own = platform === 'github' ? 'github.com' : 'gitlab.com';
  return { path: parsed.path, host: parsed.host, hostArgs: parsed.host === own ? [] : ['--hostname', parsed.host] };
}

/**
 * The issues (open and closed, like the sync) whose GitHub issue type is "Epic" (organizations with
 * issue types): `gh issue list` cannot return the type, the REST issues list does (`type.name`). A
 * repository without issue types (or a failed read) gives none: the `epic` label still works.
 */
async function typedEpics({ platform, repo, exec = backlog.execCli }) {
  try {
    const t = apiTarget(platform, repo);
    const out = await exec('gh', ['api', ...t.hostArgs, '--paginate', `repos/${t.path}/issues?state=all&per_page=100`, '--jq', '.[] | select(((.type.name // "") | ascii_downcase) == "epic") | .number']);
    return new Set(String(out || '').split(/\s+/).filter((s) => /^\d+$/.test(s)).map(Number));
  } catch {
    return new Set();
  }
}

/** The member numbers of a GitHub epic: its sub-issues of the same repository. */
async function subIssues({ platform, repo, number, exec = backlog.execCli }) {
  const t = apiTarget(platform, repo);
  const out = await exec('gh', ['api', ...t.hostArgs, `repos/${t.path}/issues/${Number(number)}/sub_issues?per_page=100`]);
  const own = `/repos/${t.path}`.toLowerCase();
  return JSON.parse(out || '[]')
    .filter((x) => !x.repository_url || String(x.repository_url).toLowerCase().endsWith(own))
    .map((x) => Number(x.number)).filter(Boolean);
}

const progressOf = (members, byNumber) => {
  const states = members.map((n) => byNumber.get(n)?.state).filter(Boolean);
  return { open: states.filter((s) => s === 'open').length, closed: states.filter((s) => s !== 'open').length, total: members.length };
};

/**
 * Reads the epics of a synced repository: { issues (each member with `epic`), epics, epicsError }.
 * `issues` come from backlog.fetchIssues (GitLab group epics from their `groupEpic`).
 */
async function readEpics({ platform, repo, issues, exec = backlog.execCli }) {
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  const epics = [];
  let epicsError = null;
  const typed = platform === 'github' && issues.length ? await typedEpics({ platform, repo, exec }) : new Set();
  const isEpic = (i) => isEpicIssue(i) || typed.has(i.number);
  if (platform === 'github') {
    const found = issues.filter(isEpic).slice(0, MAX_EPICS);
    for (const e of found) {
      let members = [];
      try {
        members = await subIssues({ platform, repo, number: e.number, exec });
      } catch (err) {
        epicsError = `Sub-issues could not be read: ${err.message}`;
        break;
      }
      epics.push({ id: `#${e.number}`, number: e.number, kind: 'issue', title: e.title, url: e.url, state: e.state, members: members.filter((n) => n !== e.number) });
    }
    // an epic whose read failed still lists, with no members
    for (const e of found.slice(epics.length)) epics.push({ id: `#${e.number}`, number: e.number, kind: 'issue', title: e.title, url: e.url, state: e.state, members: [] });
  } else if (platform === 'gitlab') {
    const groups = new Map();
    for (const i of issues) {
      const g = i.groupEpic;
      if (!g?.iid) continue;
      const id = `&${g.iid}`;
      if (!groups.has(id)) groups.set(id, { id, number: null, iid: g.iid, groupId: g.groupId ?? null, kind: 'group', title: g.title || id, url: g.url || null, state: 'open', members: [] });
      groups.get(id).members.push(i.number);
    }
    epics.push(...groups.values());
    for (const e of issues.filter(isEpicIssue).slice(0, MAX_EPICS)) {
      const slug = scopedSlug(e) || slugify(e.title);
      const members = issues.filter((i) => i.number !== e.number && !isEpicIssue(i) && scopedSlug(i) === slug).map((i) => i.number);
      epics.push({ id: `#${e.number}`, number: e.number, kind: 'label', slug, title: e.title, url: e.url, state: e.state, members });
    }
  }
  const memberOf = new Map();
  for (const e of epics) {
    e.progress = progressOf(e.members, byNumber);
    for (const n of e.members) if (!memberOf.has(n)) memberOf.set(n, e.id);
  }
  const out = issues.map((i) => {
    const next = { ...i };
    delete next.groupEpic;
    if (memberOf.has(i.number)) next.epic = memberOf.get(i.number);
    if (isEpic(i)) next.isEpic = true;
    return next;
  });
  return { issues: out, epics, epicsError };
}

// The command as shown in a preview (long texts replaced).
const display = (cli, args, text) => `${cli} ${args.map((a) => (text && a === text ? '<document>' : /\s/.test(a) ? `"${a}"` : a)).join(' ')}`;

/**
 * Creates an epic and/or places issues in it, on the owner's click.
 * epic: { id } of an existing epic (from `epics`), or { title, goal } for a new one.
 * issues: the member numbers to move into it (an issue in another epic moves).
 * dir: where the text sent is kept (gh reads the new epic's body from a file there).
 * Returns { preview, commands: string[], epic: { id, number, title, url }, linked: number[] }.
 */
async function applyEpic({ platform, repo, epic, issues = [], epics = [], dir, preview = false, exec = backlog.execCli }) {
  if (!backlog.PLATFORMS[platform]?.cli) throw new Error('Epics need GitHub or GitLab.');
  const members = [...new Set((issues || []).map(Number).filter(Boolean))];
  const existing = epic?.id ? epics.find((e) => e.id === epic.id) : null;
  if (epic?.id && !existing) throw new Error(`Unknown epic ${epic.id}: sync the backlog again.`);
  const title = String(existing?.title || epic?.title || '').trim();
  if (!title) throw new Error('The epic has no title.');
  const commands = [];
  const run = async (cli, args, text) => {
    commands.push(display(cli, args, text));
    return preview ? '' : String(await exec(cli, args) || '');
  };
  const t = apiTarget(platform, repo);
  const target = backlog.cliTarget(platform, repo);
  // GitLab group epics when the project already has some: a new epic goes to the same group
  const groupId = platform === 'gitlab' ? epics.find((e) => e.kind === 'group' && e.groupId)?.groupId : null;
  let made = existing ? { id: existing.id, number: existing.number, title, url: existing.url, kind: existing.kind, slug: existing.slug, iid: existing.iid, groupId: existing.groupId } : null;
  if (!made) {
    const goal = String(epic?.goal || '').trim();
    const body = `${goal ? `${goal}\n\n` : ''}${platform === 'github' ? 'The members of this epic are its sub-issues.' : 'Filed by the Product Owner (#138).'}\n`;
    if (platform === 'gitlab' && groupId) {
      const out = await run('glab', ['api', ...t.hostArgs, '--method', 'POST', `groups/${groupId}/epics`, '-f', `title=${title}`, '-f', `description=${body}`], `description=${body}`);
      const json = preview ? {} : JSON.parse(out || '{}');
      made = { id: `&${json.iid ?? '?'}`, number: null, iid: json.iid ?? null, groupId, kind: 'group', title, url: json.web_url || null };
    } else {
      const slug = slugify(title);
      const labels = platform === 'github' ? [EPIC_LABEL] : [EPIC_LABEL, `${SCOPE}${slug}`];
      if (platform === 'github') {
        const known = preview ? [] : await backlog.repoLabels({ platform, repo, exec });
        if (!known.some((n) => n.toLowerCase() === EPIC_LABEL)) {
          await run('gh', ['label', 'create', EPIC_LABEL, '--repo', target, '--color', EPIC_COLOR, '--description', 'An epic: its sub-issues are its members', '--force']);
        }
      }
      const file = path.join(dir || '.', `${new Date().toISOString().replace(/[:.]/g, '-')}-epic-${slug}.md`);
      if (!preview && dir) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, body); }
      const cmd = backlog.issueCreateCommand({ platform, repo, title, labels, file, text: body });
      const out = await run(cmd.cli, cmd.args, body);
      const url = out.match(/https?:\/\/\S+/)?.[0] || null;
      const n = Number(url?.match(/\/(\d+)\/?$/)?.[1]) || null;
      made = { id: n ? `#${n}` : '#?', number: n, kind: platform === 'github' ? 'issue' : 'label', slug, title, url };
    }
  }
  const linked = [];
  for (const n of members) {
    if (made.number && n === made.number) continue;
    if (platform === 'github') {
      const id = (await run('gh', ['api', ...t.hostArgs, `repos/${t.path}/issues/${n}`, '--jq', '.id'])).trim() || `<id of #${n}>`;
      await run('gh', ['api', ...t.hostArgs, '--method', 'POST', `repos/${t.path}/issues/${made.number || '<epic>'}/sub_issues`, '-F', `sub_issue_id=${id}`, '-F', 'replace_parent=true']);
    } else if (made.kind === 'group') {
      const project = encodeURIComponent(t.path);
      const raw = await run('glab', ['api', ...t.hostArgs, `projects/${project}/issues/${n}`]);
      const id = preview ? `<id of #${n}>` : JSON.parse(raw || '{}').id;
      await run('glab', ['api', ...t.hostArgs, '--method', 'POST', `groups/${made.groupId}/epics/${made.iid}/issues/${id}`]);
    } else {
      // a scoped label replaces the issue's other epic::* label
      await run('glab', ['issue', 'update', String(n), '--repo', target, '--label', `${SCOPE}${made.slug}`]);
    }
    linked.push(n);
  }
  return { preview: !!preview, commands, epic: { id: made.id, number: made.number, title, url: made.url, kind: made.kind }, linked };
}

/**
 * The epic an issue-tracker run (#81) places its created issues in when it ends: the analyzer's
 * `epic` with a `clear` match, after the owner chose create or create_assign at the review gate.
 * Only an existing epic: the issue tracker never creates one. Null otherwise. The service applies it
 * only when the project's autoEpic option is on and the epic is in the synced cache.
 * @returns {{ epic: string, numbers: number[] } | null}
 */
function filedToEpic({ workflow, status, steps } = {}) {
  if (workflow !== 'issue-tracker' || status !== 'success') return null;
  if (!['create', 'create_assign'].includes(steps?.review?.output?.choice)) return null;
  const epic = steps.analyze?.output?.epic;
  const id = String(epic?.id || '').trim();
  if (epic?.match !== 'clear' || !/^[#&]\d+$/.test(id)) return null;
  const numbers = [...new Set((steps.file?.output?.filed || []).filter((f) => f?.action === 'created' && Number.isInteger(f.number) && f.number > 0).map((f) => f.number))];
  return numbers.length ? { epic: id, numbers } : null;
}

module.exports = {
  applyEpic,
  EPIC_LABEL,
  filedToEpic,
  isEpicIssue,
  readEpics,
  slugify,
  subIssues,
  typedEpics,
};
