// Code health (issue #344): measures every function under src/ and scripts/ with a real JS parser
// (acorn, a pinned runtime dependency): its lines, cyclomatic complexity (1 + each `if`, `else if`,
// ternary, `&&`, `||`, `??`, `case`, `catch` and loop), max nesting and parameter count. The
// measure and the function names are the shared core's (src/shared/code-complexity.js, #385), so
// the Architecture facts give the same numbers.
// Two ratchets sit next to #334's line ratchet (scripts/file-size-ratchet.js):
// - complexity: no function above MAX_COMPLEXITY; COMPLEXITY_EXCEPTIONS lists the ones above it
//   when the rule came, with their value: a listed function may not grow, and one that drops to
//   MAX_COMPLEXITY or below (or is gone) must leave the list;
// - duplication: blocks of MIN_DUPLICATE_LINES or more normalized lines (trimmed, blank lines
//   dropped) found in two places are counted per file against DUPLICATION_BASELINE: a new
//   duplicate fails, a file with fewer duplicates than its baseline must lower it.
// `--hotspots` ranks files and functions by complexity x churn (after #356 / Kent Beck's ToolSeeds
// `turbulence`, MIT): churn counts the commits of `git log` that touched the file, skipping merges,
// the commit that created the file and the commits of .git-blame-ignore-revs, following renames.
// A function's churn is its file's. Files sit in four quadrants on log1p axes split at the medians
// (Danger Zone, Cowboy Code, Fertile Ground, Healthy Closure) and rank by sqrt(u^2 + v^2), u and v
// each axis's log1p divided by its maximum. The log parsing, the rename walk, the quadrants and the
// score are the Architecture tab's pure core (src/shared/architecture-model.js, #356). Output
// is deterministic: sorted JSON keys, dates from the commits; churn git cannot read (a shallow
// clone, no repository) is `null` and named in `missing`, never 0. How to read it and how to split
// a function: docs/agents/testing.md ("Code health"). Checked by test/code-health-344.test.js.
//
//   node scripts/code-health.js [--json] [--root <dir>]    distribution and the top 20 functions
//   node scripts/code-health.js --hotspots [--json]         complexity x churn, files and functions
//   node scripts/code-health.js --check                     both ratchets, exit 1 on a problem

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { DIRS, listFiles } = require('./file-size-ratchet');
const {
  byHotness,
  byScore,
  countCommits,
  parseIgnoreRevs,
  parseLog,
  placeQuadrants,
  QUADRANTS,
  scoreRows,
  sortKeys,
  walkHistory,
} = require('../src/shared/architecture-model');
const { measureSource } = require('../src/shared/code-complexity');

const ROOT = path.join(__dirname, '..');
const MAX_COMPLEXITY = 25;
const MIN_DUPLICATE_LINES = 8;
const HOW_TO = 'docs/agents/testing.md ("Code health")';

// '<file>:<function name>' -> its complexity when listed; only lower it
const COMPLEXITY_EXCEPTIONS = {
  'scripts/layers.js:withoutComments': 27,
  'scripts/run.js:on(event) callback': 32,
  'scripts/screenshot.js:parseArgs': 85,
  'src/agent-inbox.js:handle': 32,
  'src/analytics.js:computeAnalytics': 50,
  'src/analytics.js:sessionRow': 31,
  'src/engine/deps-cache.js:ensureDeps': 40,
  'src/engine/providers.js:mockValue': 44,
  'src/engine/providers.js:runMock': 40,
  'src/engine/run/gates.js:requestApproval': 34,
  'src/engine/run/machine-steps.js:suiteRound': 41,
  'src/engine/run/sessions.js:agentTurn': 103,
  'src/engine/run/transitions.js:finishStep': 32,
  'src/engine/run/transitions.js:pollStep': 40,
  'src/engine/run/turns.js:invokeTurn': 42,
  'src/engine/screenshot-step.js:captureScreenshots': 34,
  'src/engine/suite-step.js:checkOnBase': 27,
  'src/engine/suite-step.js:parseFailures': 51,
  'src/engine/suite-step.js:runSuite': 71,
  'src/engine/workflow.js:constructor': 47,
  'src/engine/workflow.js:runStep': 46,
  'src/epics.js:applyEpic': 42,
  'src/evidence.js:buildManifest': 34,
  'src/mobile-gates.js:handle': 38,
  'src/night-watch.js:detectSelfHealing': 51,
  'src/night-watch.js:nightMetrics/map callback #4': 26,
  'src/occupancy.js:occupancyOf': 28,
  'src/oracle-run-analysis.js:analyzeRun': 71,
  'src/oracle-run-focus.js:timeOf': 36,
  'src/oracle-run-focus.js:toolsOf': 29,
  'src/oracle-wake.js:wakeLine': 33,
  'src/oracle.js:exchange': 34,
  'src/product-owner.js:ask #2': 61,
  'src/product-owner.js:callAgent': 33,
  'src/product-owner.js:fileDraft': 40,
  'src/product-owner.js:mockScenario': 28,
  'src/product-owner.js:normalizeAnswer/map callback #4': 28,
  'src/renderer/app.js:onEvent': 151,
  'src/renderer/gate-oracle.js:failureContext': 28,
  'src/renderer/gate-oracle.js:gateContext': 28,
  'src/renderer/gate-panel.js:gateToolsHtml': 28,
  'src/renderer/gate-panel.js:onGateTool': 37,
  'src/renderer/run-list.js:renderRunList': 30,
  'src/renderer/run-list.js:runListRow': 27,
  'src/renderer/start-drawer.js:selectWorkflow': 27,
  'src/renderer/views/agents/agents.js:agentCard': 26,
  'src/renderer/views/agents/agents.js:openAgentModal': 35,
  'src/renderer/views/arena/arena.js:onStepFinished': 36,
  'src/renderer/views/backlog/backlog-po.js:ask': 31,
  'src/renderer/views/backlog/backlog-po.js:fileDraft': 27,
  'src/renderer/views/backlog/backlog-po.js:render': 33,
  'src/renderer/views/backlog/backlog-roadmap.js:clicked': 94,
  'src/renderer/views/backlog/backlog-roadmap.js:html': 101,
  'src/renderer/views/backlog/backlog-roadmap.js:progressHtml': 28,
  'src/renderer/views/backlog/backlog.js:onclick(#bl-list)': 27,
  'src/renderer/views/backlog/backlog.js:render': 36,
  'src/renderer/views/discovery/discovery.js:onDetailClick': 28,
  'src/renderer/views/nightwatch/nightwatch.js:switchHtml': 28,
  'src/renderer/views/oracle/oracle.js:messageHtml': 38,
  'src/renderer/views/oracle/oracle.js:render': 36,
  'src/renderer/views/run/run.js:renderChainBanner': 53,
  'src/renderer/views/run/run.js:renderRunSummary': 29,
  'src/renderer/views/runchat/runchat.js:gateHtml': 38,
  'src/renderer/views/runchat/runchat.js:itemHtml': 30,
  'src/renderer/views/workflows/builder.js:renderPanel': 41,
  'src/renderer/views/workflows/workflows.js:workflowCard': 34,
  'src/renderer/workflow-inputs.js:applyHints': 27,
  'src/roadmap-merge.js:mergeEdit': 65,
  'src/roadmap.js:cleanItem': 38,
  'src/run-analysis.js:runFigures': 105,
  'src/runs.js:readRun': 46,
  'src/service/areas/live-roadmap.js:refill': 35,
  'src/service/areas/releases.js:settleRelease': 29,
  'src/service/areas/resume.js:keptWorkQuestion': 29,
  'src/service/areas/roadmap.js:advanceRoadmap': 36,
  'src/service/areas/runs.js:startWorkflowRun': 41,
  'src/session-tail.js:print': 29,
  'src/session-tail.js:printOrchestrator': 45,
  'src/shared/json-schema.js:validateSchema': 39,
  'src/shared/providers/claude.js:parse': 49,
  'src/shared/providers/codex.js:parse': 29,
  'src/shared/providers/grok.js:parse': 35,
  'src/shared/run-progress-model.js:estimateProgress': 34,
  'src/shared/run-progress-model.js:progressGroups': 30,
  'src/shared/run-progress-model.js:workflowStations': 28,
  'src/supervisor.js:onCallPrompt': 26,
  'src/supervisor.js:resumeSpec': 35,
  'src/supervisor.js:runReport': 30,
  'src/usage.js:computeUsage': 39,
  'src/workflow-builder.js:fromWorkflow': 42,
  'src/workflow-builder.js:patchWorkflow': 41,
  'src/workflow-builder.js:readAgent': 27,
};

// file -> its count of duplicated blocks when the rule came; only lower it
const DUPLICATION_BASELINE = {
  'src/engine/deps-cache.js': 1,
  'src/engine/screenshot-step.js': 1,
  'src/mobile-gates.js': 1,
  'src/night-watch.js': 1,
  'src/preload.js': 1,
  'src/renderer/api-http.js': 1,
  'src/renderer/views/arena/arena.js': 2,
  'src/renderer/views/duo/duo.js': 2,
  'src/run-analysis.js': 1,
  'src/server/index.js': 1,
  'src/service/areas/chain.js': 2,
  'src/service/areas/insights.js': 1,
  'src/service/areas/live-roadmap.js': 2,
  'src/service/channels/nightwatch.js': 1,
  'src/service/channels/product-owner.js': 1,
};

// ---------- the metric ----------

// The measure is the shared core's (src/shared/code-complexity.js, #385), the Architecture facts' too
// [{ name, file, line, lines, complexity, nesting, params }] for every function of a source text.
const analyzeSource = (code, file) => measureSource(code, { file });

const sourceFiles = (root) => DIRS.flatMap((d) => listFiles(root, d)).sort();
const readSource = (root, file) => fs.readFileSync(path.join(root, ...file.split('/')), 'utf8');
const measureFiles = (root, files) => files.flatMap((file) => analyzeSource(readSource(root, file), file));

// ---------- the complexity ratchet ----------

function complexityProblem(f, key, listed) {
  const { file, name, complexity } = f;
  if (listed !== null && complexity <= MAX_COMPLEXITY) {
    return { file, name, kind: 'leave-list', complexity, message: `${key} has complexity ${complexity}, within the limit of ${MAX_COMPLEXITY}: remove it from COMPLEXITY_EXCEPTIONS in scripts/code-health.js.` };
  }
  if (listed !== null && complexity > listed) {
    return { file, name, kind: 'grew', complexity, message: `${key} (line ${f.line}) grew to complexity ${complexity}, past its listed ${listed}: split the function (how-to: ${HOW_TO}) instead of raising the value.` };
  }
  if (listed === null && complexity > MAX_COMPLEXITY) {
    return { file, name, kind: 'over', complexity, message: `${key} (line ${f.line}) has complexity ${complexity}, over the limit of ${MAX_COMPLEXITY}: split the function (how-to: ${HOW_TO}).` };
  }
  return null;
}

const byFileAndName = (a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name);

// [{ file, name, kind: 'over' | 'grew' | 'leave-list', complexity, message }], sorted by file and name.
function checkComplexity({ root = ROOT, exceptions = COMPLEXITY_EXCEPTIONS } = {}) {
  const problems = [];
  const seen = new Set();
  for (const f of measureFiles(root, sourceFiles(root))) {
    const key = `${f.file}:${f.name}`;
    const listed = Object.hasOwn(exceptions, key) ? exceptions[key] : null;
    if (listed !== null) seen.add(key);
    const problem = complexityProblem(f, key, listed);
    if (problem) problems.push(problem);
  }
  for (const key of Object.keys(exceptions).filter((k) => !seen.has(k))) {
    const at = key.indexOf(':');
    problems.push({ file: key.slice(0, at), name: key.slice(at + 1), kind: 'leave-list', complexity: null, message: `${key} no longer exists: remove it from COMPLEXITY_EXCEPTIONS in scripts/code-health.js.` });
  }
  return problems.sort(byFileAndName);
}

// ---------- the duplication ratchet ----------

const normalizedLines = (text) => String(text).split(/\r\n?|\n/).map((l) => l.trim()).filter(Boolean);

function windowsOf(lines) {
  const out = [];
  for (let i = 0; i + MIN_DUPLICATE_LINES <= lines.length; i++) out.push(lines.slice(i, i + MIN_DUPLICATE_LINES).join('\n'));
  return out;
}

// Overlapping or adjacent repeated windows form one block.
function blocksIn(windows, places) {
  let blocks = 0;
  let end = -1;
  windows.forEach((w, i) => {
    if (places.get(w) < 2) return;
    if (i > end) blocks++;
    end = i + MIN_DUPLICATE_LINES;
  });
  return blocks;
}

// { file: count of duplicated blocks } for { file: text }; files without a duplicate are absent.
function countDuplicates(texts) {
  const windows = {};
  const places = new Map();
  for (const [file, text] of Object.entries(texts)) {
    windows[file] = windowsOf(normalizedLines(text));
    for (const w of windows[file]) places.set(w, (places.get(w) || 0) + 1);
  }
  const counts = {};
  for (const [file, list] of Object.entries(windows)) {
    const n = blocksIn(list, places);
    if (n) counts[file] = n;
  }
  return counts;
}

function duplicationProblem(file, count, listed) {
  if (count > listed) {
    const kind = listed ? 'grew' : 'new';
    return { file, kind, count, message: `${file} has ${count} duplicated block(s) of ${MIN_DUPLICATE_LINES}+ lines, its baseline is ${listed}: call or move the shared code instead of copying it (how-to: ${HOW_TO}; \`node scripts/code-health.js --duplicates\` shows where).` };
  }
  if (count < listed) {
    return { file, kind: 'lower-baseline', count, message: `${file} has ${count} duplicated block(s), fewer than its baseline of ${listed}: lower it in DUPLICATION_BASELINE in scripts/code-health.js.` };
  }
  return null;
}

// [{ file, kind: 'new' | 'grew' | 'lower-baseline', count, message }], sorted by file.
function checkDuplication({ root = ROOT, baseline = DUPLICATION_BASELINE } = {}) {
  const files = sourceFiles(root);
  const counts = countDuplicates(Object.fromEntries(files.map((f) => [f, readSource(root, f)])));
  const all = [...new Set([...Object.keys(counts), ...Object.keys(baseline)])].sort();
  return all.map((file) => duplicationProblem(file, counts[file] || 0, baseline[file] || 0)).filter(Boolean);
}

// Where each duplicated window sits: [{ lines: text, places: ['file'] }], for --duplicates.
function duplicateBlocks(texts) {
  const where = new Map();
  for (const [file, text] of Object.entries(texts)) {
    for (const w of windowsOf(normalizedLines(text))) where.set(w, [...(where.get(w) || []), file]);
  }
  return [...where].filter(([, files]) => files.length > 1).map(([w, files]) => ({ first: w.split('\n')[0], places: files }));
}

// ---------- hotspots ----------

function git(root, args) {
  try {
    return execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 });
  } catch {
    return null;
  }
}

function readIgnoreRevs(root) {
  const file = path.join(root, '.git-blame-ignore-revs');
  if (!fs.existsSync(file)) return [];
  return parseIgnoreRevs(fs.readFileSync(file, 'utf8'));
}

// { commits: { file: n }, last: { file: date } } or { missing: 'why' }.
function readChurn(root, files) {
  const shallow = git(root, ['rev-parse', '--is-shallow-repository']);
  if (shallow === null) return { missing: 'churn: not a git repository, commits unknown' };
  if (shallow.trim() === 'true') return { missing: 'churn: shallow clone, git log does not hold the whole history (git fetch --unshallow)' };
  const log = git(root, ['log', '--no-merges', '-M', '--name-status', '--format=%x01%H %cI']);
  if (log === null) return { missing: 'churn: git log failed (no commits?), commits unknown' };
  return countCommits(walkHistory(parseLog(log), files, readIgnoreRevs(root)), files);
}

function readHead(root) {
  const head = git(root, ['log', '-1', '--format=%H %cI']);
  if (!head || !head.trim()) return null;
  const [commit, date] = head.trim().split(' ');
  return { commit, date };
}

function fileRows(files, functions, churn) {
  const rows = files.map((file) => {
    const own = functions.filter((f) => f.file === file);
    const commits = churn.commits ? churn.commits[file] : null;
    const complexity = own.reduce((sum, f) => sum + f.complexity, 0);
    const worst = own.reduce((max, f) => Math.max(max, f.complexity), 0);
    return { file, commits, complexity, worst, functions: own.length, last_change: (churn.last && churn.last[file]) || null, quadrant: null, score: null };
  });
  placeQuadrants(rows);
  return rows.sort(byHotness);
}

// { files, functions, head, missing }: files in quadrant order (Danger Zone first), hottest on top.
function hotspots({ root = ROOT } = {}) {
  const files = sourceFiles(root);
  const measured = measureFiles(root, files);
  const churn = readChurn(root, files);
  const commitsOf = (file) => (churn.commits ? churn.commits[file] : null);
  const functions = scoreRows(measured.map(({ file, name, line, complexity }) => ({ file, name, line, complexity, commits: commitsOf(file), score: null })))
    .sort((a, b) => byScore(a, b) || byFileAndName(a, b));
  return { files: fileRows(files, measured, churn), functions, head: readHead(root), missing: churn.missing ? [churn.missing] : [] };
}

// ---------- the CLI ----------

const json = (value) => `${JSON.stringify(sortKeys(value), null, 2)}\n`;
const percentile = (sorted, p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
const pad = (v, n) => String(v ?? '-').padStart(n);

function distribution(functions) {
  const values = functions.map((f) => f.complexity).sort((a, b) => a - b);
  return { functions: values.length, median: percentile(values, 0.5), p90: percentile(values, 0.9), p99: percentile(values, 0.99), max: values[values.length - 1] ?? 0, over_limit: values.filter((v) => v > MAX_COMPLEXITY).length };
}

const AREAS = { renderer: (f) => f.file.startsWith('src/renderer/'), backend: (f) => f.file.startsWith('src/') && !f.file.startsWith('src/renderer/'), scripts: (f) => f.file.startsWith('scripts/') };

function functionReport(root, asJson) {
  const functions = measureFiles(root, sourceFiles(root));
  const areas = { all: distribution(functions), ...Object.fromEntries(Object.entries(AREAS).map(([k, keep]) => [k, distribution(functions.filter(keep))])) };
  if (asJson) return json({ distribution: areas, functions, max_complexity: MAX_COMPLEXITY });
  const lines = [`Cyclomatic complexity per function (limit ${MAX_COMPLEXITY}; how-to: ${HOW_TO})`];
  for (const [area, d] of Object.entries(areas)) lines.push(`  ${area.padEnd(9)} ${pad(d.functions, 6)} functions  median ${d.median}  p90 ${d.p90}  p99 ${d.p99}  max ${d.max}  over ${MAX_COMPLEXITY}: ${d.over_limit}`);
  lines.push('', 'Top 20 functions by complexity (complexity, nesting, params, lines, where):');
  const top = [...functions].sort((a, b) => b.complexity - a.complexity || byFileAndName(a, b)).slice(0, 20);
  for (const f of top) lines.push(`  ${pad(f.complexity, 4)} ${pad(f.nesting, 3)} ${pad(f.params, 3)} ${pad(f.lines, 5)}  ${f.file}:${f.line} ${f.name}`);
  return `${lines.join('\n')}\n`;
}

function hotspotReport(root, asJson) {
  const report = hotspots({ root });
  if (asJson) return json(report);
  const head = report.head ? `${report.head.commit.slice(0, 12)} (${report.head.date})` : 'no commit';
  const lines = [`Hotspots at ${head}: complexity x churn (how-to: ${HOW_TO})`];
  for (const m of report.missing) lines.push(`  missing: ${m}`);
  for (const q of QUADRANTS) lines.push(`  ${q.padEnd(16)} ${report.files.filter((f) => f.quadrant === q).length} file(s)`);
  lines.push('', 'Files, Danger Zone first (score, total complexity, worst function, commits, quadrant, file):');
  for (const f of report.files.slice(0, 30)) lines.push(`  ${pad(f.score, 7)} ${pad(f.complexity, 6)} ${pad(f.worst, 4)} ${pad(f.commits, 5)}  ${(f.quadrant || 'unknown').padEnd(16)} ${f.file}`);
  lines.push('', 'Top 20 functions (score, complexity, file commits, where):');
  for (const f of report.functions.slice(0, 20)) lines.push(`  ${pad(f.score, 7)} ${pad(f.complexity, 4)} ${pad(f.commits, 5)}  ${f.file}:${f.line} ${f.name}`);
  return `${lines.join('\n')}\n`;
}

function duplicateReport(root) {
  const files = sourceFiles(root);
  const blocks = duplicateBlocks(Object.fromEntries(files.map((f) => [f, readSource(root, f)])));
  return `${blocks.map((b) => `${b.places.join(', ')}\n    ${b.first}`).join('\n')}\n`;
}

function check(root) {
  const problems = [...checkComplexity({ root }), ...checkDuplication({ root })];
  return { text: problems.map((p) => `${p.message}\n`).join('') || 'Code health ratchets: ok\n', failed: problems.length > 0 };
}

function main(argv) {
  const at = argv.indexOf('--root');
  const root = at >= 0 ? path.resolve(argv[at + 1]) : ROOT;
  const asJson = argv.includes('--json');
  if (argv.includes('--check')) {
    const { text, failed } = check(root);
    process.stdout.write(text);
    if (failed) process.exitCode = 1;
  } else if (argv.includes('--hotspots')) {
    process.stdout.write(hotspotReport(root, asJson));
  } else if (argv.includes('--duplicates')) {
    process.stdout.write(duplicateReport(root));
  } else {
    process.stdout.write(functionReport(root, asJson));
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  analyzeSource,
  checkComplexity,
  checkDuplication,
  COMPLEXITY_EXCEPTIONS,
  countDuplicates,
  DUPLICATION_BASELINE,
  hotspots,
  MAX_COMPLEXITY,
  MIN_DUPLICATE_LINES,
};
