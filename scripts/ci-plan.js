// GitHub Actions planning, to spend fewer Actions minutes (private repo: Windows minutes count x2,
// macOS x10). Used by .github/workflows/*.yml; plain Node, no dependencies (runs before `npm ci`).
//   node scripts/ci-plan.js os                      # ci.yml: which OS runs `npm test` -> os=<json>
//   node scripts/ci-plan.js report <head> <tested> <state>  # ci.yml: record pending (run starts),
//                                                   #   success or failure (run ends) on the PR head
//   node scripts/ci-plan.js tested <sha>            # preview.yml: did CI pass on the PR head <sha>?
//   node scripts/ci-plan.js tested <sha> --merged   # deploy.yml: was the PR merged as <sha> tested
//                                                   #   with the same tree? -> tested=true|false
// Outputs go to $GITHUB_OUTPUT (stdout when unset). Any API error answers "run everything".
//
// Why a status of our own: a pull_request run tests (and attaches its checks to) GitHub's synthetic
// merge commit, not the PR head, so the `test` check is found neither on the head nor on the
// commit the merge creates. CI records a commit status `ci/tested` on the PR head instead (pending
// from the `plan` job, the result from the `test` job), with the tree it tested (the synthetic merge
// commit's) in its description.

const fs = require('fs');
const { execFileSync } = require('child_process');

const ALL_OS = ['ubuntu-latest', 'windows-latest', 'macos-latest'];
const PR_OS = ['ubuntu-latest', 'windows-latest'];
const MACOS_LABEL = 'ci:macos';
const TESTED_CONTEXT = 'ci/tested';

// Changes that cannot break `npm test`. Not every .md: the tests read CLAUDE.md, docs/agents/*.md
// (test/claude-md.test.js) and the bundled skills (skills/**, seeded and parsed by the engine tests).
function isDocsFile(file) {
  if (!file.toLowerCase().endsWith('.md')) return false;
  if (file === 'CLAUDE.md' || file.startsWith('docs/agents/') || file.startsWith('skills/')) return false;
  return true;
}

// Platform-sensitive paths: a PR touching one of them also runs on macOS (paths, symlinks, terminals,
// packaging, dependencies and CI itself).
const MACOS_PATHS = [
  'src/engine/worktree.js', 'src/engine/processes.js', 'src/terminals.js',
  'test/worktree.test.js', 'test/processes.test.js', 'test/terminals.test.js',
  'scripts/package.js', 'scripts/ci-plan.js', 'package.json', 'package-lock.json', '.nvmrc',
  '.github/workflows/',
];
const isMacosFile = (file) => MACOS_PATHS.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p));

/**
 * The runners `npm test` runs on for one CI event.
 * - pull_request: ubuntu + windows; macOS too when a platform-sensitive path changes or the PR has
 *   the `ci:macos` label; none when only docs changed (the `test` check still reports success).
 * - schedule: macOS only (the weekly macOS pass on main; PRs cover the other two).
 * - anything else (workflow_dispatch): every OS.
 */
function planOs({ event, files = [], labels = [] }) {
  if (event === 'schedule') return ['macos-latest'];
  if (event !== 'pull_request') return [...ALL_OS];
  if (files.length && files.every(isDocsFile)) return [];
  if (labels.includes(MACOS_LABEL) || files.some(isMacosFile)) return [...ALL_OS];
  return [...PR_OS];
}

/**
 * Whether a commit's tests can be skipped: CI passed on the PR head (its `ci/tested` status) and,
 * when the commit is a merge result, its tree is the one CI tested (main + the PR when CI ran). A PR
 * merged after main moved has another tree: its tests run again.
 */
function alreadyTested({ testConclusion, tree, testedTree }) {
  if (testConclusion !== 'success') return false;
  if (testedTree !== undefined && (!tree || tree !== testedTree)) return false;
  return true;
}

/**
 * The latest `ci/tested` status of a commit (the API lists the newest first) → { state, tree }.
 * @param statuses GET /repos/{repo}/commits/{sha}/statuses
 */
function testedStatus(statuses) {
  const s = (statuses || []).find((x) => x.context === TESTED_CONTEXT);
  if (!s) return { state: '', tree: '' };
  const tree = /\btree ([0-9a-f]{40})\b/.exec(s.description || '');
  return { state: s.state || '', tree: tree ? tree[1] : '' };
}

const STATE_WORDS = { pending: 'running', success: 'passed', failure: 'failed' };

/**
 * The `ci/tested` status CI writes on the PR head: `pending` when a run starts, then `success` or
 * `failure` when it ends, so a later failing run on the same commit replaces an older success.
 * Anything other than pending/success is recorded as failure.
 */
function testedStatusBody(state, tree) {
  const s = STATE_WORDS[state] ? state : 'failure';
  return { state: s, context: TESTED_CONTEXT, description: `CI ${STATE_WORDS[s]} on tree ${tree}` };
}

// --- GitHub API (gh, authenticated with GH_TOKEN) ---

const repo = () => process.env.GITHUB_REPOSITORY;
const api = (path, ...args) => execFileSync('gh', ['api', path, ...args], { encoding: 'utf8' }).trim();

const statusOf = (sha) => testedStatus(JSON.parse(api(`repos/${repo()}/commits/${sha}/statuses?per_page=100`) || '[]'));
const treeOf = (sha) => api(`repos/${repo()}/git/commits/${sha}`, '--jq', '.tree.sha');

function tested(sha, merged) {
  if (!merged) return alreadyTested({ testConclusion: statusOf(sha).state });
  const head = api(`repos/${repo()}/commits/${sha}/pulls`, '--jq', '[.[] | select(.merged_at != null)][0].head.sha // ""');
  if (!head) return false;
  const s = statusOf(head);
  return alreadyTested({ testConclusion: s.state, tree: treeOf(sha), testedTree: s.tree });
}

function report(head, testedSha, state) {
  const tree = treeOf(testedSha);
  const body = testedStatusBody(state, tree);
  api(`repos/${repo()}/statuses/${head}`, '-X', 'POST', '-f', `state=${body.state}`, '-f', `context=${body.context}`,
    '-f', `description=${body.description}`);
  return body;
}

function prFiles(number) {
  return api(`repos/${repo()}/pulls/${number}/files`, '--paginate', '--jq', '.[].filename').split('\n').filter(Boolean);
}

function output(name, value) {
  const line = `${name}=${value}\n`;
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, line);
  else process.stdout.write(line);
}

function main([command, ...args]) {
  if (command === 'os') {
    const event = process.env.GITHUB_EVENT_NAME;
    let os = [...ALL_OS];
    try {
      const payload = process.env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
      const pr = payload.pull_request;
      os = planOs({
        event,
        files: pr ? prFiles(pr.number) : [],
        labels: pr ? (pr.labels || []).map((l) => l.name) : [],
      });
    } catch (err) {
      console.error(`ci-plan: ${err.message.split('\n')[0]}; running every OS`);
    }
    console.log(`ci-plan: ${event} -> ${os.length ? os.join(', ') : 'docs only, no tests'}`);
    output('os', JSON.stringify(os));
    return 0;
  }
  if (command === 'tested' && args[0]) {
    let result = false;
    try { result = tested(args[0], args.includes('--merged')); }
    catch (err) { console.error(`ci-plan: ${err.message.split('\n')[0]}; running the tests`); }
    console.log(`ci-plan: ${args[0].slice(0, 7)} ${result ? 'already passed CI: tests skipped' : 'not tested by CI: tests run'}`);
    output('tested', String(result));
    return 0;
  }
  if (command === 'report' && args[2]) {
    // never fails CI: without the status, preview and deploy only run the tests again
    try { console.log(`ci-plan: ${args[0].slice(0, 7)} ${TESTED_CONTEXT}: ${report(args[0], args[1], args[2]).description}`); }
    catch (err) { console.error(`ci-plan: ${err.message.split('\n')[0]}; ${TESTED_CONTEXT} not recorded`); }
    return 0;
  }
  console.error('usage: node scripts/ci-plan.js os | report <head> <tested> pending|success|failure | tested <sha> [--merged]');
  return 2;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {
  alreadyTested,
  isDocsFile,
  MACOS_LABEL,
  planOs,
  testedStatus,
  testedStatusBody,
};
