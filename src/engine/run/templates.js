// @ts-check
// Templates and expressions of a run (#250, from src/engine/workflow.js): the nunjucks environment
// (`render`, autoescape off) with the filters the workflows use (`to_yaml`, `to_json`, `shuffle(seed)`,
// `clamp(lo, hi)`, `github_repo`, `pr_url`, `git_commits`, `git_log_stat`, `git_tags`, `project_version`,
// `filed_issues`, `developer_gaps`, `e2e_scenarios`, `suite_failures`, `missing_test_ids`, `check_command`, `issue_numbers`,
// `issue_lines`, `one_line`, `suite_lines`), `evalExpr` for `when:` conditions, and `testsPlan` (the
// unit/E2E test inputs as the templates read them). Pure: no run state.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');
const nunjucks = require('nunjucks');
const checkStep = require('../check-step');
const gateSummary = require('../gate-summary');
const scenarios = require('../scenarios');
const suiteStep = require('../suite-step');
const testIds = require('../test-ids');

// ---------------------------------------------------------------------------
// Templates and expressions
// ---------------------------------------------------------------------------
const tpl = new nunjucks.Environment(null, { autoescape: false });
tpl.addFilter('to_yaml', (v) => yaml.dump(v ?? null, { lineWidth: 120 }).trim());
tpl.addFilter('to_json', (v) => JSON.stringify(v, null, 2));
// Deterministic shuffle: the same seed (e.g. run_id) gives the same order in every step,
// so anonymized labels ("Proposal 2") stay consistent within a run but vary across runs.
tpl.addFilter('shuffle', (arr, seed = '') => {
  const out = [...(arr || [])];
  let h = crypto.createHash('sha256').update(String(seed)).digest().readUInt32BE(0);
  const rand = () => { h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return h / 2 ** 32; };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
});

// PR URL (agent output) → HOST/OWNER/REPO for `gh --repo`. Actions run in a shell, so anything
// that is not strictly a pull request URL throws instead of being interpolated.
tpl.addFilter('github_repo', (url) => {
  const m = /^https:\/\/([A-Za-z0-9.-]+)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/\d+(?:\/[A-Za-z0-9_-]*)?$/.exec(String(url ?? '').trim());
  if (!m) throw new Error(`not a GitHub pull request URL: ${JSON.stringify(url)}`);
  return `${m[1]}/${m[2]}/${m[3]}`;
});

// PR/MR URL (agent output) passed as is to a command in an action: a GitHub pull request or a
// GitLab merge request URL, or it throws.
tpl.addFilter('pr_url', (url) => {
  const u = String(url ?? '').trim();
  const ok = /^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/.test(u)
    || /^https:\/\/[A-Za-z0-9.-]+(?:\/[A-Za-z0-9_.-]+)+\/-\/merge_requests\/\d+$/.test(u);
  if (!ok) throw new Error(`not a pull/merge request URL: ${JSON.stringify(url)}`);
  return u;
});

// A number kept between bounds, e.g. a timeout that grows with the run's issues:
//   timeout: "{{ (30 + 10 * ((inputs.issues | length) - 1)) | clamp(30, 60) }}m"
tpl.addFilter('clamp', (v, lo = -Infinity, hi = Infinity) => Math.min(Math.max(Number(v) || 0, lo), hi));

// The commits of a folder's checkout since a base ref, one `<sha> <subject>` per line, for a gate's
// message: `{{ worktree_dir | git_commits('origin/' ~ inputs.base_branch) }}`. Empty without a
// folder (simulations have no worktree) or when git fails: a message never fails on it.
tpl.addFilter('git_commits', (dir, base) => {
  if (!dir || !base || !fs.existsSync(String(dir))) return '';
  try {
    return execFileSync('git', ['log', '--oneline', '--no-decorate', '-n', '30', `${base}..HEAD`], { cwd: String(dir), encoding: 'utf8', windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; }
});

// #290: what a release review reads instead of the run's logs. Each is '' without a folder or when
// git or the file fails: a prompt never fails on them.
const gitOut = (dir, args) => {
  if (!dir || !fs.existsSync(String(dir))) return '';
  try {
    return execFileSync('git', args, { cwd: String(dir), encoding: 'utf8', windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; }
};
// `git log --stat` of a folder's checkout since a base ref (the files and lines each commit changed)
tpl.addFilter('git_log_stat', (dir, base) => (base ? gitOut(dir, ['log', '--stat', '--no-decorate', '--format=%h %s', '-n', '30', `${base}..HEAD`]) : ''));
// the repository's last tags, newest first, one per line
tpl.addFilter('git_tags', (dir, n = 5) => gitOut(dir, ['tag', '--sort=-creatordate', '--list']).split('\n').filter(Boolean).slice(0, Number(n) || 5).join('\n'));
// the project's own version from its version file (package.json, pyproject.toml), e.g. "package.json: 0.3.0"
tpl.addFilter('project_version', (dir) => {
  if (!dir) return '';
  const read = (name) => { try { return fs.readFileSync(path.join(String(dir), name), 'utf8'); } catch { return ''; } };
  let version = '';
  try { version = JSON.parse(read('package.json') || '{}').version || ''; } catch { /* not JSON */ }
  if (version) return `package.json: ${version}`;
  const py = /^\s*version\s*=\s*["']([^"']+)["']/m.exec(read('pyproject.toml'));
  return py ? `pyproject.toml: ${py[1]}` : '';
});

// The issues an issue-tracker run created, as its `issues` output (#134): the `file` step's created
// issues with the analysis' complexity and grouping advice (`group_with`: the open issues it advised
// to run with them), what a `queue` chain groups by (chain-model queueBatches).
tpl.addFilter('filed_issues', (filed, analysis) => {
  const a = analysis || {};
  const groupWith = a.grouping === 'group' ? (a.nearby || []).filter((n) => n?.advice === 'group_with' && Number.isInteger(n.number)).map((n) => n.number) : [];
  return (filed || []).filter((f) => f?.action === 'created' && Number.isInteger(f.number) && f.number > 0).map((f) => ({
    number: f.number, url: f.url || '', title: f.title || '', complexity: a.complexity?.score ?? null, grouping: a.grouping || 'alone', group_with: groupWith,
  }));
});

// The developer's declared gaps (`left_out`, #98) that are really theirs (#173): an issue's Tests
// task belongs to the test writer and its Measure task to the owner's real runs, so an entry led by
// "Tests"/"Measure" (bold or not, then `:`, `-`, `(` or nothing) never sends the run back to develop
// nor to the requirements_left_out gate; it stays in the develop output of the run's summary.
const NOT_DEVELOPER_TASK = /^[\s>*_#[\]x-]*(?:tests?|measures?|measurements?)\b[*_\s]*(?::|-|–|—|\(|$)/i;
tpl.addFilter('developer_gaps', (gaps) => (Array.isArray(gaps) ? gaps : []).filter((g) => !NOT_DEVELOPER_TASK.test(String(g?.requirement ?? ''))));

// The E2E scenarios of a step output for a gate's message (#143): counts, one line per scenario
// with its status and reason, the note; '' when the output has no `scenarios` (src/engine/scenarios.js).
//   {{ steps.test.output | e2e_scenarios }}
tpl.addFilter('e2e_scenarios', (output) => scenarios.scenariosMessage(output));

// A `type: suite` step's output for a prompt or a gate (#177): the result, the log path and one line
// per failing test; '' when the output is not a suite's (src/engine/suite-step.js).
//   {{ steps.suite.output | suite_failures }}
tpl.addFilter('suite_failures', (output) => suiteStep.suiteMessage(output));
// How one round of a suite step ran (#324), for a release summary: focused on some files (then the
// whole suite) or whole, with its tests and minutes; '' when the output is not a suite's.
//   {% for o in steps.e2e.outputs %}{{ o | suite_scope('scenario') }}{% endfor %}
tpl.addFilter('suite_scope', (output, noun) => suiteStep.suiteScope(output, noun || undefined));

// The test ids the E2E step definitions of a checkout use and its renderer lacks (#246, the rule of
// src/engine/test-ids.js), one line per id with the step files that use it; '' when none or without
// a folder. Optional folders, repository-relative: steps (features/steps), renderer (src/renderer).
//   {{ worktree_dir | missing_test_ids }}
tpl.addFilter('missing_test_ids', (dir, steps, renderer) => {
  if (!dir || !fs.existsSync(String(dir))) return '';
  try {
    return testIds.missingTestIdLines(testIds.missingTestIds(String(dir), { steps: steps || undefined, renderer: renderer || undefined }));
  } catch { return ''; }
});

// The project's check command of a checkout (#404, src/engine/check-step.js): the given one (the
// check_command input), else `npm run check` when its package.json has a `check` script; '' when
// none or without a folder, so a route to the check step is skipped.
//   when: "worktree_dir | check_command(inputs.check_command)"
tpl.addFilter('check_command', (dir, command) => {
  if (!dir || !fs.existsSync(String(dir))) return '';
  return checkStep.checkCommand(String(dir), command) || '';
});

// The numbers of the run's issues (#223: their BDD tags @issue-<n>), from `issue` and `issues` (URLs
// ending in the number), without duplicates; [] without an issue.
//   {% for n in inputs | issue_numbers %}@issue-{{ n }}|{% endfor %}@smoke
tpl.addFilter('issue_numbers', (inputs) => {
  const issues = inputs?.issues;
  const urls = [inputs?.issue, ...(Array.isArray(issues) ? issues : String(issues || '').split(/\s+/))];
  return [...new Set(urls.map((u) => /(\d+)\D*$/.exec(String(u || ''))?.[1]).filter(Boolean))];
});

// A gate's `summary:` (#213): one ✔ / ✖ line per issue of a developer's or a verifier's output
// (`'not_done'` keeps the failed ones), one ✖ line per failing test of a suite's output, and a long
// text (a report, an error) on one line cut with an ellipsis.
//   {{ steps.verify_change.output.issues | issue_lines }}   {{ steps.suite.output | suite_lines }}
//   {{ steps.build.output.report | one_line(110) }}
tpl.addFilter('issue_lines', (issues, only = null) => gateSummary.issueLines(issues, { only }));
tpl.addFilter('one_line', (s, n = 110) => gateSummary.oneLine(s, n));
tpl.addFilter('suite_lines', (output) => gateSummary.suiteLines(output));

// The test inputs of the development workflows (#203): what the run summary and the gates say
// ("Unit tests: Off (workflow default)"), and their evidence screenshots (#205: "Screenshots: Off").
const TEST_INPUTS = { unit_tests: 'Unit tests', e2e_tests: 'E2E tests', screenshots: 'Screenshots' };
function testsPlan(defs, given, resolved) {
  return Object.entries(TEST_INPUTS).filter(([k]) => defs?.[k]).map(([k, label]) => {
    const def = defs[k];
    const value = resolved[k];
    const chosen = given?.[k] !== undefined && given[k] !== '' && given[k] !== def.default;
    return { input: k, label: def.label || label, value, value_label: def.options?.[value] || String(value), source: chosen ? 'chosen for this run' : 'workflow default' };
  });
}

const render = (s, scope) => (s == null ? '' : tpl.renderString(String(s), scope));
const evalExpr = (expr, scope) => render(`{% if ${expr} %}1{% else %}0{% endif %}`, scope).trim() === '1';

module.exports = {
  evalExpr,
  render,
  testsPlan,
};
