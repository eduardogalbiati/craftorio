// The deterministic core of a project's Architecture tab (#356) and of `scripts/code-health.js
// --hotspots` (#344): git facts in, a JSON model out, with no file system, git, network, clock or
// randomness inside. parseLog reads `git log -M --name-status --format=%x01%H %cI`; walkHistory
// follows renames backwards (the creating commit is not churn, .git-blame-ignore-revs commits are
// skipped); placeQuadrants splits rows at the medians of log1p(complexity) and log1p(commits) and
// scores them by sqrt(u² + v²), u and v each axis's log1p divided by its maximum. buildModel takes
// the sources the service reads at the default branch's commit (src/domains/project/architecture-facts.js) and
// gives lines, churn, hotspots (lines × commits), co-change pairs, languages, exclusions (per
// group), mass changes (> 25% of the files, kept unless includeMass is false), complexity per file
// (total, worst function and function count, only from a real parser or tool; the code languages
// none measured are named, #385) and the monthly Danger Zone frames. Keys sorted,
// dates from the commits only. Browser: window.ArchitectureModel; Node: module.exports.
(function (root) {
  const QUADRANTS = ['Danger Zone', 'Cowboy Code', 'Fertile Ground', 'Healthy Closure'];
  const MASS_SHARE = 0.25;
  const MASS_MIN_FILES = 5; // in a tiny repository every commit touches 25% of the files
  const PAIR_SHARE = 0.6;
  const PAIR_MIN_TOGETHER = 2;

  const MAX_PATTERN = 200;

  // Excluded by default, per group (and `tests`: the engine's test files, TESTS_PATHS of
  // packages/shared/globs.js); .gitattributes (linguist-generated / -vendored) and the project's own
  // list come first
  const DEFAULT_EXCLUDES = {
    build: ['build/', 'coverage/', 'dist/', 'out/', 'target/', '*.map', '*.min.css', '*.min.js'],
    lock: ['*.lock', 'composer.lock', 'go.sum', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'],
    vendored: ['node_modules/', 'third_party/', 'vendor/'],
  };

  // Display languages by extension (line counts, any file type: Markdown, CSS, YAML...); the
  // languages a run's skills are picked for are src/engine/language-skills.js's, by skill suffix
  const LANGUAGES = {
    '.c': 'C', '.h': 'C', '.cc': 'C++', '.cpp': 'C++', '.hpp': 'C++', '.cs': 'C#', '.css': 'CSS', '.go': 'Go',
    '.html': 'HTML', '.java': 'Java', '.js': 'JavaScript', '.cjs': 'JavaScript', '.mjs': 'JavaScript', '.jsx': 'JavaScript',
    '.json': 'JSON', '.kt': 'Kotlin', '.kts': 'Kotlin', '.md': 'Markdown', '.php': 'PHP', '.ps1': 'PowerShell',
    '.py': 'Python', '.pyi': 'Python', '.rb': 'Ruby', '.rs': 'Rust', '.scss': 'SCSS', '.sh': 'Shell', '.sql': 'SQL', '.swift': 'Swift',
    '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript', '.vue': 'Vue', '.yaml': 'YAML', '.yml': 'YAML',
  };

  // The tool that would measure a language's complexity (cyclomatic); JavaScript and TypeScript
  // need none: the app measures them itself (packages/shared/code-complexity.js, #385)
  const COMPLEXITY_TOOLS = {
    C: 'lizard',
    'C#': 'lizard',
    'C++': 'lizard',
    Go: 'gocyclo',
    Java: 'lizard',
    Kotlin: 'lizard',
    PHP: 'lizard',
    Python: 'radon or lizard',
    Ruby: 'lizard',
    Rust: 'clippy or rust-code-analysis',
    Swift: 'lizard',
  };
  const MEASURED_IN_APP = ['JavaScript', 'TypeScript'];
  const ANY_LANGUAGE_TOOL = 'lizard (any other language)';

  // `{a => b}/c` or `a => b` (a --numstat rename) → [old, new]
  function splitRename(p) {
    const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(p);
    if (brace) {
      const [, pre, from, to, post] = brace;
      const join = (mid) => `${pre}${mid}${post}`.replace(/\/\/+/g, '/');
      return [join(from), join(to)];
    }
    return p.split(' => ');
  }

  // [{ hash, date, changes: [{ status, paths }] }], newest first.
  function parseLog(text) {
    const commits = [];
    for (const line of String(text || '').split('\n')) {
      if (line.startsWith('\x01')) {
        const [hash, date] = line.slice(1).trim().split(' ');
        commits.push({ hash, date, changes: [] });
      } else if (line.includes('\t') && commits.length) {
        const [status, ...rest] = line.replace(/\r$/, '').split('\t');
        const paths = rest.length === 1 && rest[0].includes(' => ') ? splitRename(rest[0]) : rest;
        commits[commits.length - 1].changes.push({ status: status[0], paths });
      }
    }
    return commits;
  }

  // Walks history backwards: `owner` maps a path at that point in history to today's file. A
  // change's plan: the file it counts for (null: a creation, a deletion, a file gone since), the
  // paths that stop mapping and the old path a rename maps to that file.
  function planChange({ status, paths }, owner) {
    const now = paths[paths.length - 1];
    const target = owner.get(now);
    if (status === 'A' || status === 'C') return { target: null, drop: now, link: null };
    if (!target || status === 'D') return { target: null, drop: null, link: null };
    if (status === 'R') return { target, drop: now, link: [paths[0], target] };
    return { target, drop: null, link: null };
  }

  // .git-blame-ignore-revs text → the revisions to skip (lowercase hashes; comments and blanks dropped)
  function parseIgnoreRevs(text) {
    return String(text || '').split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => /^[0-9a-f]{7,40}$/.test(l));
  }

  // The commits (newest first) with the files of `files` each one changed: [{ hash, date, ignored, targets }].
  // A commit's changes are read against the mapping before it (`git mv b a; git mv c b` in one commit).
  function walkHistory(commits, files, ignoreRevs = []) {
    const owner = new Map(files.map((f) => [f, f]));
    return commits.map((commit) => {
      const plans = commit.changes.map((change) => planChange(change, owner));
      for (const p of plans) if (p.drop) owner.delete(p.drop);
      for (const p of plans) if (p.link) owner.set(p.link[0], p.link[1]);
      const targets = new Set(plans.map((p) => p.target).filter(Boolean));
      const ignored = ignoreRevs.some((rev) => rev && commit.hash.startsWith(rev));
      return { hash: commit.hash, date: commit.date, ignored, targets: [...targets].sort() };
    });
  }

  // { commits: { file: n }, last: { file: date } } over the walked commits `keep` accepts
  function countCommits(walked, files, keep = (c) => !c.ignored) {
    const commits = Object.fromEntries(files.map((f) => [f, 0]));
    const last = {};
    for (const c of walked) {
      if (!keep(c)) continue;
      for (const t of c.targets) {
        commits[t]++;
        last[t] = last[t] || c.date;
      }
    }
    return { commits, last };
  }

  function median(values) {
    const s = [...values].sort((a, b) => a - b);
    if (!s.length) return 0;
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  const round3 = (n) => Math.round(n * 1000) / 1000;
  const isKnown = (r) => r.commits !== null && r.commits !== undefined;

  // score = sqrt(u² + v²), u = log1p(complexity) / its maximum, v = log1p(commits) / its maximum;
  // a row with unknown commits scores null
  function scoreRows(rows) {
    const known = rows.filter(isKnown);
    const maxU = known.reduce((m, r) => Math.max(m, Math.log1p(r.complexity)), 0);
    const maxV = known.reduce((m, r) => Math.max(m, Math.log1p(r.commits)), 0);
    for (const r of rows) {
      if (!isKnown(r)) { r.score = null; continue; }
      const u = maxU ? Math.log1p(r.complexity) / maxU : 0;
      const v = maxV ? Math.log1p(r.commits) / maxV : 0;
      r.score = round3(Math.hypot(u, v));
    }
    return rows;
  }

  // Quadrant and score of each row ({ complexity, commits }); unknown commits: both null
  function placeQuadrants(rows) {
    const known = rows.filter(isKnown);
    const mu = median(known.map((r) => Math.log1p(r.complexity)));
    const mv = median(known.map((r) => Math.log1p(r.commits)));
    for (const r of rows) {
      if (!isKnown(r)) { r.quadrant = null; continue; }
      const complex = Math.log1p(r.complexity) > mu;
      const busy = Math.log1p(r.commits) > mv;
      r.quadrant = QUADRANTS[(complex ? 0 : 2) + (busy ? 0 : 1)];
    }
    return scoreRows(rows);
  }

  const quadrantRank = (q) => (q ? QUADRANTS.indexOf(q) : QUADRANTS.length);
  const byScore = (a, b) => (b.score ?? -1) - (a.score ?? -1) || b.complexity - a.complexity;
  const byHotness = (a, b) => quadrantRank(a.quadrant) - quadrantRank(b.quadrant) || byScore(a, b) || a.file.localeCompare(b.file);

  function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }

  // ---------- exclusions ----------

  // the shared glob rule and test patterns (packages/shared/globs.js; in the browser it loads after this file)
  const globs = () => (typeof module === 'object' && module.exports ? require('./globs') : root.Globs);

  // A gitignore-style pattern → a { test(path) } over a repository path: the shared glob rule, plus a
  // trailing `/` for a folder (`dist/`: any dist folder's files). A repository's .gitattributes must
  // not stall the service: the pattern is cut at MAX_PATTERN, runs of `*` and repeated `**/`
  // collapse, and the match never backtracks (globMatcher, not a RegExp: `*a*a*a…` would be exponential).
  function globRe(pattern) {
    let p = String(pattern).trim().replace(/\\/g, '/').slice(0, MAX_PATTERN).replace(/\*{3,}/g, '**').replace(/(\*\*\/)+/g, '**/');
    const anchored = p.startsWith('/');
    if (anchored) p = p.slice(1);
    if (p.endsWith('/')) p = anchored || p.slice(0, -1).includes('/') ? `${p}**` : `**/${p}**`;
    return globs().globMatcher(anchored ? `/${p}` : p);
  }

  // .gitattributes → [{ re, generated, vendored }] (true, false or undefined), in file order
  function parseAttributes(text) {
    const rules = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const [pattern, ...attrs] = line.split(/\s+/);
      const rule = { re: globRe(pattern) };
      for (const a of attrs) {
        const m = /^(-?)linguist-(generated|vendored)(?:=(true|false))?$/.exec(a);
        if (m) rule[m[2]] = !(m[1] === '-' || m[3] === 'false');
      }
      if ('generated' in rule || 'vendored' in rule) rules.push(rule);
    }
    return rules;
  }

  // The group a file is excluded by, or null: generated, vendored (attributes), project, then the defaults
  function excludedBy(file, attributes, projectRes, defaultRes) {
    const attr = {};
    for (const rule of attributes) {
      if (!rule.re.test(file)) continue;
      if ('generated' in rule) attr.generated = rule.generated;
      if ('vendored' in rule) attr.vendored = rule.vendored;
    }
    if (attr.generated) return 'generated';
    if (attr.vendored) return 'vendored';
    if (projectRes.some((re) => re.test(file))) return 'project';
    for (const [group, res] of defaultRes) if (res.some((re) => re.test(file))) return group;
    return null;
  }

  function languageOf(file) {
    const base = file.split('/').pop();
    if (/^Dockerfile/.test(base)) return 'Dockerfile';
    const dot = base.lastIndexOf('.');
    return (dot > 0 && LANGUAGES[base.slice(dot).toLowerCase()]) || 'Other';
  }

  // ---------- the model ----------

  const inWindow = (date, window) => {
    const t = Date.parse(date);
    if (window.since && t < Date.parse(window.since)) return false;
    if (window.until && t > Date.parse(window.until)) return false;
    return true;
  };

  function coChangePairs(commits, counts) {
    const together = new Map();
    for (const c of commits) {
      for (let i = 0; i < c.targets.length; i++) {
        for (let j = i + 1; j < c.targets.length; j++) {
          const key = `${c.targets[i]}\n${c.targets[j]}`;
          together.set(key, (together.get(key) || 0) + 1);
        }
      }
    }
    const pairs = [];
    for (const [key, n] of together) {
      const [a, b] = key.split('\n');
      const share = round3(n / Math.min(counts[a], counts[b]));
      if (n >= PAIR_MIN_TOGETHER && share >= PAIR_SHARE) pairs.push({ a, b, share, together: n });
    }
    return pairs.sort((x, y) => y.share - x.share || y.together - x.together || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  }

  function languageLines(rows) {
    const by = new Map();
    for (const r of rows) {
      const l = by.get(r.language) || { language: r.language, lines: 0, files: 0 };
      l.lines += r.lines;
      l.files++;
      by.set(r.language, l);
    }
    return [...by.values()].sort((a, b) => b.lines - a.lines || a.language.localeCompare(b.language));
  }

  // { status: 'measured', tool, metric, check } or { status: 'missing' | 'failed', reason }; both
  // with { unmeasured: [the code languages no file of which is measured], needed: [their tools],
  // reason (why), install (the command that installs the missing tool, or null) } (#385)
  function complexityStatus(input, rows) {
    const measured = input && Array.isArray(input.functions);
    const code = (language) => MEASURED_IN_APP.includes(language) || language in COMPLEXITY_TOOLS;
    const languages = new Set(rows.filter((r) => code(r.language)).map((r) => r.language));
    for (const r of rows) if (r.complexity !== null) languages.delete(r.language);
    const unmeasured = [...languages].sort();
    const tools = unmeasured.map((l) => COMPLEXITY_TOOLS[l]).filter(Boolean);
    const needed = [...new Set(measured ? tools : [...tools, ANY_LANGUAGE_TOOL])];
    const install = (input && input.install) || null;
    const why = (input && input.reason) || null;
    if (measured) {
      return { status: 'measured', tool: input.tool || null, metric: input.metric || 'cyclomatic', functions: input.functions.length, check: input.check || null, unmeasured, needed, reason: unmeasured.length ? why : null, install: unmeasured.length ? install : null };
    }
    const status = input && input.status === 'failed' ? 'failed' : 'missing';
    return { status, needed, unmeasured, reason: why || 'no complexity tool found on this machine', install };
  }

  // The three longest functions and what looks wrong in a tool's output (a failed check is shown)
  function checkComplexity(functions) {
    const problems = [];
    if (!functions.length) problems.push('the tool measured no function');
    const bad = functions.filter((f) => !Number.isInteger(f.complexity) || f.complexity < 1);
    if (bad.length) problems.push(`${bad.length} function(s) without a positive integer score`);
    const longest = [...functions].filter((f) => Number.isFinite(f.length))
      .sort((a, b) => b.length - a.length || a.file.localeCompare(b.file) || a.line - b.line).slice(0, 3)
      .map(({ file, name, line, length, complexity }) => ({ file, name, line, length, complexity }));
    if (longest.length === 3 && longest.every((f) => f.length >= 50 && f.complexity === 1)) problems.push('the three longest functions all score 1');
    return { ok: problems.length === 0, problems, longest };
  }

  // Files that entered or left the Danger Zone month by month. Known limit: complexity is the head
  // commit's in every frame (the tool measures one checkout), only the churn up to each month
  // changes, so an entry or exit reflects churn alone; the tab says so next to the frames.
  function dangerFrames(rows, counted) {
    const months = [...new Set(counted.map((c) => String(c.date).slice(0, 7)))].sort();
    const frames = [];
    let previous = new Set();
    for (const month of months) {
      const commits = Object.fromEntries(rows.map((r) => [r.file, 0]));
      for (const c of counted) if (String(c.date).slice(0, 7) <= month) for (const t of c.targets) if (t in commits) commits[t]++;
      const frame = rows.map((r) => ({ file: r.file, complexity: r.complexity, commits: commits[r.file] }));
      placeQuadrants(frame);
      const danger = new Set(frame.filter((r) => r.quadrant === QUADRANTS[0]).map((r) => r.file));
      frames.push({
        month,
        danger: danger.size,
        entered: [...danger].filter((f) => !previous.has(f)).sort(),
        left: [...previous].filter((f) => !danger.has(f)).sort(),
      });
      previous = danger;
    }
    return frames;
  }

  // The rows of the measured files: a file with functions, or one the tool read without finding a
  // function (`files`: 0, as scripts/code-health.js counts it); any other file stays null
  function measuredRows(rows, functions, files) {
    const own = new Map((files || []).map((file) => [file, []]));
    for (const f of functions) {
      const list = own.get(f.file) || [];
      list.push(f);
      own.set(f.file, list);
    }
    const measured = [];
    for (const r of rows) {
      const fns = own.get(r.file);
      if (!fns) continue;
      r.complexity = fns.reduce((sum, f) => sum + f.complexity, 0);
      r.worst = fns.reduce((max, f) => Math.max(max, f.complexity), 0);
      r.functions = fns.length;
      measured.push(r);
    }
    return measured;
  }

  /**
   * The model of a repository at one commit.
   * sources: { head: { commit, date }, branch, shallow, window: { since, until }, files: [{ path, lines }],
   * log (git log text), ignoreRevs: [rev], attributes (.gitattributes text), exclude: [pattern],
   * includeMass, includeTests (the test files are kept, not excluded), complexity: { tool, metric, functions: [{ file, name, line, complexity, length }] } | null }
   */
  function buildModel(sources) {
    const window = { since: (sources.window && sources.window.since) || null, until: (sources.window && sources.window.until) || null };
    const attributes = parseAttributes(sources.attributes);
    const projectRes = (sources.exclude || []).filter(Boolean).map(globRe);
    // includeTests (#372): the city draws the tests too (its campus); the hotspots leave them out
    const groups = { ...DEFAULT_EXCLUDES, ...(sources.includeTests ? {} : { tests: globs().TESTS_PATHS }) };
    const defaultRes = Object.keys(groups).sort().map((g) => [g, groups[g].map(globRe)]);
    const excluded = { build: 0, generated: 0, lock: 0, project: 0, tests: 0, vendored: 0 };
    const kept = [];
    for (const f of sources.files || []) {
      const group = excludedBy(f.path, attributes, projectRes, defaultRes);
      if (group) excluded[group]++;
      else kept.push(f);
    }
    const files = kept.map((f) => f.path);
    const walked = walkHistory(parseLog(sources.log), files, sources.ignoreRevs || []);
    const massLimit = Math.max(files.length * MASS_SHARE, MASS_MIN_FILES - 1);
    const mass_changes = walked.filter((c) => c.targets.length > massLimit && !c.ignored && inWindow(c.date, window))
      .map((c) => ({ commit: c.hash, date: c.date, files: c.targets.length }));
    const massSet = new Set(mass_changes.map((m) => m.commit));
    const includeMass = sources.includeMass !== false;
    const counted = walked.filter((c) => !c.ignored && inWindow(c.date, window) && (includeMass || !massSet.has(c.hash)));
    const { commits, last } = countCommits(counted, files, () => true);
    const pairs = coChangePairs(counted.filter((c) => !massSet.has(c.hash)), commits);
    const rows = kept.map((f) => ({
      file: f.path, lines: f.lines, language: languageOf(f.path), commits: commits[f.path], last_change: last[f.path] || null,
      hotspot: f.lines * commits[f.path], rank: 0, co_change: null, complexity: null, worst: null, functions: null, quadrant: null, score: null,
    }));
    rows.sort((a, b) => b.hotspot - a.hotspot || a.file.localeCompare(b.file)).forEach((r, i) => { r.rank = i + 1; });
    for (const r of rows) {
      const top = pairs.find((p) => p.a === r.file || p.b === r.file);
      if (top) r.co_change = { file: top.a === r.file ? top.b : top.a, share: top.share };
    }
    const languages = languageLines(rows);
    let frames = [];
    let danger_zone = [];
    if (sources.complexity && Array.isArray(sources.complexity.functions)) {
      const measured = measuredRows(rows, sources.complexity.functions, sources.complexity.files);
      placeQuadrants(measured);
      danger_zone = measured.filter((r) => r.quadrant === QUADRANTS[0]).sort(byHotness).map((r) => ({ file: r.file, score: r.score }));
      frames = dangerFrames(measured, counted);
    }
    const complexity = complexityStatus(sources.complexity, rows);
    return sortKeys({
      branch: sources.branch || null,
      commits: counted.length,
      complexity,
      danger_zone,
      excluded,
      files: rows,
      frames,
      head: sources.head || null,
      include_mass: includeMass,
      languages,
      mass_changes,
      pairs,
      shallow: !!sources.shallow,
      window,
    });
  }

  const api = {
    buildModel,
    byHotness,
    byScore,
    checkComplexity,
    countCommits,
    DEFAULT_EXCLUDES,
    globRe,
    languageOf,
    median,
    parseIgnoreRevs,
    parseLog,
    placeQuadrants,
    QUADRANTS,
    scoreRows,
    sortKeys,
    walkHistory,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ArchitectureModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
