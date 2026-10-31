// Build-time data for the public page (scripts/site.js): what GitHub and git know that the markdown does
// not. Written next to the items as docs/work/github.json and docs/work/activity.json; the page shows them
// when they are there and does without them otherwise (a local build with no token, a fork).
// A private repository's page is public: only the issues the items name in `issue:` and the open ones
// carrying the backlog label (docs/work/README.md `backlog_label:`, default "roadmap") are published,
// with the pull requests that name them, never the rest of the backlog.
//
//   frontMatterValue(text, key)    a front-matter value, comment and quotes removed, or ''
//   issueRefs(root)                the issue numbers the items name (intent.md or milestone.md `issue:`), sorted
//   weekly(dates, today, weeks)    commits per week, oldest first: [{ start: 'YYYY-MM-DD', commits }]
//   gitActivity(root, today)       { weeks, commits30, merges30, last } from git log, or null outside a repository
//   linkPrs(numbers, prs)          { [issue]: [pull requests naming "#issue" in their title or body] }
//   fetchGithub(o)                 { repo, private, issues, backlog } from the REST API, or null without a token

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DAY = 864e5;

function frontMatterValue(text, key) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
  const line = fm && fm[1].split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
  return line ? line.slice(key.length + 1).replace(/\s+#\s.*$/, '').trim().replace(/^(["'])(.*)\1$/, '$2') : '';
}

function issueRefs(root) {
  const dir = path.join(root, 'docs', 'work');
  if (!fs.existsSync(dir)) return [];
  const out = new Set();
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    for (const f of ['intent.md', 'milestone.md']) {
      const file = path.join(dir, e.name, f);
      if (!fs.existsSync(file)) continue;
      for (const m of frontMatterValue(fs.readFileSync(file, 'utf8'), 'issue').matchAll(/#(\d+)/g)) out.add(Number(m[1]));
    }
  }
  return [...out].sort((a, b) => a - b);
}

const isoDay = (t) => new Date(t).toISOString().slice(0, 10);

// weeks end on `today` (UTC days): the last week is the 7 days up to today
function weekly(dates, today, weeks = 8) {
  const end = Date.parse(isoDay(today)) + DAY;
  const out = Array.from({ length: weeks }, (_, i) => ({ start: isoDay(end - (weeks - i) * 7 * DAY), commits: 0 }));
  for (const d of dates) {
    const t = Date.parse(d);
    if (Number.isNaN(t) || t >= end) continue;
    const i = weeks - 1 - Math.floor((end - 1 - t) / (7 * DAY));
    if (i >= 0) out[i].commits += 1;
  }
  return out;
}

function gitActivity(root, today = Date.now()) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const since = isoDay(today - 56 * DAY);
    const dates = git(['log', `--since=${since}`, '--format=%cs']).split('\n').filter(Boolean);
    const month = isoDay(today - 30 * DAY);
    const merges = git(['log', '--first-parent', '--merges', `--since=${month}`, '--format=%s']).split('\n').filter((s) => /^Merge pull request #\d+/.test(s));
    const last = git(['log', '-1', '--format=%cs']).trim();
    return { weeks: weekly(dates, today), commits30: dates.filter((d) => d >= month).length, merges30: merges.length, last };
  } catch {
    return null;
  }
}

function linkPrs(numbers, prs) {
  const out = {};
  for (const n of numbers) {
    const re = new RegExp(`#${n}(?!\\d)`);
    out[n] = prs.filter((p) => re.test(`${p.title || ''}\n${p.body || ''}`))
      .map((p) => ({ number: p.number, title: p.title, state: p.merged_at ? 'merged' : p.state, url: p.html_url, updated: p.updated_at }));
  }
  return out;
}

async function fetchGithub({ repo, token, numbers, label = 'roadmap', fetchImpl = globalThis.fetch }) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo || '')) return null;
  const get = async (url) => {
    const r = await fetchImpl(`https://api.github.com/repos/${repo}${url}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!r.ok) throw new Error(`GitHub ${url}: ${r.status}`);
    return r.json();
  };
  const issue = (i) => ({ number: i.number, title: i.title, state: i.state, url: i.html_url, labels: (i.labels || []).map((l) => l.name), updated: i.updated_at, closed: i.closed_at });
  const meta = await get('');
  const named = await Promise.all(numbers.map((n) => get(`/issues/${n}`).catch(() => null)));
  const labelled = (await get(`/issues?state=open&labels=${encodeURIComponent(label)}&per_page=50`)).filter((i) => !i.pull_request);
  const prs = await get('/pulls?state=all&sort=updated&direction=desc&per_page=100');
  const issues = {};
  const links = linkPrs(numbers, prs);
  for (const i of named.filter(Boolean)) issues[i.number] = { ...issue(i), prs: links[i.number] || [] };
  return {
    repo,
    private: Boolean(meta.private),
    generated: new Date().toISOString(),
    issues,
    backlog: labelled.filter((i) => !issues[i.number]).map(issue),
  };
}

module.exports = {
  fetchGithub,
  frontMatterValue,
  gitActivity,
  issueRefs,
  linkPrs,
  weekly,
};
