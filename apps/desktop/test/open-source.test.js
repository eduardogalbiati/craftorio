// Acceptance tests for #314 (open source under MIT: license, notices, contributor files, no personal
// data, CI safe for forks) and #315 (no trial: the account only counts users). These checks read
// the repository's files (LICENSE, package.json, README, the CI workflow, the Supabase migrations,
// the renderer, the skills and workflows); nothing here starts the app or a run.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..', '..', '..');
const abs = (p) => path.join(root, p);
const exists = (p) => fs.existsSync(abs(p));
const read = (p) => fs.readFileSync(abs(p), 'utf8');
// whitespace (line wraps) collapsed, to match prose that may be wrapped anywhere
const flat = (s) => s.replace(/\s+/g, ' ');
const pkg = () => JSON.parse(read('package.json'));

// every file under a folder (relative to the root, posix separators)
const walk = (dir) => {
  if (!exists(dir)) return [];
  return fs.readdirSync(abs(dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(rel) : [rel];
  });
};

// The README section under a `## ` heading, up to the next one (null if missing).
function readmeSection(match) {
  const parts = read('README.md').split(/^(?=## )/m);
  return parts.find((p) => match.test(p.split('\n')[0])) || null;
}

const MIT_PERMISSION = 'Permission is hereby granted, free of charge, to any person obtaining a copy';
const MIT_WARRANTY = 'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND';

// ---- #314: license and package metadata --------------------------------------------------------

test('#314: LICENSE at the root is the MIT License, Copyright (c) 2026 Eduardo Galbiati, with the standard text', () => {
  assert.ok(exists('LICENSE'), 'LICENSE exists');
  const text = flat(read('LICENSE'));
  assert.match(text, /MIT License/);
  assert.ok(text.includes('Copyright (c) 2026 Eduardo Galbiati'), 'copyright line');
  assert.ok(text.includes(MIT_PERMISSION), 'permission notice');
  assert.ok(text.includes('The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.'), 'notice condition');
  assert.ok(text.includes(MIT_WARRANTY), 'warranty disclaimer');
});

test('#314: package.json declares MIT, the author, the public repository, homepage and bugs, and stays private (not published to npm)', () => {
  const p = pkg();
  assert.equal(p.license, 'MIT');
  assert.ok(p.author, 'author');
  assert.equal(typeof p.repository === 'object' ? p.repository.url : p.repository, 'git+https://github.com/eduardogalbiati/multiagent-orchestrator.git');
  assert.ok(p.homepage, 'homepage');
  assert.ok(p.bugs, 'bugs');
  assert.equal(p.private, true);
});

test('#314: package.json description names the three CLIs: Claude Code, Codex CLI, Grok Build', () => {
  const d = pkg().description || '';
  for (const cli of ['Claude Code', 'Codex CLI', 'Grok Build']) assert.ok(d.includes(cli), cli);
});

// apps/desktop/scripts/package.js runs the packager when required (no exports): its `ignore` list is read from
// the source and evaluated. Guard: today's list already keeps both files; the change must not drop them.
test('#314: the packaged app keeps LICENSE and THIRD_PARTY_NOTICES.md (apps/desktop/scripts/package.js ignore)', () => {
  const src = read('apps/desktop/scripts/package.js');
  // the list may span lines (comments between the entries are fine: the source is evaluated as JS)
  const m = src.match(/ignore:\s*(\[[\s\S]*?\n\s*\]|\[[^\n]*\])/);
  assert.ok(m, 'apps/desktop/scripts/package.js has an `ignore: [...]` list');
  // eslint-disable-next-line no-new-func
  const ignore = new Function(`return ${m[1]};`)();
  for (const file of ['/LICENSE', '/THIRD_PARTY_NOTICES.md']) {
    const hit = ignore.find((re) => (re instanceof RegExp ? re.test(file) : String(re) === file));
    assert.equal(hit, undefined, `${file} is ignored by ${hit}`);
  }
});

// ---- #314: third-party notices -------------------------------------------------------------------

test('#314: THIRD_PARTY_NOTICES.md credits the MIT sources with their copyright lines and the MIT notice', () => {
  assert.ok(exists('THIRD_PARTY_NOTICES.md'), 'THIRD_PARTY_NOTICES.md exists');
  const text = flat(read('THIRD_PARTY_NOTICES.md'));
  for (const s of ['cursor/plugins', 'pstack', 'Copyright (c) 2026 Lauren Tan', 'cursor-team-kit', 'Copyright (c) 2026 Cursor', 'mattpocock/skills', 'Copyright (c) 2026 Matt Pocock', MIT_PERMISSION]) {
    assert.ok(text.includes(s), s);
  }
});

test('#314: THIRD_PARTY_NOTICES.md lists the references the writing skills follow: MADR, Design Docs at Google, Rust RFC, ISO/IEC/IEEE 29119-3', () => {
  const text = flat(read('THIRD_PARTY_NOTICES.md'));
  for (const s of ['MADR', 'Design Docs at Google', 'Rust RFC', 'ISO/IEC/IEEE 29119-3']) assert.ok(text.includes(s), s);
});

// What counts as "adapted from an MIT project": a bundled skill (any .md in its folder) or workflow
// whose text says "adapted from" / "inspired by" (any case) AND names the MIT license (the word
// "MIT", case-sensitive). Skills adapted from non-MIT references (MADR, Design Docs at Google, the
// Rust RFC template, ISO 29119-3) never say MIT, so they are left to the test above.
function mitAdaptations() {
  const says = (t) => /adapted from|inspired by/i.test(t) && /\bMIT\b/.test(t);
  const skills = new Set();
  for (const f of walk('skills').filter((x) => x.endsWith('.md'))) {
    if (says(read(f))) skills.add(f.split('/')[1]);
  }
  const workflows = walk('workflows').filter((f) => /\.ya?ml$/.test(f) && says(read(f))).map((f) => path.posix.basename(f));
  return { skills: [...skills].sort(), workflows: workflows.sort() };
}

test('#314: every skill or workflow adapted from an MIT project is named in THIRD_PARTY_NOTICES.md', () => {
  const notices = exists('THIRD_PARTY_NOTICES.md') ? read('THIRD_PARTY_NOTICES.md') : '';
  const { skills, workflows } = mitAdaptations();
  // the ones known when #314 was written: the detection must keep finding them
  for (const s of ['arena-synthesis', 'blast-radius', 'bug-diagnosis', 'claim-verification', 'decision-log', 'design-sketch', 'merge-conflict-resolver', 'pr-description', 'review-synthesis', 'run-retrospective']) {
    assert.ok(skills.includes(s), `detected skill ${s}`);
  }
  for (const w of ['multi-model-review.yaml', 'run-retrospective.yaml']) assert.ok(workflows.includes(w), `detected workflow ${w}`);
  const missing = [
    ...skills.filter((s) => !new RegExp(`(^|[^\\w-])${s}([^\\w-]|$)`).test(notices)),
    ...workflows.filter((w) => !notices.includes(w)),
  ];
  assert.deepEqual(missing, [], 'adapted from an MIT project but not in THIRD_PARTY_NOTICES.md');
});

// ---- #314: contributor files ---------------------------------------------------------------------

test('#314: CONTRIBUTING.md explains the setup and the checks (.nvmrc, npm install, npm start, MULTIAGENT_AUTH=off, npm test, AGENTS.md, docs/agents)', () => {
  assert.ok(exists('CONTRIBUTING.md'), 'CONTRIBUTING.md exists');
  const text = read('CONTRIBUTING.md');
  for (const s of ['.nvmrc', 'npm install', 'npm start', 'MULTIAGENT_AUTH=off', 'npm test', 'AGENTS.md', 'docs/agents']) assert.ok(text.includes(s), s);
  // #331: the agents' instructions are AGENTS.md; CONTRIBUTING links it, not CLAUDE.md
  assert.ok(text.includes('](AGENTS.md)'), 'CONTRIBUTING.md does not link AGENTS.md');
  assert.equal(text.includes('](CLAUDE.md)'), false, 'CONTRIBUTING.md still links CLAUDE.md');
});

test('#314: SECURITY.md sends vulnerabilities to GitHub\'s private vulnerability reporting ("Report a vulnerability")', () => {
  assert.ok(exists('SECURITY.md'), 'SECURITY.md exists');
  const text = flat(read('SECURITY.md'));
  assert.match(text, /private vulnerability reporting/i);
  assert.match(text, /Report a vulnerability/);
});

test('#314: CODE_OF_CONDUCT.md is the Contributor Covenant 2.1', () => {
  assert.ok(exists('CODE_OF_CONDUCT.md'), 'CODE_OF_CONDUCT.md exists');
  const text = flat(read('CODE_OF_CONDUCT.md'));
  assert.match(text, /Contributor Covenant/);
  assert.match(text, /\b2\.1\b/);
});

test('#314: issue templates (bug report, feature request, config with blank issues) and a PR template exist', () => {
  for (const f of ['.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/feature_request.yml', '.github/ISSUE_TEMPLATE/config.yml', '.github/pull_request_template.md']) {
    assert.ok(exists(f), f);
  }
  for (const f of ['bug_report.yml', 'feature_request.yml']) {
    const form = yaml.load(read(`.github/ISSUE_TEMPLATE/${f}`));
    assert.ok(form && form.name && Array.isArray(form.body), `${f} is an issue form (name, body)`);
  }
  assert.equal(yaml.load(read('.github/ISSUE_TEMPLATE/config.yml')).blank_issues_enabled, true);
});

test('#314: the bug report asks for the version, OS, CLI versions, steps, expected, actual and the run id', () => {
  const text = read('.github/ISSUE_TEMPLATE/bug_report.yml');
  const asks = {
    version: /version/i,
    OS: /\bOS\b|operating system/i,
    'CLI versions': /CLI[^\n]*version|version[^\n]*CLI/i,
    steps: /steps/i,
    expected: /expected/i,
    actual: /actual/i,
    'run id': /run[ _-]?id/i,
  };
  for (const [what, re] of Object.entries(asks)) assert.match(text, re, what);
});

// ---- #314: no personal data in the public repository --------------------------------------------

test('#314: no tracked source or test file (packages/, apps/, test/) has the owner\'s GitHub alias or Windows user folder', () => {
  // built from pieces so this file never matches itself
  const alias = new RegExp(['Ca', 'zeh'].join(''), 'i');
  const userDir = new RegExp(`Users[\\\\/]+${['Edu', 'ardo'].join('')}\\b`, 'i');
  const files = execFileSync('git', ['ls-files', '-z', '--', 'packages', 'apps', 'test'], { cwd: root }).toString().split('\0').filter(Boolean);
  assert.ok(files.length > 100, 'git ls-files lists the tracked files');
  const hits = files.filter((f) => {
    let text;
    try { text = fs.readFileSync(abs(f), 'utf8'); } catch { return false; }
    return alias.test(text) || userDir.test(text);
  });
  assert.deepEqual(hits, []);
});

test('#314: the Product Owner\'s enrich-first link no longer points at the owner\'s repository issues', () => {
  const productOwner = require('@multiagent/engine/domains/po/product-owner');
  const issues = [{ number: 3, state: 'open', title: 'C', labels: [], body: 'short' }];
  const out = productOwner.normalizeAnswer({ summary: 'ok', groups: [], conflicts: [], enrich: [{ issue: 3, reason: 'too short' }] }, { issues, history: [], workflows: [{ file: 'software-development.yaml' }] });
  assert.deepEqual(out.enrich.map((e) => e.issue), [3]);
  assert.doesNotMatch(String(out.enrich[0].link ?? ''), /eduardogalbiati\/multiagent-orchestrator\/issues/);
  assert.doesNotMatch(read('packages/engine/domains/po/product-owner.js'), /github\.com\/eduardogalbiati\/multiagent-orchestrator\/issues/);
});

test('#314: docs/agents/environment.md no longer says the repository is private', () => {
  assert.doesNotMatch(read('docs/agents/environment.md'), /(repo|repository) is private|private (repo|repository)\b/i);
});

// ---- #314: README and CI for a public repository --------------------------------------------------

test('#314: README, the CI workflow header and scripts/ci-plan.js no longer say the repository is private', () => {
  assert.doesNotMatch(read('README.md'), /(repo|repository) is private|\(private repo/i, 'README.md');
  const ciHeader = read('.github/workflows/ci.yml').split(/^on:/m)[0];
  assert.doesNotMatch(ciHeader, /private repo/i, 'ci.yml header');
  assert.doesNotMatch(read('scripts/ci-plan.js').split('\n')[0], /private/i, 'scripts/ci-plan.js line 1');
});

test('#314: README has a License section linking LICENSE and THIRD_PARTY_NOTICES.md, and a Contributing section', () => {
  const license = readmeSection(/^## License\b/);
  assert.ok(license, '## License');
  assert.match(license, /\]\((\.\/)?LICENSE\)/, 'links LICENSE');
  assert.match(license, /\]\((\.\/)?THIRD_PARTY_NOTICES\.md\)/, 'links THIRD_PARTY_NOTICES.md');
  assert.ok(readmeSection(/^## Contributing\b/), '## Contributing');
});

test('#314: README or the CI workflow says standard GitHub-hosted runners are free for public repositories', () => {
  const text = flat(`${read('README.md')}\n${read('.github/workflows/ci.yml')}`);
  assert.match(text, /free for public repositor/i);
});

test('#314: every CI step that records a commit status (ci-plan.js report) is skipped on PRs from forks', () => {
  const ci = yaml.load(read('.github/workflows/ci.yml'));
  const steps = Object.entries(ci.jobs).flatMap(([job, j]) => (j.steps || []).map((s) => ({ job, ...s })));
  const reports = steps.filter((s) => /ci-plan\.js report/.test(s.run || ''));
  assert.ok(reports.length >= 2, 'the plan and test jobs both report');
  for (const s of reports) {
    assert.ok(String(s.if || '').includes('github.event.pull_request.head.repo.full_name == github.repository'), `${s.job} › ${s.name || s.run}: if: ${s.if}`);
  }
});

// ---- #315: the account only counts users ----------------------------------------------------------

test('#315: no source (src/, the workspaces, scripts/) consults an account gate (assertCanRun): main, serve, service and its areas', () => {
  const files = require('../../../scripts/source-tree').sourceFiles(root, { scripts: true, match: /\.(js|mjs|cjs)$/ });
  const hits = files.filter((f) => /assertCanRun/.test(read(f)));
  assert.deepEqual(hits, []);
});

function newMigration() {
  const dir = 'supabase/migrations';
  const files = (exists(dir) ? fs.readdirSync(abs(dir)) : [])
    .filter((f) => /^\d{14}_.*\.sql$/.test(f) && Number(f.slice(0, 14)) > 20260928000000)
    .sort();
  return files.length ? `${dir}/${files[files.length - 1]}` : null;
}

test('#315: a new Supabase migration (newer than 20260928000000) says how to apply it', () => {
  const file = newMigration();
  assert.ok(file, 'a migration newer than 20260928000000_accounts_trial.sql');
  const head = read(file).split(/\r?\n/).slice(0, 6).join('\n');
  assert.ok(head.includes('Apply once: Supabase dashboard > SQL Editor > paste this file > Run'), head);
});

test('#315: the migration adds last_seen_at, app_version and platform, creates touch_account (security definer) and drops entitlement()', () => {
  const file = newMigration();
  assert.ok(file, 'a new migration');
  const sql = read(file).split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
  for (const col of ['last_seen_at', 'app_version', 'platform']) assert.match(sql, new RegExp(`\\b${col}\\b`), col);
  assert.match(sql, /create\s+(or\s+replace\s+)?function\s+(public\.)?touch_account\b/i);
  assert.match(sql, /security\s+definer/i);
  assert.match(sql, /drop\s+function\s+(if\s+exists\s+)?(public\.)?entitlement\s*\(\s*\)/i);
});

test('#315: the migration ends with a commented query counting the users of the last 7 and 30 days', () => {
  const file = newMigration();
  assert.ok(file, 'a new migration');
  const lines = read(file).split(/\r?\n/);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const tail = [];
  while (lines.length && /^\s*--/.test(lines[lines.length - 1])) tail.unshift(lines.pop());
  const comment = tail.join('\n');
  assert.match(comment, /select/i, 'a query');
  assert.match(comment, /\b7\b[^\n]*day|day[^\n]*\b7\b/i, 'last 7 days');
  assert.match(comment, /\b30\b[^\n]*day|day[^\n]*\b30\b/i, 'last 30 days');
});

test('#315: the sign-in screen has no trial and says the account only counts how many people use the app', () => {
  const html = read('apps/desktop/renderer/index.html');
  assert.doesNotMatch(html, /id="account-trial"/);
  assert.doesNotMatch(html, /7-day|\btrial\b/i);
  assert.match(flat(html), /how many people use/i);
});

test('#315: no renderer file mentions a trial (account.js, style.css .pill-trial, any other)', () => {
  const hits = walk('apps/desktop/renderer')
    .filter((f) => /\.(js|mjs|html|css|json|md)$/.test(f))
    .filter((f) => /\btrials?\b/i.test(read(f)));
  assert.deepEqual(hits, []);
});

test('#315: the README account section tells what is stored and what is not, and MULTIAGENT_AUTH=off', () => {
  // the section (under any `## ` heading) that holds the privacy note: it names "last seen"
  const section = read('README.md').split(/^(?=## )/m).find((p) => /last seen/i.test(p));
  assert.ok(section, 'a README section with the account\'s privacy note (what is stored: ... last seen ...)');
  const text = flat(section);
  for (const [what, re] of Object.entries({
    email: /e-?mail/i, name: /\bname\b/i, 'last seen': /last seen/i, 'app version': /app version/i, OS: /\bOS\b|operating system/i,
  })) assert.match(text, re, `stored: ${what}`);
  for (const [what, re] of Object.entries({ code: /\bcode\b/i, prompts: /\bprompts?\b/i, runs: /\bruns?\b/i })) assert.match(text, re, `not stored: ${what}`);
  assert.match(text, /not store|never store|does not (keep|send|store)|nothing (else|of your)/i, 'says what is not stored');
  assert.ok(text.includes('MULTIAGENT_AUTH=off'), 'MULTIAGENT_AUTH=off');
});

test('#315: scripts/docs.js no longer describes the migrations as "trial and plan"', () => {
  assert.doesNotMatch(read('scripts/docs.js'), /trial and plan/i);
});

// ---- #471: the honest threat model (README "Security model", SECURITY.md "Scope") ----------------

test('#471: README has a "Security model" section that says what the engine does and does not enforce', () => {
  const section = readmeSection(/^## Security model\b/);
  assert.ok(section, '## Security model');
  const text = flat(section);
  const says = {
    'agents run as the user': /run as (you|the user)/i,
    'with the environment, credentials and network': /environment[^.]*credentials[^.]*network|credentials[^.]*environment[^.]*network/i,
    'only Codex\'s sandbox is OS-enforced': /only Codex[^.]*sandbox[^.]*(OS|operating system)|Codex[^.]*sandbox[^.]*only[^.]*(OS|operating system)/i,
    'Claude and Grok limits are prefix rules': /prefix rules/i,
    'an allowed program steps around them': /step(s)? around|get(s)? around|bypass/i,
    'the repository can add instructions (CLAUDE.md, AGENTS.md)': /CLAUDE\.md[^.]*AGENTS\.md|AGENTS\.md[^.]*CLAUDE\.md/,
    'issues and PR comments are instructions too': /issues?[^.]*(PR|pull request) comments?/i,
    'hooks until #468': /hooks[^.]*#468|#468[^.]*hooks/i,
    'workflows, skills and seeds are code': /workflows, skills and seeds are code/i,
    'the serve token is full control of the machine': /token[^.]*full control of the machine/i,
    'the control endpoint file is readable by agents': /endpoint\.json/,
    'recommendation: VM, container or Codex\'s sandbox': /\bVM\b[^.]*container[^.]*Codex/i,
    'every secret in the environment is readable (until #470)': /secret[^.]*readable[^.]*#470|#470[^.]*secret/i,
  };
  for (const [what, re] of Object.entries(says)) assert.match(text, re, what);
});

test('#471: README "Agent capabilities and isolation" no longer promises enforcement or full isolation, and calls it context economy, not a security boundary', () => {
  const parts = read('README.md').split(/^(?=##+ )/m);
  const sub = parts.find((p) => /^###? Agent capabilities and isolation\b/.test(p.split('\n')[0]));
  assert.ok(sub, '### Agent capabilities and isolation');
  const text = flat(sub);
  assert.doesNotMatch(text, /enforced by the engine/i, 'says "enforced by the engine"');
  assert.doesNotMatch(text, /isolates fully/i, 'says "isolates fully"');
  assert.match(text, /not a security boundary/i, 'says it is not a security boundary');
  assert.match(text, /context economy/i, 'says it is context economy');
  assert.doesNotMatch(flat(read('README.md')), /isolates fully|enforced by the engine/i, 'anywhere in the README');
});

test('#471: SECURITY.md has a "Scope" section: acting outside the run\'s worktree without the owner\'s click is a vulnerability, the documented model is not', () => {
  const parts = read('SECURITY.md').split(/^(?=## )/m);
  const scope = parts.find((p) => /^## Scope\b/.test(p.split('\n')[0]));
  assert.ok(scope, '## Scope');
  const text = flat(scope);
  assert.match(text, /vulnerabilit/i, 'says which reports are vulnerabilities');
  assert.match(text, /outside the run'?s worktree/i, 'acting outside the run\'s worktree');
  assert.match(text, /without the owner'?s (click|approval)/i, 'without the owner\'s click');
  assert.match(text, /documented (security |threat )?model/i, 'what the documented model is');
  assert.match(text, /README(\.md)?[^)]*#security-model|Security model/i, 'points to the README Security model');
});

// ---- #482: open-source readiness ----------------------------------------------------------------

test('#482: README has a trademark note: not affiliated with Anthropic, OpenAI or xAI; users answer for each CLI\'s terms and costs', () => {
  const text = flat(read('README.md'));
  assert.match(text, /not affiliated with Anthropic, OpenAI,? (or|and) xAI/i, 'not affiliated');
  assert.match(text, /Claude Code, Codex,? and Grok are (their )?(trade)?marks|trademarks? of/i, 'the marks');
  assert.match(text, /responsible for[^.]*terms[^.]*costs|terms[^.]*costs[^.]*responsib/i, 'terms and costs');
});

test('#482: README "Account and privacy" tells a fork to use its own Supabase project and says how long data is kept and how to delete it', () => {
  const section = readmeSection(/^## Account and privacy\b/);
  assert.ok(section, '## Account and privacy');
  const text = flat(section);
  assert.match(text, /fork[^.]*own Supabase project|own Supabase project[^.]*fork/i, 'a fork needs its own Supabase project');
  assert.match(text, /retain|retention|kept (for|until)|keeps? [^.]*(for|until)/i, 'retention');
  assert.match(text, /delet/i, 'deletion');
});

test('#482: the icon is no longer a placeholder: THIRD_PARTY_NOTICES.md states the origin and license of apps/desktop/assets/icon-source.png', () => {
  assert.doesNotMatch(flat(read('README.md')), /icon-source\.png`?,? which is a placeholder/i, 'README still says placeholder');
  const notices = flat(read('THIRD_PARTY_NOTICES.md'));
  assert.ok(notices.includes('icon-source.png'), 'THIRD_PARTY_NOTICES.md names apps/desktop/assets/icon-source.png');
  const around = notices.slice(Math.max(0, notices.indexOf('icon-source.png') - 400), notices.indexOf('icon-source.png') + 400);
  assert.match(around, /licen[cs]e|public domain|CC0|CC BY/i, 'its license');
});

test('#482: THIRD_PARTY_NOTICES.md covers the shipped npm libraries: a production license file in resources/, dompurify\'s dual license', () => {
  const notices = flat(read('THIRD_PARTY_NOTICES.md'));
  assert.doesNotMatch(notices, /are not listed here/i, 'still says the npm libraries are not listed');
  assert.match(notices, /dompurify[^|]*Apache-2\.0 OR MPL-2\.0|Apache-2\.0 OR MPL-2\.0[^|]*dompurify/i, 'dompurify (Apache-2.0 OR MPL-2.0)');
  const m = notices.match(/resources\/[\w.-]+/);
  assert.ok(m, 'names the license file under resources/');
  assert.ok(exists(m[0]), `${m[0]} exists`);
  const licenses = read(m[0]);
  for (const lib of ['three', 'react', 'dompurify']) assert.match(licenses, new RegExp(`\\b${lib}\\b`), `${m[0]} lists ${lib}`);
});

test('#482: CODE_OF_CONDUCT.md has a confidential email contact and the full Contributor Covenant text', () => {
  const text = flat(read('CODE_OF_CONDUCT.md'));
  assert.match(text, /[\w.+-]+@[\w-]+(\.[\w-]+)+/, 'an email address');
  for (const heading of ['Our Pledge', 'Our Standards', 'Enforcement Responsibilities', 'Enforcement Guidelines', 'Attribution']) {
    assert.ok(text.includes(heading), heading);
  }
});

// #489 replaced "never on a push to main": a push to main publishes a prerelease vX.Y.Z-rc.N (never
// --latest, test/deploy-workflow-489.test.js), a vX.Y.Z tag promotes it; the -build.<n> tags stay gone.
test('#482/#489: Deploy releases on a tag or a manual dispatch, a push to main only as a prerelease, and tags as vX.Y.Z or vX.Y.Z-rc.N', () => {
  const wf = yaml.load(read('.github/workflows/deploy.yml'));
  const on = wf.on || {};
  assert.ok('workflow_dispatch' in on && on.push && on.push.tags, 'on a tag and workflow_dispatch');
  const text = read('.github/workflows/deploy.yml');
  assert.doesNotMatch(text, /-build\./, 'release tags still v<version>-build.<n>');
});

test('#482: .github/dependabot.yml updates npm, cargo and github-actions weekly', () => {
  assert.ok(exists('.github/dependabot.yml'), '.github/dependabot.yml');
  const cfg = yaml.load(read('.github/dependabot.yml'));
  assert.equal(cfg.version, 2);
  const updates = cfg.updates || [];
  for (const eco of ['npm', 'cargo', 'github-actions']) {
    const entries = updates.filter((u) => u['package-ecosystem'] === eco);
    assert.ok(entries.length > 0, `${eco} entry`);
    for (const u of entries) assert.equal(u.schedule && u.schedule.interval, 'weekly', `${eco} ${u.directory}: weekly`);
  }
});

test('#482: a CODEOWNERS file gives every path to @eduardogalbiati', () => {
  const file = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'].find(exists);
  assert.ok(file, 'CODEOWNERS');
  assert.match(read(file), /^\*\s+@eduardogalbiati\b/m);
});

test('#482: CONTRIBUTING.md names the good first issue and help wanted labels, has a Releasing section and points to a changelog', () => {
  const text = read('CONTRIBUTING.md');
  assert.match(text, /good first issue/i, 'good first issue');
  assert.match(text, /help wanted/i, 'help wanted');
  assert.match(text, /^##+ Releasing\b/m, 'Releasing section');
  assert.ok(exists('CHANGELOG.md') || /GitHub Releases|\/releases\b/i.test(text), 'a CHANGELOG.md or a pointer to GitHub Releases');
});

test('#482: an environment-variable table (CONTRIBUTING.md or docs/agents/environment.md) lists the variables a contributor sets', () => {
  const rows = ['CONTRIBUTING.md', 'docs/agents/environment.md'].filter(exists)
    .flatMap((f) => read(f).split('\n')).filter((l) => l.trim().startsWith('|'));
  const vars = ['MULTIAGENT_AUTH', 'MULTIAGENT_SUPABASE_URL', 'MULTIAGENT_SUPABASE_KEY', 'MULTIAGENT_WORKSPACE', 'MULTIAGENT_USER_DATA', 'MULTIAGENT_SIMULATION_ONLY', 'MULTIAGENT_SERVER_TOKEN', 'MULTIAGENT_E2E_WORKERS'];
  const missing = vars.filter((v) => !rows.some((r) => new RegExp(`\\b${v}\\b`).test(r)));
  assert.deepEqual(missing, [], 'variables without a table row');
});

test('#482: docs/ARCHITECTURE.md describes the engine, the service, the renderer and the native sidecars, and CONTRIBUTING.md links it', () => {
  assert.ok(exists('docs/ARCHITECTURE.md'), 'docs/ARCHITECTURE.md');
  const text = flat(read('docs/ARCHITECTURE.md'));
  for (const part of [/\bengine\b/i, /\bservice\b/i, /\brenderer\b/i, /sidecar/i]) assert.match(text, part, String(part));
  assert.match(read('CONTRIBUTING.md'), /\]\((\.\/)?docs\/ARCHITECTURE\.md\)/, 'CONTRIBUTING.md links docs/ARCHITECTURE.md');
});

test('#482: the bug report no longer suggests the old version 0.3.0', () => {
  const form = yaml.load(read('.github/ISSUE_TEMPLATE/bug_report.yml'));
  const placeholders = (form.body || []).map((b) => String((b.attributes && b.attributes.placeholder) || ''));
  assert.equal(placeholders.some((p) => /\b0\.3\.0\b/.test(p)), false);
});

test('#482: no tracked file under scripts/, docs/, workflows/ or skills/ has the owner\'s alias or Windows user folder, and screenshot fixtures do not use the owner\'s first name as author', () => {
  // built from pieces so this file never matches itself
  const alias = new RegExp(['Ca', 'zeh'].join(''), 'i');
  const first = ['edu', 'ardo'].join('');
  const userDir = new RegExp(`Users[\\\\/]+${first}\\b`, 'i');
  const nameLiteral = new RegExp(`['"\`]${first}['"\`]`);
  const files = execFileSync('git', ['ls-files', '-z', '--', 'scripts', 'docs', 'workflows', 'skills'], { cwd: root }).toString().split('\0').filter(Boolean);
  assert.ok(files.length > 50, 'git ls-files lists the tracked files');
  const hits = files.filter((f) => {
    let text;
    try { text = fs.readFileSync(abs(f), 'utf8'); } catch { return false; }
    return alias.test(text) || userDir.test(text) || (f.startsWith('scripts/') && nameLiteral.test(text));
  });
  assert.deepEqual(hits, []);
});
