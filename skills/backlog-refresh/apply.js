#!/usr/bin/env node
// Applies a backlog-refresh answer (refresh.json, saved by the workflow's review step) to the
// repository's issues with gh (GitHub) or glab (GitLab). No model: it only does what the answer
// says, literally.
//
//   node apply.js --platform gh|gl --mode safe  --file <run_dir>/refresh.json --project <repo path> [--run-id <id>]
//   node apply.js --platform gh|gl --mode scope --file <run_dir>/refresh.json --project <repo path> [--run-id <id>]
//
// safe:  per issue, the `edits` ({ find, replace }, each `find` must appear exactly once in the
//        current body) and the refresh `note` (appended after a <!-- backlog-refresh --> marker,
//        replacing an older note), plus the `complexity:<n>` label. An issue edited on the platform
//        after the review (`updatedAt` differs), closed, or with a `find` missing or repeated is
//        skipped whole and reported. GitHub and GitLab keep every earlier version of the body.
// scope: closes the `close_done` / `close_obsolete` / `close_duplicate` proposals with a comment;
//        `rewrite` proposals are only reported. Run only after the owner's Apply at the scope gate.
// The repository comes from the project's `origin` remote, never from the answer. Writes
// applied-<mode>.json next to the answer, prints a summary, and exits 1 only when a CLI call failed.
// BACKLOG_REFRESH_FAKE_CLI=<script.js>: tests run a fake gh/glab (node <script> <cmd> <args>).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MARKER = '<!-- backlog-refresh -->';
const GH_FALLBACK = 'C:\\Program Files\\GitHub CLI\\gh.exe';

/** cli(cmd, args) runs gh/glab and returns its stdout; a fake script when BACKLOG_REFRESH_FAKE_CLI is set. */
function defaultCli(cmd, args) {
  const fake = process.env.BACKLOG_REFRESH_FAKE_CLI;
  if (fake) return execFileSync(process.execPath, [fake, cmd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let bin = cmd;
  if (cmd === 'gh') {
    try { execFileSync('gh', ['--version'], { stdio: 'ignore' }); } catch { if (fs.existsSync(GH_FALLBACK)) bin = GH_FALLBACK; }
  }
  return execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** { host, project } from a git remote URL (https or ssh); GitHub needs owner/name. Throws otherwise. */
function parseRemote(platform, remote) {
  const s = String(remote || '').trim();
  const m = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/i.exec(s);
  if (!m) throw new Error(`not a git remote URL: ${s}`);
  const [, host, project] = m;
  if (platform === 'gh' && (!/github\.com$/i.test(host) || !/^[\w.-]+\/[\w.-]+$/.test(project))) {
    throw new Error(`not a GitHub remote: ${s}`);
  }
  return { host, project };
}

const norm = (s) => String(s ?? '').replace(/\r\n/g, '\n');
const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);

/** The issue operations of one platform, on top of cli(cmd, args). */
function platformApi(platform, target, cli) {
  if (platform === 'gl') {
    const repo = `https://${target.host}/${target.project}`;
    return {
      view(n) {
        const j = JSON.parse(cli('glab', ['issue', 'view', String(n), '--repo', repo, '--output', 'json']));
        return {
          body: j.description || '',
          updatedAt: j.updated_at || '',
          open: j.state === 'opened',
          labels: (j.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
        };
      },
      setBody(n, body) { cli('glab', ['issue', 'update', String(n), '--repo', repo, '--description', body]); },
      setLabels(n, add, remove) {
        const args = ['issue', 'update', String(n), '--repo', repo, '--label', add];
        if (remove.length) args.push('--unlabel', remove.join(','));
        cli('glab', args);
      },
      close(n, comment) {
        cli('glab', ['issue', 'note', String(n), '--repo', repo, '--message', comment]);
        cli('glab', ['issue', 'close', String(n), '--repo', repo]);
      },
    };
  }
  const repo = target.project;
  return {
    view(n) {
      const j = JSON.parse(cli('gh', ['issue', 'view', String(n), '--repo', repo, '--json', 'body,updatedAt,state,labels']));
      return { body: j.body || '', updatedAt: j.updatedAt || '', open: j.state === 'OPEN', labels: (j.labels || []).map((l) => l.name) };
    },
    setBody(n, body, file) { cli('gh', ['issue', 'edit', String(n), '--repo', repo, '--body-file', file]); },
    setLabels(n, add, remove) {
      const args = ['issue', 'edit', String(n), '--repo', repo, '--add-label', add];
      for (const o of remove) args.push('--remove-label', o);
      cli('gh', args);
    },
    close(n, comment, done) {
      cli('gh', ['issue', 'close', String(n), '--repo', repo, '--reason', done ? 'completed' : 'not planned', '--comment', comment]);
    },
  };
}

/** The body with the edits applied and the refresh note after the marker; { skip } when an edit does not match exactly once. */
function refreshBody(current, edits, note, stamp) {
  let body = norm(current);
  for (const e of edits) {
    const find = norm(e.find);
    const c = count(body, find);
    if (c !== 1) return { skip: `a find appears ${c} times: ${JSON.stringify(find.slice(0, 80))}` };
    body = body.replace(find, () => norm(e.replace));
  }
  if (note) {
    const at = body.indexOf(MARKER);
    if (at >= 0) body = body.slice(0, at).replace(/\s+$/, '');
    body += `\n\n${MARKER}\n> **Backlog refresh** (${stamp}): ${String(note).trim()}\n`;
  }
  return { body };
}

/**
 * Applies refresh.json (mode safe or scope) and returns { repo, mode, results }; writes
 * applied-<mode>.json next to the file. cli(cmd, args) is injectable for tests.
 */
function apply({ platform, mode, file, project, runId = '', cli = defaultCli, today = new Date().toISOString().slice(0, 10) }) {
  if (!['gh', 'gl'].includes(platform)) throw new Error('--platform takes gh or gl');
  if (!['safe', 'scope'].includes(mode)) throw new Error('--mode takes safe or scope');
  const remote = execFileSync('git', ['-C', project, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const target = parseRemote(platform, remote);
  const answer = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (answer.repo && !target.project.toLowerCase().endsWith(String(answer.repo).toLowerCase().replace(/^https?:\/\/[^/]+\//, ''))) {
    throw new Error(`The answer is about ${answer.repo}, the project's remote is ${target.project}: nothing applied.`);
  }
  const api = platformApi(platform, target, cli);
  const runDir = path.dirname(path.resolve(file));
  const stamp = `${today}${runId ? `, run ${runId}` : ''}`;
  const results = [];

  function applySafe(item) {
    const n = item.number;
    const edits = Array.isArray(item.edits) ? item.edits : [];
    const complexity = Number(item.complexity) || 0;
    // a note alone (a `current` issue) changes nothing
    if (!edits.length && !complexity) return;
    const cur = api.view(n);
    if (!cur.open) return results.push({ number: n, result: 'skipped', reason: 'not open any more' });
    if (item.updated_at && cur.updatedAt !== item.updated_at) {
      return results.push({ number: n, result: 'skipped', reason: `edited after the review (${cur.updatedAt})` });
    }
    const r = refreshBody(cur.body, edits, item.note, stamp);
    if (r.skip) return results.push({ number: n, result: 'skipped', reason: r.skip });
    const changed = [];
    if (r.body !== norm(cur.body)) {
      const out = path.join(runDir, 'bodies', `${n}.md`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, r.body);
      api.setBody(n, r.body, out);
      changed.push(`body (${edits.length} edit${edits.length === 1 ? '' : 's'})`);
    }
    if (complexity >= 1 && complexity <= 5) {
      const old = cur.labels.filter((l) => /^complexity:\d$/.test(l));
      const want = `complexity:${complexity}`;
      if (!(old.length === 1 && old[0] === want)) {
        api.setLabels(n, want, old.filter((o) => o !== want));
        changed.push(`${old.join(',') || 'no complexity'} -> ${want}`);
      }
    }
    results.push({ number: n, result: changed.length ? 'updated' : 'unchanged', changes: changed });
  }

  function applyScope(p) {
    const n = p.number;
    if (p.action === 'rewrite') return results.push({ number: n, result: 'reported', reason: p.reason });
    if (!['close_done', 'close_obsolete', 'close_duplicate'].includes(p.action)) {
      return results.push({ number: n, result: 'skipped', reason: `unknown action ${p.action}` });
    }
    const cur = api.view(n);
    if (!cur.open) return results.push({ number: n, result: 'skipped', reason: 'not open any more' });
    const why = String(p.reason || '').trim();
    const comment = p.action === 'close_duplicate'
      ? `Duplicate of #${p.duplicate_of}. ${why}`
      : `${p.action === 'close_done' ? 'Done on the base branch' : 'Obsolete'}: ${why}`;
    api.close(n, `${comment}\n\n(Backlog refresh ${stamp}, approved by the owner.)`, p.action === 'close_done');
    results.push({ number: n, result: 'closed', reason: comment });
  }

  const list = mode === 'safe' ? (answer.issues || []) : (answer.scope || []);
  for (const item of list) {
    try { mode === 'safe' ? applySafe(item) : applyScope(item); } catch (e) {
      results.push({ number: item.number, result: 'failed', reason: String(e.stderr || e.message).trim().slice(0, 300) });
    }
  }
  const repo = target.project;
  fs.writeFileSync(path.join(runDir, `applied-${mode}.json`), JSON.stringify({ repo, platform, mode, at: new Date().toISOString(), results }, null, 2));
  return { repo, mode, results };
}

function parseArgs(argv) {
  const a = {};
  const keys = { '--platform': 'platform', '--mode': 'mode', '--file': 'file', '--project': 'project', '--run-id': 'runId' };
  for (let i = 0; i < argv.length; i++) {
    const k = keys[argv[i]];
    if (!k) throw new Error(`Unknown argument: ${argv[i]}`);
    const v = argv[++i];
    if (v === undefined) throw new Error(`${argv[i - 1]} needs a value`);
    a[k] = v;
  }
  for (const k of ['platform', 'mode', 'file', 'project']) if (!a[k]) throw new Error(`missing --${k}`);
  return a;
}

if (require.main === module) {
  let r;
  try {
    r = apply(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error(`apply: ${(e.stderr || e.message || String(e)).toString().trim()}`);
    process.exit(2);
  }
  const by = (k) => r.results.filter((x) => x.result === k);
  console.log(`${r.repo} ${r.mode}: ${['updated', 'closed', 'unchanged', 'skipped', 'reported', 'failed'].map((k) => `${by(k).length} ${k}`).join(', ')}`);
  for (const x of r.results.filter((y) => y.result !== 'unchanged')) {
    console.log(`  #${x.number} ${x.result}${x.changes ? `: ${x.changes.join('; ')}` : ''}${x.reason ? `: ${x.reason}` : ''}`);
  }
  process.exit(by('failed').length ? 1 : 0);
}

module.exports = { apply, MARKER, parseArgs, parseRemote, refreshBody };
