// Steps of fronts/analyser/features/architecture.feature (#356, #381): a project's Architecture tab, its git facts
// (the hotspot table), the one action "Analyze this project" with its cost estimate (the project map
// run with the Oracle's analysis as its last step, no gate), a saved report (summary, findings marked
// new/gone, "Send to Refactor"), and its states. Locators are roles and data-testid only
// (skills/ui-conventions).
//
// What the tab exposes (the renderer's contract for these steps, fronts/analyser/views/project/):
// - #project-panel-architecture holds the tab; data-testid="architecture-state-not-git" /
//   "architecture-state-never" / ...: the tab's states;
// - data-testid="architecture-analyze": the "Analyze this project" button, its text or title has
//   the estimate "≈ US$" (or "no estimate yet" before the first real run); a click starts the run
//   at once (run:start, project-map.yaml), seen in the scratch workspace's runs/ folder (its records
//   name the project-map workflow); "architecture-analyzing": the run in progress with its step,
//   gone once it ends; "architecture-map-refresh-advised": the refresh advice (> 5% of the drawn
//   files match no district, or a new top-level folder), which starts nothing;
// - data-testid="architecture-report-summary", "architecture-findings" (rows "architecture-finding",
//   each with its "new"/"gone" mark and its "architecture-send-refactor" control);
// - data-testid="architecture-hotspots": the hotspot table; "architecture-limits": what the numbers
//   cannot tell.
// - The project city (#373): the "Facts | City" switch, buttons data-testid="architecture-mode-facts"
//   / "architecture-mode-city" named "Facts" / "City" with aria-pressed; data-testid="project-city"
//   (a canvas inside), "project-city-header" (project, "<n> files", "<n> zones", "<n> districts"),
//   the select labelled "Colour by" and its legend "project-city-legend"; without a plan
//   "project-city-no-plan" holds the "Analyze this project" button and its "≈ US$" estimate;
//   "project-city-expand" (#381) expands the city over the whole window (the `expanded` class on
//   "project-city", aria-pressed) and closes it again, as Esc does.
// - The agents on the city (#374): data-testid="city-agents", the agents HUD of the City view ("No
//   agent is working on this project" with no run in progress of the project); one
//   data-testid="city-agent" per agent, its text "<agent> · <step>"; data-testid="city-collision" per
//   building two runs in progress change (its path) with a data-testid="conflict-map-link" link.
//   A run in progress is seeded as one in "another app" (scripts/screenshot/views/roadmap.js
//   demoRoadmapRuns): runs/<id>/events.jsonl without summary.json, owner.json of another host whose
//   heartbeat this process keeps fresh; its events: workflow.started (project_id), worktree.ready
//   (a worktree folder in the scratch folder), step.started, session.opened, then session.stream
//   with an Edit tool call on <worktree>/<file>.
// - An issue's impact preview (#375): data-testid="show-on-map" ("Show on the map") on a Backlog
//   issue row (or in its ⋯ menu) and on a roadmap item; "show-stage-on-map" ("Show the stage on the
//   map") on a roadmap stage. Both open the project's City view with "city-impact-header" (the issue,
//   "<n> files" with the district and zone names, the Danger Zone share in %), the predicted files
//   the repository lacks as list items "<path> … new file, expected in <district>", the stage's
//   items in "project-city-legend" and "city-impact-conflicts" (the paths two items would change).
// - Expected files (#427, #429): a path cited with a line range gives the path; a root name counts only
//   when the repository has it. An issue's "## Expected files" section is the source "Expected files",
//   a legend row (list item of "project-city-legend") with a colour of its own; after a run (a seeded
//   real finished run with no worktree: its diff is the developer's files_changed),
//   "city-impact-comparison" holds "city-impact-by-source" (one list item per hit or miss: path,
//   "hit"/"missed", the source's label) and "city-impact-section-rate" (average hit rate with the
//   section vs without).
// - Complexity per language (#385): the hotspot table has a "Complexity" column whenever one file is
//   measured (JavaScript/TypeScript always, inside the app), a measured file shows a whole number, a
//   file not measured shows no number (never 0); data-testid="architecture-measure-note": which
//   languages are not measured and how to install the tool ("pip install lizard", needs Python), one
//   data-testid="architecture-unmeasured-language" per language, its text the language's name. The
//   #385 scenarios skip themselves when lizard is on this machine (they describe a machine without it).
// - The Facts view for a human reader (#386): the lead row data-testid="architecture-overview" holds
//   "architecture-verdict" (one line), up to 3 "architecture-risk-card" (each an
//   "architecture-risk-score", 0-100), "architecture-danger-count" and "architecture-languages-bar"
//   (segments "architecture-language-segment") with its legend "architecture-language-legend"
//   ("architecture-language-entry", text like "JavaScript 74.3%"). Each "architecture-finding" shows
//   "architecture-finding-score" and "architecture-finding-summary"; its "architecture-finding-details"
//   (evidence, refactor) stay hidden until its "Read more" button "architecture-finding-more".
//   Filters "architecture-filter-high|medium|low|new|kept" (buttons with counts);
//   "architecture-send-all" ("Send all to Refactor") skips findings already sent, its toast says how
//   many went ("Sent 3 findings to the Refactor tab"). The quality gate "architecture-gate" is one row
//   of "architecture-gate-chip"; "architecture-limits" is hidden until the ⓘ button
//   "architecture-caveats" is clicked.
// - Send to Refactor waits for the owner's OK (#435, #447): after the click "architecture-send-refactor"
//   stays a <button class="btn sm">, disabled, its text "Sent to Refactor", its title (tooltip) naming
//   the issue (#<n>) and the stage (stage <m>, waiting for your OK), at the same place and size; next
//   to it, in the same finding line, the link data-testid="architecture-refactor-where" ("#432 · stage
//   117, waiting for your OK"). The finding's new/kept badge is data-testid="architecture-finding-status"
//   (in the interface language). The Refactor tab's row shows data-testid="refactor-proposal-where" with
//   the same words. The roadmap's waiting stage is the last "roadmap-stage", data-disabled="true" with
//   its "roadmap-stage-disabled" badge, its "Stage name" input "Refactor (waiting for your OK)".
//
// The git project is seeded in the scenario's scratch folder after the app opened (like app.steps.js's
// second project): a repository on main with a .js and a .py file and three commits, the project
// entry, and optionally a saved report under <workspace>/architecture/<project id>/<stamp>.json in the
// shape architecture:analyze saves; the app reloads to read the project list again.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');

const root = path.join(__dirname, '..', '..', '..', '..');
const LOAD_TIMEOUT = 30000;
const ANALYSIS_TIMEOUT = 60000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const visible = (locator) => locator.filter({ visible: true });
const projectPage = (page) => visible(page.getByTestId('project-page')).first();
// Where the one visible city is (#430, #556): "Show on the map" opens it in the city modal attached to
// the body (data-testid="city-modal"), over the screen it was asked from; otherwise it is the project's
// Architecture tab. The modal comes last in the document, so it wins when both are shown.
// #730: the Architecture tab is split into the City tab (#project-panel-city) and the Health tab
// (#project-panel-health, the facts); the one shown is the one these steps read.
const tab = (page) => visible(page.locator('[data-testid="city-modal"], [data-testid="project-page"] :is(#project-panel-architecture, #project-panel-city, #project-panel-health)')).last();
const byId = (page, id) => visible(tab(page).getByTestId(id)).first();
const analyzeButton = (page) => tab(page).getByTestId('architecture-analyze');
const cityModeButton = (page, mode) => visible(tab(page).getByTestId(`architecture-mode-${mode.toLowerCase()}`)).first();
const cityBox = (page) => visible(tab(page).getByTestId('project-city')).first();

const SUMMARY = 'Billing rules are split between the API and the export script.';
const FINDING = 'Discount rule duplicated in the API and the export';

// git with a fixed identity and commit date, never the machine's config
function git(cwd, args, date) {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(cwd, '..', 'empty.gitconfig') };
  if (date) Object.assign(env, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, env, encoding: 'utf8' }).trim();
}

const jsBody = (n) => `${['function discount(total) {', '  return total > 100 ? total * 0.9 : total;', '}'].join('\n')}\n${Array.from({ length: n }, (_, i) => `const rate${i} = ${i};`).join('\n')}\nmodule.exports = { discount };\n`;
const pyBody = (n) => `${['def discount(total):', '    return total * 0.9 if total > 100 else total'].join('\n')}\n${Array.from({ length: n }, (_, i) => `RATE_${i} = ${i}`).join('\n')}\n`;

// A git repository on main: src/billing.js and tools/export.py, three commits → its head
function seedRepo(folder) {
  fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
  fs.mkdirSync(path.join(folder, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(folder, '..', 'empty.gitconfig'), '');
  git(folder, ['init', '-q', '-b', 'main']);
  const commit = (message, date, files) => {
    for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(folder, rel), content);
    git(folder, ['add', '-A']);
    git(folder, ['commit', '-q', '-m', message], date);
  };
  commit('Add billing and export', '2026-09-01T10:00:00Z', { 'src/billing.js': jsBody(10), 'tools/export.py': pyBody(5) });
  commit('Change the discount rule', '2026-09-08T10:00:00Z', { 'src/billing.js': jsBody(20), 'tools/export.py': pyBody(8) });
  commit('Grow billing', '2026-09-15T10:00:00Z', { 'src/billing.js': jsBody(30) });
  return { commit: git(folder, ['rev-parse', 'HEAD']), date: '2026-09-15T10:00:00Z' };
}

// #386: a report with findings of each severity: two high, one medium, one low
const SEVERITY_FINDINGS = [
  {
    kind: 'duplicated-rule', title: FINDING, severity: 'high',
    files: [{ path: 'src/billing.js', lines: '1-3' }, { path: 'tools/export.py', lines: '1-2' }],
    evidence: 'Both files apply 10% off above 100.', refactor: 'Keep the rule in one module the export calls.',
  },
  {
    kind: 'hotspot', title: 'Billing module changes in every commit', severity: 'high',
    files: [{ path: 'src/billing.js' }],
    evidence: 'src/billing.js changed in all three commits.', refactor: 'Split the rates out of the discount logic.',
  },
  {
    kind: 'magic-number', title: 'Rates are bare constants', severity: 'medium',
    files: [{ path: 'src/billing.js', lines: '4-33' }],
    evidence: 'Thirty rate constants with no name for what they mean.', refactor: 'Read the rates from one table.',
  },
  {
    kind: 'naming', title: 'Export constants shout', severity: 'low',
    files: [{ path: 'tools/export.py', lines: '3-10' }],
    evidence: 'RATE_0 to RATE_7 repeat the billing rates.', refactor: 'Import the rates from the billing table.',
  },
];
const HIGH_TITLES = SEVERITY_FINDINGS.filter((f) => f.severity === 'high').map((f) => f.title);
const OTHER_TITLES = SEVERITY_FINDINGS.filter((f) => f.severity !== 'high').map((f) => f.title);

// The saved report architecture:analyze writes (contract-356 §3), dated a minute ago
function savedReport(projectId, head, findings = null) {
  const date = new Date(Date.now() - 60000).toISOString();
  const id = date.replace(/[:.]/g, '-');
  return {
    // a real (non-simulated) cost, so the Analyze button has an estimate from it (≈ US$ 0.42)
    id, date, project_id: projectId, costUsd: 0.42, tokens: 12000, simulated: false, head,
    report: {
      summary: SUMMARY,
      areas: [{ area: 'src', verdict: 'The API holds the billing rules.' }, { area: 'tools', verdict: 'The export repeats one of them.' }],
      findings: findings || [{
        kind: 'duplicated-rule', title: FINDING, severity: 'medium',
        files: [{ path: 'src/billing.js', lines: '1-3' }, { path: 'tools/export.py', lines: '1-2' }],
        evidence: 'Both files apply 10% off above 100.', refactor: 'Keep the rule in one module the export calls.',
      }],
    },
  };
}

// A saved city plan (#371's CITY_PLAN_SCHEMA) whose districts cover the given top-level folders
function cityPlan(name, folders) {
  return {
    version: 1, project: name, summary: 'Billing API and its export tools (simulated data).',
    zones: [{ id: 'core', name: 'Core', kind: 'commercial' }, { id: 'tools', name: 'Tools', kind: 'workshop' }],
    districts: folders.map((f) => ({ id: f, name: f, zone: f === 'src' ? 'core' : 'tools', include: [`/${f}/**`] })),
  };
}

// The city plan (#371 CITY_PLAN_SCHEMA) of the seeded repository: two zones, one district each,
// covering both files (no Outskirts)
const CITY_PLAN = {
  version: 1, project: 'billing-service', summary: 'Billing rules and the export script.',
  zones: [{ id: 'backend', name: 'Backend', kind: 'commercial' }, { id: 'tooling', name: 'Tooling', kind: 'workshop' }],
  districts: [
    { id: 'billing', name: 'Billing', zone: 'backend', include: ['src/**'] },
    { id: 'export', name: 'Export', zone: 'tooling', include: ['tools/**'] },
  ],
};

async function seedGitProject(e2e, name, { withReport = false, findings = null, planFolders = null, withPlan = false } = {}) {
  const workspace = require(path.join(root, 'packages', 'engine', 'domains', 'workspace', 'workspace'));
  const projects = require(path.join(root, 'packages', 'engine', 'domains', 'project', 'projects'));
  const arch = require(path.join(root, 'packages', 'engine', 'domains', 'oracle', 'oracle-architecture'));
  const ws = workspace.setupWorkspace(path.join(e2e.scratch, 'workspace'), { persist: false });
  const folder = path.join(e2e.scratch, 'repos', name);
  const head = seedRepo(folder);
  const project = await projects.createProject(ws.projects, { name, folder, description: 'A git project (simulated data)' });
  const dir = path.join(ws.root, 'architecture', project.id);
  if (withReport) {
    const report = savedReport(project.id, head, findings);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${report.id}.json`), JSON.stringify(report, null, 2));
  }
  if (planFolders) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'city-plan.json'), JSON.stringify(cityPlan(name, planFolders), null, 2));
  }
  if (withPlan) arch.writePlan(path.join(ws.root, 'architecture'), project.id, { ...CITY_PLAN, project: name }, new Date().toISOString());
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
}

Given('the workspace has a git project {string} with a JavaScript and a Python file and a saved architecture report', async ({ e2e }, name) => {
  await seedGitProject(e2e, name, { withReport: true });
});

// #386: the same project and report, its findings two high, one medium and one low
Given('the workspace has a git project {string} with a JavaScript and a Python file and a saved architecture report with high, medium and low findings', async ({ e2e }, name) => {
  await seedGitProject(e2e, name, { withReport: true, findings: SEVERITY_FINDINGS });
});

Given('the workspace has a git project {string} with a JavaScript and a Python file and no architecture report', async ({ e2e }, name) => {
  await seedGitProject(e2e, name);
});

Given('the workspace has a git project {string} with a JavaScript and a Python file and no project map', async ({ e2e }, name) => {
  await seedGitProject(e2e, name);
});

// src/billing.js and tools/export.py both match a district: 0% unmatched, no new top-level folder
Given('the workspace has a git project {string} with a JavaScript and a Python file and a project map that covers both files', async ({ e2e }, name) => {
  await seedGitProject(e2e, name, { planFolders: ['src', 'tools'] });
});

// only src/ has a district: tools/export.py (1 of 2 drawn files, 50% > 5%) matches no rule, and
// tools/ is a top-level folder the plan does not know
Given('the workspace has a git project {string} with a JavaScript and a Python file and a project map that only covers the JavaScript file', async ({ e2e }, name) => {
  await seedGitProject(e2e, name, { planFolders: ['src'] });
});

Given('the workspace has a git project {string} with a JavaScript and a Python file and a city plan', async ({ e2e }, name) => {
  await seedGitProject(e2e, name, { withPlan: true });
});

// --- The project city (#373) ---

When('I switch the Architecture tab to {string}', async ({ e2e }, mode) => {
  const button = cityModeButton(e2e.window, mode);
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toHaveAccessibleName(new RegExp(`^\\s*${escapeRe(mode)}\\s*$`, 'i'));
  await button.click();
});

Then('the Architecture tab shows the project city', async ({ e2e }) => {
  const city = byId(e2e.window, 'project-city');
  await expect(city).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(city.locator('canvas').first(), 'the city is drawn in a canvas').toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(byId(e2e.window, 'project-city-header')).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the city header names {string} with {int} files, {int} zones and {int} districts', async ({ e2e }, name, files, zones, districts) => {
  const header = byId(e2e.window, 'project-city-header');
  await expect(header).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(header).toContainText(name, { timeout: LOAD_TIMEOUT });
  for (const [n, word] of [[files, 'files?'], [zones, 'zones?'], [districts, 'districts?']]) {
    await expect(header, `the city header's ${n} ${word}`).toContainText(new RegExp(`\\b${n}\\s+${word}\\b`, 'i'));
  }
});

Then('the city header counts {int} files', async ({ e2e }, files) => {
  const header = byId(e2e.window, 'project-city-header');
  await expect(header).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(header).toContainText(new RegExp(`\\b${files}\\s+files?\\b`, 'i'), { timeout: LOAD_TIMEOUT });
});

When('I colour the city by {string}', async ({ e2e }, option) => {
  const select = visible(tab(e2e.window).getByLabel('Colour by', { exact: true })).first();
  await expect(select).toBeVisible({ timeout: LOAD_TIMEOUT });
  await select.selectOption({ label: option });
});

Then('the city legend lists {string} and {string}', async ({ e2e }, a, b) => {
  const legend = byId(e2e.window, 'project-city-legend');
  await expect(legend).toBeVisible({ timeout: LOAD_TIMEOUT });
  for (const entry of [a, b]) await expect(legend, `the legend's "${entry}"`).toContainText(entry);
});

Then('the {string} view of the Architecture tab is the one selected', async ({ e2e }, mode) => {
  await expect(cityModeButton(e2e.window, mode)).toHaveAttribute('aria-pressed', 'true', { timeout: LOAD_TIMEOUT });
  const other = mode.toLowerCase() === 'city' ? 'Facts' : 'City';
  await expect(cityModeButton(e2e.window, other)).toHaveAttribute('aria-pressed', 'false');
});

Then('the city offers {string} with a cost estimate in US$', async ({ e2e }, label) => {
  const button = visible(tab(e2e.window).getByRole('button', { name: new RegExp(escapeRe(label), 'i') })).first();
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  // the estimate is on the button (text or title) or in the no-plan note that holds it
  const note = byId(e2e.window, 'project-city-no-plan');
  await expect(note).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(note).toContainText(/≈\s*US\$\s*\d/, { timeout: LOAD_TIMEOUT });
});

// --- The agents on the city (#374) ---

let seededRuns = 0;

// A run in progress of the project `name`, in "another app": its agent `agent` of step `step` edited
// `file` (relative to the run's worktree). The heartbeat stops once the scratch folder is removed.
function seedRunInProgress(e2e, name, agent, step, file) {
  const projects = require(path.join(root, 'packages', 'engine', 'domains', 'project', 'projects'));
  const wsDir = path.join(e2e.scratch, 'workspace');
  const project = projects.listProjects(path.join(wsDir, 'projects')).find((p) => p.name === name);
  if (!project) throw new Error(`no project "${name}" in the scratch workspace`);
  seededRuns += 1;
  const now = Date.now();
  const stamp = new Date(now - 10 * 60e3).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const runId = `${stamp}-0e2e37${String(seededRuns).padStart(2, '0')}`;
  const dir = path.join(wsDir, 'runs', runId);
  const worktree = path.join(e2e.scratch, 'worktrees', runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  const workflow = 'software-development';
  const sid = `s-${step}-${seededRuns}`;
  const at = (minutesAgo) => new Date(now - minutesAgo * 60e3).toISOString();
  const events = [
    { ts: at(10), type: 'workflow.started', workflow, file: `${workflow}.yaml`, project_id: project.id, mock: false, inputs: { task: 'Change the discount rule (simulated data)' } },
    { ts: at(9), type: 'worktree.ready', dir: worktree, work_dir: worktree, repo: project.folder, base: 'main', ref: 'main', reused: false, recreated: false },
    { ts: at(8), type: 'step.started', step_id: step, step_type: 'agent', agent },
    { ts: at(8), type: 'session.opened', session_id: sid, step_id: step, session: { agent, step_id: step, provider: 'claude', model: 'claude-opus-5-5' } },
    { ts: at(7), type: 'session.stream', session_id: sid, step_id: step, turn: 1, item: { kind: 'tool_call', name: 'Read', input: { file_path: path.join(worktree, file) } } },
    { ts: at(6), type: 'session.stream', session_id: sid, step_id: step, turn: 1, item: { kind: 'tool_call', name: 'Edit', input: { file_path: path.join(worktree, file), old_string: 'total * 0.9', new_string: 'total * 0.85' } } },
  ];
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e, i) => JSON.stringify({ seq: i + 1, run_id: runId, ...e })).join('\n')}\n`);
  const owner = { pid: 4242, host: 'studio-pc', role: 'run', started_at: at(10) };
  let timer = null;
  const beat = () => {
    try { fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ ...owner, heartbeat_at: new Date().toISOString() })); } catch (e) { if (!timer) throw e; clearInterval(timer); }
  };
  beat();
  timer = setInterval(beat, 5000);
  timer.unref?.();
}

Given('a run in progress of {string} where the {string} agent of step {string} edits {string}', async ({ e2e }, name, agent, step, file) => {
  seedRunInProgress(e2e, name, agent, step, file);
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

const cityAgents = (page) => byId(page, 'city-agents');

Then('the city says {string}', async ({ e2e }, text) => {
  const hud = cityAgents(e2e.window);
  await expect(hud).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(hud).toContainText(text, { timeout: LOAD_TIMEOUT });
  await expect(visible(tab(e2e.window).getByTestId('city-agent'))).toHaveCount(0);
});

Then('the city shows the agent {string}', async ({ e2e }, label) => {
  await expect(cityAgents(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  const entry = visible(tab(e2e.window).getByTestId('city-agent')).filter({ hasText: label });
  await expect(entry, `the city's agent "${label}"`).toHaveCount(1, { timeout: LOAD_TIMEOUT });
  await expect(cityAgents(e2e.window)).not.toContainText('No agent is working on this project');
});

Then('the city does not show the agent {string}', async ({ e2e }, label) => {
  await expect(visible(tab(e2e.window).getByTestId('city-agent')).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(visible(tab(e2e.window).getByTestId('city-agent')).filter({ hasText: label })).toHaveCount(0);
});

Then('the city shows no collision risk', async ({ e2e }) => {
  await expect(visible(tab(e2e.window).getByTestId('city-agent')).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(visible(tab(e2e.window).getByTestId('city-collision'))).toHaveCount(0);
});

Then('the city marks {string} as a collision risk with a link to the Conflict map', async ({ e2e }, file) => {
  const collision = visible(tab(e2e.window).getByTestId('city-collision')).filter({ hasText: file }).first();
  await expect(collision).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(collision.getByTestId('conflict-map-link')).toBeVisible();
});

When('I follow the city\'s link to the Conflict map', async ({ e2e }) => {
  const link = visible(tab(e2e.window).getByTestId('city-collision')).first().getByTestId('conflict-map-link');
  await link.scrollIntoViewIfNeeded();
  await link.click();
});

Then('the Architecture tab says the project folder is not a git repository', async ({ e2e }) => {
  const state = byId(e2e.window, 'architecture-state-not-git');
  await expect(state).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(state).toContainText(/not a git repository/i);
});

Then('the Architecture tab offers no {string} button', async ({ e2e }, label) => {
  await expect(byId(e2e.window, 'architecture-state-not-git')).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(visible(analyzeButton(e2e.window))).toHaveCount(0);
  await expect(visible(tab(e2e.window).getByRole('button', { name: new RegExp(escapeRe(label), 'i') }))).toHaveCount(0);
});

Then('the Architecture tab shows the report summary {string}', async ({ e2e }, text) => {
  const summary = byId(e2e.window, 'architecture-report-summary');
  await expect(summary).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(summary).toContainText(text);
});

Then('the Architecture tab lists the finding {string} marked {string} with a {string} control', async ({ e2e }, title, mark, control) => {
  const findings = byId(e2e.window, 'architecture-findings');
  await expect(findings).toBeVisible({ timeout: LOAD_TIMEOUT });
  const row = findings.getByTestId('architecture-finding').filter({ hasText: title }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText(new RegExp(`\\b${escapeRe(mark)}\\b`, 'i'));
  const send = row.getByTestId('architecture-send-refactor');
  await expect(send).toBeVisible();
  await expect(send).toContainText(new RegExp(escapeRe(control), 'i'));
});

Then('the Architecture hotspot table lists {string} and {string} below the report summary', async ({ e2e }, a, b) => {
  const page = e2e.window;
  const hotspots = byId(page, 'architecture-hotspots');
  await expect(hotspots).toBeVisible({ timeout: LOAD_TIMEOUT });
  for (const file of [a, b]) await expect(hotspots, `the hotspot table's "${file}"`).toContainText(file, { timeout: LOAD_TIMEOUT });
  const summaryBox = await byId(page, 'architecture-report-summary').boundingBox();
  const tableBox = await hotspots.boundingBox();
  expect(tableBox.y, 'the hotspot table comes below the report summary').toBeGreaterThan(summaryBox.y);
});

Then('the Architecture tab says what the numbers cannot tell', async ({ e2e }) => {
  const limits = tab(e2e.window).getByTestId('architecture-limits').first();
  await expect(limits).toBeAttached({ timeout: LOAD_TIMEOUT });
  await expect(limits).not.toBeEmpty();
});

Then('the Architecture tab says the project was never analysed', async ({ e2e }) => {
  await expect(byId(e2e.window, 'architecture-state-never')).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the {string} button shows a cost estimate in US$', async ({ e2e }, label) => {
  const button = analyzeButton(e2e.window);
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toContainText(new RegExp(escapeRe(label), 'i'));
  // the estimate is in its text or its title
  await expect.poll(async () => `${await button.innerText()} ${(await button.getAttribute('title')) || ''}`, { timeout: LOAD_TIMEOUT })
    .toMatch(/≈\s*US\$\s*\d/);
});

Then('the Architecture tab offers the {string} button', async ({ e2e }, label) => {
  const button = analyzeButton(e2e.window);
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toContainText(new RegExp(escapeRe(label), 'i'));
});

When('I click {string} on the Architecture tab', async ({ e2e }, label) => {
  const button = analyzeButton(e2e.window);
  await expect(button).toContainText(new RegExp(escapeRe(label), 'i'));
  await button.click();
});

Then('the Architecture tab shows a report summary', async ({ e2e }) => {
  const summary = byId(e2e.window, 'architecture-report-summary');
  await expect(summary).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  await expect(summary).not.toBeEmpty();
});

// ---------- the project map (#372) ----------

// The run folders of the scratch workspace whose records name the project-map workflow (analyze-project
// since #631, which took project-map over; the old name may still show through the loader's alias)
function projectMapRuns(e2e) {
  const runsDir = path.join(e2e.scratch, 'workspace', 'runs');
  if (!fs.existsSync(runsDir)) return [];
  return fs.readdirSync(runsDir).filter((id) => ['events.jsonl', 'summary.json', 'meta.json'].some((file) => {
    try { return /project[-_ ]?map|analyze[-_ ]?project/i.test(fs.readFileSync(path.join(runsDir, id, file), 'utf8')); } catch { return false; }
  }));
}

// #381: the estimate is on the button (≈ US$ from past real runs), or the button says there is none yet
Then('the {string} button shows its cost estimate or says there is none yet', async ({ e2e }, label) => {
  const button = analyzeButton(e2e.window);
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toContainText(new RegExp(escapeRe(label), 'i'));
  await expect(button).toBeEnabled();
  await expect.poll(async () => `${await button.innerText()} ${(await button.getAttribute('title')) || ''}`, { timeout: LOAD_TIMEOUT })
    .toMatch(/≈\s*US\$\s*\d|no estimate yet/i);
});

Then('the Architecture tab shows the analysis running', async ({ e2e }) => {
  const running = byId(e2e.window, 'architecture-analyzing');
  await expect(running).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
  await expect(running).toContainText(/Analyzing this project/i);
});

Then('the Architecture tab no longer shows the analysis running', async ({ e2e }) => {
  await expect(visible(tab(e2e.window).getByTestId('architecture-analyzing'))).toHaveCount(0, { timeout: ANALYSIS_TIMEOUT });
});

Then('no project map run has started', async ({ e2e }) => {
  // give a run that was wrongly started time to write its folder
  await e2e.window.waitForTimeout(1500);
  await expect(visible(tab(e2e.window).getByTestId('architecture-analyzing'))).toHaveCount(0);
  expect(projectMapRuns(e2e), 'project map runs in the workspace').toEqual([]);
});

Then('a project map run has started', async ({ e2e }) => {
  await expect.poll(() => projectMapRuns(e2e).length, { timeout: ANALYSIS_TIMEOUT, message: 'a project map run in the workspace' }).toBeGreaterThan(0);
});

// #381: no gate by default: the run's records never ask for an approval
Then('the project map run waits at no gate', async ({ e2e }) => {
  const runsDir = path.join(e2e.scratch, 'workspace', 'runs');
  await expect.poll(() => projectMapRuns(e2e).some((id) => { try { return /"workflow\.finished"/.test(fs.readFileSync(path.join(runsDir, id, 'events.jsonl'), 'utf8')); } catch { return false; } }), { timeout: ANALYSIS_TIMEOUT, message: 'the project map run ends' }).toBe(true);
  for (const id of projectMapRuns(e2e)) {
    expect(fs.readFileSync(path.join(runsDir, id, 'events.jsonl'), 'utf8'), `run ${id} asks for an approval`).not.toMatch(/"approval\.requested"/);
  }
});

When('I expand the city', async ({ e2e }) => {
  await byId(e2e.window, 'project-city-expand').click();
});

Then('the city covers the whole window', async ({ e2e }) => {
  const city = cityBox(e2e.window);
  await expect(city).toHaveClass(/\bexpanded\b/, { timeout: LOAD_TIMEOUT });
  const viewport = e2e.window.viewportSize() || await e2e.window.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const box = await city.boundingBox();
  expect(box.width, 'as wide as the window').toBeGreaterThanOrEqual(viewport.width - 2);
  expect(box.height, 'as tall as the window').toBeGreaterThanOrEqual(viewport.height - 2);
});

When('I press Escape on the city', async ({ e2e }) => {
  await e2e.window.keyboard.press('Escape');
});

Then('the city is back inside the tab', async ({ e2e }) => {
  const city = cityBox(e2e.window);
  await expect(city).not.toHaveClass(/\bexpanded\b/, { timeout: LOAD_TIMEOUT });
  const viewport = e2e.window.viewportSize() || await e2e.window.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const box = await city.boundingBox();
  expect(box.width, 'narrower than the window (the sidebar shows)').toBeLessThan(viewport.width - 100);
});

// ---------- an issue's impact preview on the city (#375) ----------
// The project's synced backlog (<workspace>/backlog/<id>.json, the shape the app's sync writes) gets
// open issues whose bodies cite files; its roadmap (<id>.roadmap.json) a planned stage of those issues.

function projectOf(e2e, name) {
  const projects = require(path.join(root, 'packages', 'engine', 'domains', 'project', 'projects'));
  const project = projects.listProjects(path.join(e2e.scratch, 'workspace', 'projects')).find((p) => p.name === name);
  if (!project) throw new Error(`no project "${name}" in the scratch workspace`);
  return project;
}

const backlogDir = (e2e) => path.join(e2e.scratch, 'workspace', 'backlog');
const repoOf = (name) => `https://github.com/example/${name}`;

async function addCitingIssue(e2e, name, title, files) {
  await addIssue(e2e, name, title, `Files to change:\n${files.map((f) => `- \`${f}\``).join('\n')}\n`);
}

// an open issue of the project's synced backlog with this body (the app reloads to read it)
async function addIssue(e2e, name, title, body) {
  const { taskProgress } = require(path.join(root, 'packages', 'engine', 'domains', 'backlog', 'backlog'));
  const project = projectOf(e2e, name);
  const file = path.join(backlogDir(e2e), `${project.id}.json`);
  const repo = repoOf(name);
  fs.mkdirSync(backlogDir(e2e), { recursive: true });
  if (!project.repo) require(path.join(root, 'packages', 'engine', 'domains', 'project', 'projects')).updateProject(path.join(e2e.scratch, 'workspace', 'projects'), project.id, { repo });
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : { projectId: project.id, platform: 'github', repo, syncedAt: new Date().toISOString(), issues: [], epics: [], epicsError: null };
  const number = data.issues.reduce((n, i) => Math.max(n, i.number), 0) + 1;
  const now = new Date().toISOString();
  data.issues.push({ number, title, state: 'open', labels: [], body, url: `${repo}/issues/${number}`, author: 'octocat', assignees: [], tasks: taskProgress(body), createdAt: now, updatedAt: now });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
}

Given('the backlog of {string} has the open issue {string} whose body cites {string}', async ({ e2e }, name, title, a) => {
  await addCitingIssue(e2e, name, title, [a]);
});

Given('the backlog of {string} has the open issue {string} whose body cites {string} and {string}', async ({ e2e }, name, title, a, b) => {
  await addCitingIssue(e2e, name, title, [a, b]);
});

Given('the backlog of {string} has the open issue {string} whose body cites {string}, {string} and {string}', async ({ e2e }, name, title, a, b, c) => {
  await addCitingIssue(e2e, name, title, [a, b, c]);
});

// A planned roadmap (nothing starts) of one stage whose items are the backlog's issues of these titles
Given('the roadmap of {string} has the planned stage {string} with the items {string} and {string}', async ({ e2e }, name, stageName, a, b) => {
  const project = projectOf(e2e, name);
  const backlog = JSON.parse(fs.readFileSync(path.join(backlogDir(e2e), `${project.id}.json`), 'utf8'));
  const item = (title, n) => {
    const i = backlog.issues.find((x) => x.title === title);
    if (!i) throw new Error(`no issue "${title}" in the backlog of "${name}"`);
    return {
      id: `item-375-${n}`, workflow: 'software-development.yaml', workflowName: 'software-development', inputs: { language: 'js', mode: 'auto' }, mock: false,
      number: i.number, url: i.url, title: i.title, body: i.body, knownPullRequests: [], status: 'planned', runId: null, runs: [], error: null,
    };
  };
  const roadmap = {
    state: 'planned', simulated: false, error: null, pausedBy: null, updatedAt: new Date().toISOString(),
    stages: [{ id: 'stage-375', name: stageName, note: 'Both change the billing rules (simulated data).', items: [item(a, 1), item(b, 2)] }],
  };
  fs.writeFileSync(path.join(backlogDir(e2e), `${project.id}.roadmap.json`), JSON.stringify(roadmap, null, 2));
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

// The button is on the issue's row, or in its ⋯ actions menu
When('I click {string} on the Backlog issue {string}', async ({ e2e }, label, title) => {
  const row = e2e.window.getByTestId('backlog-list').getByTestId('backlog-issue').filter({ hasText: title }).first();
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  const button = row.getByTestId('show-on-map');
  if (!(await button.isVisible())) await row.getByTestId('backlog-issue-menu').click();
  await expect(button).toBeVisible();
  await expect(button).toHaveText(new RegExp(`^\\s*${escapeRe(label)}\\s*$`));
  await button.click();
});

When('I click {string} on the roadmap stage {string}', async ({ e2e }, label, stageName) => {
  // the stage's name is the value of its "Stage name" input, which hasText does not read
  const stage = e2e.window.getByTestId('roadmap-stage').filter({ has: e2e.window.locator(`input[value="${stageName}"]`) }).first();
  await expect(stage).toBeVisible({ timeout: LOAD_TIMEOUT });
  const button = stage.getByTestId('show-stage-on-map');
  await expect(button).toBeVisible();
  await expect(button).toHaveText(new RegExp(`^\\s*${escapeRe(label)}\\s*$`));
  await button.click();
});

const impactHeader = (page) => byId(page, 'city-impact-header');

Then('the city impact header names the issue {string}', async ({ e2e }, title) => {
  const header = impactHeader(e2e.window);
  await expect(header).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(header).toContainText(title, { timeout: LOAD_TIMEOUT });
});

// the counts are of the buildings the repository has; a predicted file it lacks is listed apart
Then('the city impact header counts {int} files, in the districts {string} and {string} and the zones {string} and {string}', async ({ e2e }, files, d1, d2, z1, z2) => {
  const header = impactHeader(e2e.window);
  await expect(header).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(header, `the header's ${files} files`).toContainText(new RegExp(`\\b${files}\\s+files?\\b`, 'i'), { timeout: LOAD_TIMEOUT });
  for (const name of [d1, d2, z1, z2]) await expect(header, `the header's "${name}"`).toContainText(name);
});

Then('the city impact header gives the share of the files in the Danger Zone as a percentage', async ({ e2e }) => {
  const header = impactHeader(e2e.window);
  await expect(header).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(header).toContainText(/Danger Zone/i);
  await expect(header).toContainText(/\b\d{1,3}(\.\d+)?\s*%/);
});

Then('the city lists {string} apart as a new file expected in {string}', async ({ e2e }, file, district) => {
  const entry = visible(tab(e2e.window).getByRole('listitem').filter({ hasText: file })
    .filter({ hasText: new RegExp(`new file, expected in ${escapeRe(district)}`, 'i') })).first();
  await expect(entry).toBeVisible({ timeout: LOAD_TIMEOUT });
});

const impactConflicts = (page) => byId(page, 'city-impact-conflicts');

Then('the city marks {string} as a conflict of the stage', async ({ e2e }, file) => {
  const conflicts = impactConflicts(e2e.window);
  await expect(conflicts).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(conflicts).toContainText(file, { timeout: LOAD_TIMEOUT });
});

Then('the city does not mark {string} as a conflict of the stage', async ({ e2e }, file) => {
  const conflicts = impactConflicts(e2e.window);
  await expect(conflicts).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(conflicts).not.toContainText(file);
});

// ---------- expected files (#427, #429) ----------

Given('the backlog of {string} has the open issue {string} whose body is:', async ({ e2e }, name, title, body) => {
  await addIssue(e2e, name, title, `${body}\n`);
});

// A real (not simulated) finished run of the project started for the issue (its task names the
// issue's URL, backlog.linkRuns), with no worktree left: the run's diff is the files its developer
// reported (step.finished output.files_changed, fronts/analyser/engine/areas/diff.js reportedFiles).
Given('a finished run of {string} for the issue {string} changed {string}', async ({ e2e }, name, title, file) => {
  const project = projectOf(e2e, name);
  const backlog = JSON.parse(fs.readFileSync(path.join(backlogDir(e2e), `${project.id}.json`), 'utf8'));
  const issue = backlog.issues.find((x) => x.title === title);
  if (!issue) throw new Error(`no issue "${title}" in the backlog of "${name}"`);
  const min = 6e4;
  const start = Date.now() - 864e5 + issue.number * 10 * min;
  const at = (m) => new Date(start + m * min).toISOString();
  const runId = `${at(0).slice(0, 10).replace(/-/g, '')}-101500-i429n${issue.number}`;
  const workflow = 'software-development';
  const task = `${issue.title}\n\n${issue.url}`;
  const events = [
    { seq: 1, ts: at(0), type: 'workflow.started', run_id: runId, workflow, file: `${workflow}.yaml`, project_id: project.id, mock: false, inputs: { task } },
    { seq: 2, ts: at(1), type: 'step.started', run_id: runId, step: 'implement', agent: 'developer' },
    { seq: 3, ts: at(9), type: 'step.finished', run_id: runId, step: 'implement', agent: 'developer', status: 'success', output: { summary: 'Done (simulated data).', files_changed: [file] } },
    { seq: 4, ts: at(10), type: 'workflow.finished', run_id: runId, status: 'success' },
  ];
  const dir = path.join(e2e.scratch, 'workspace', 'runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: runId, workflow, project_id: project.id, mock: false, inputs: { task }, status: 'success', started_at: at(0), finished_at: at(10), duration_ms: 10 * min, sessions: [],
  }, null, 2));
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

Then('the city impact header counts {int} file(s), in the district {string} and the zone {string}', async ({ e2e }, files, district, zone) => {
  const header = impactHeader(e2e.window);
  await expect(header).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(header, `the header's ${files} files`).toContainText(new RegExp(`\\b${files}\\s+files?\\b`, 'i'), { timeout: LOAD_TIMEOUT });
  for (const n of [district, zone]) await expect(header, `the header's "${n}"`).toContainText(n);
});

Then('the city lists no new file for the issue', async ({ e2e }) => {
  const header = impactHeader(e2e.window);
  await expect(header).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(header.getByTestId('city-impact-new-file')).toHaveCount(0);
});

Then('the city impact header does not mention {string}', async ({ e2e }, text) => {
  const card = byId(e2e.window, 'city-impact');
  await expect(impactHeader(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card).not.toContainText(text);
});

// each impact row of the legend is a list item: its colour dot (style --c) and its label
const legendRow = (page, label) => visible(byId(page, 'project-city-legend').getByRole('listitem')
  .filter({ hasText: new RegExp(escapeRe(label), 'i') })).first();
const rowColour = (row) => row.evaluate((li) => {
  const dot = li.querySelector('[style*="--c"]') || li;
  return getComputedStyle(dot).getPropertyValue('--c').trim() || getComputedStyle(dot).backgroundColor;
});

Then('the city legend gives {string} a colour of its own, apart from {string}', async ({ e2e }, label, other) => {
  const mine = legendRow(e2e.window, label);
  const theirs = legendRow(e2e.window, other);
  await expect(mine).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(theirs).toBeVisible({ timeout: LOAD_TIMEOUT });
  const a = await rowColour(mine);
  expect(a, `the colour of "${label}"`).toBeTruthy();
  expect(a, `"${label}" and "${other}" share a colour`).not.toBe(await rowColour(theirs));
});

Then('the city impact card shows the hit rate of the run', async ({ e2e }) => {
  const cmp = byId(e2e.window, 'city-impact-comparison');
  await expect(cmp).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(cmp).toContainText(/\b\d{1,3}%/);
});

// #429: after a run, which source predicted each hit and each miss (data-testid="city-impact-by-source",
// one list item per file: its path, "hit" or "missed", the source's legend label)
Then('the city impact card credits the {word} {string} to {string}', async ({ e2e }, kind, file, source) => {
  const box = byId(e2e.window, 'city-impact-by-source');
  await expect(box).toBeVisible({ timeout: LOAD_TIMEOUT });
  const word = kind === 'hit' ? /hit|as predicted/i : /miss|untouched/i;
  const row = visible(box.getByRole('listitem').filter({ hasText: file }).filter({ hasText: new RegExp(escapeRe(source), 'i') }).filter({ hasText: word })).first();
  await expect(row, `the ${kind} "${file}" credited to "${source}"`).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// #429: the average hit rate of the project's issues with an "## Expected files" section and without
// (data-testid="city-impact-section-rate")
Then('the city impact card gives an average hit rate of {int}% with an Expected files section and {int}% without', async ({ e2e }, withRate, withoutRate) => {
  const line = byId(e2e.window, 'city-impact-section-rate');
  await expect(line).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(line).toContainText(new RegExp(`with[^%]*\\b${withRate}%`, 'i'), { timeout: LOAD_TIMEOUT });
  await expect(line).toContainText(new RegExp(`without[^%]*\\b${withoutRate}%`, 'i'));
});

// ---------- complexity per language (#385) ----------

// a precondition, not the app: these scenarios describe a machine without lizard (CI, a fresh PC)
Given('the complexity tool lizard is not installed on this machine', async ({ $test }) => {
  const { resolveCommand } = require(path.join(root, 'packages', 'engine', 'engine', 'providers'));
  $test.skip(Boolean(resolveCommand('lizard')), 'lizard is installed on this machine: the scenario describes a machine without it');
});

// the cell of the hotspot table's `column` on the row of `file`
async function hotspotCell(page, file, column) {
  const table = byId(page, 'architecture-hotspots');
  await expect(table).toBeVisible({ timeout: LOAD_TIMEOUT });
  const header = table.getByRole('columnheader', { name: column, exact: true });
  await expect(header, `the hotspot table's "${column}" column`).toBeVisible({ timeout: LOAD_TIMEOUT });
  // textContent, not innerText: the table headers are CSS uppercase, so innerText reads "COMPLEXITY"
  const index = (await table.getByRole('columnheader').allTextContents()).findIndex((t) => t.trim() === column);
  expect(index, `the hotspot table's "${column}" column index`).toBeGreaterThanOrEqual(0);
  const row = table.getByRole('row').filter({ hasText: file }).first();
  await expect(row, `the hotspot table's row of "${file}"`).toBeVisible();
  return row.getByRole('cell').nth(index);
}

Then('the Architecture hotspot table shows a measured complexity for {string}', async ({ e2e }, file) => {
  const cell = await hotspotCell(e2e.window, file, 'Complexity');
  await expect(cell).toHaveText(/^\s*\d+\s*$/, { timeout: LOAD_TIMEOUT });
  // a file with a function has a cyclomatic complexity of at least 1
  expect(Number((await cell.innerText()).trim()), `the complexity of "${file}"`).toBeGreaterThan(0);
});

Then('the Architecture hotspot table shows the complexity of {string} as not measured, not zero', async ({ e2e }, file) => {
  const cell = await hotspotCell(e2e.window, file, 'Complexity');
  await expect(cell).toBeVisible();
  await expect(cell, `the complexity of "${file}" is not a number`).not.toHaveText(/^\s*\d+(\.\d+)?\s*$/);
});

Then('the Architecture tab lists {string} as the only language whose complexity is not measured', async ({ e2e }, language) => {
  const note = byId(e2e.window, 'architecture-measure-note');
  await expect(note).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(note.getByTestId('architecture-unmeasured-language')).toHaveText([new RegExp(`^\\s*${escapeRe(language)}\\s*$`, 'i')]);
});

Then('the Architecture tab says how to measure it with {string}, which needs Python', async ({ e2e }, command) => {
  const note = byId(e2e.window, 'architecture-measure-note');
  await expect(note).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(note).toContainText(command);
  await expect(note).toContainText(/needs?\s+Python|requires?\s+Python|Python\s+is\s+(needed|required)/i);
});

Then('the Architecture tab advises refreshing the map', async ({ e2e }) => {
  const advice = byId(e2e.window, 'architecture-map-refresh-advised');
  await expect(advice).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(advice).toContainText(/refresh/i);
});

Then('the Architecture tab does not advise refreshing the map', async ({ e2e }) => {
  await expect(analyzeButton(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(visible(tab(e2e.window).getByTestId('architecture-map-refresh-advised'))).toHaveCount(0);
});

// ---------- the Facts view for a human reader (#386) ----------

const overview = (page) => byId(page, 'architecture-overview');
const findingRow = (page, title) => visible(tab(page).getByTestId('architecture-finding')).filter({ hasText: title }).first();

Then('the Architecture tab leads with a one-line verdict above the findings', async ({ e2e }) => {
  const page = e2e.window;
  const lead = overview(page);
  await expect(lead).toBeVisible({ timeout: LOAD_TIMEOUT });
  const verdict = lead.getByTestId('architecture-verdict');
  await expect(verdict).toBeVisible();
  await expect(verdict).not.toBeEmpty();
  expect((await verdict.innerText()).trim(), 'the verdict is one line').not.toMatch(/\n/);
  const findings = byId(page, 'architecture-findings');
  await expect(findings).toBeVisible({ timeout: LOAD_TIMEOUT });
  expect((await findings.boundingBox()).y, 'the findings come below the summary row').toBeGreaterThan((await lead.boundingBox()).y);
});

Then('the summary shows at most 3 risk cards, each with a score from 0 to 100', async ({ e2e }) => {
  const cards = visible(overview(e2e.window).getByTestId('architecture-risk-card'));
  await expect(cards.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  const n = await cards.count();
  expect(n, 'risk cards in the summary').toBeLessThanOrEqual(3);
  for (let i = 0; i < n; i += 1) {
    const score = cards.nth(i).getByTestId('architecture-risk-score');
    await expect(score).toBeVisible();
    const value = Number(((await score.innerText()).match(/\d+(\.\d+)?/) || [])[0]);
    expect(value, `the score of risk card ${i + 1}`).toBeGreaterThanOrEqual(0);
    expect(value, `the score of risk card ${i + 1}`).toBeLessThanOrEqual(100);
  }
});

Then('the summary shows how many files are in the Danger Zone', async ({ e2e }) => {
  const count = visible(overview(e2e.window).getByTestId('architecture-danger-count')).first();
  await expect(count).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(count).toContainText(/\d/);
});

Then('the summary shows a languages bar whose legend gives {string} and {string} in percent', async ({ e2e }, a, b) => {
  const lead = overview(e2e.window);
  const bar = visible(lead.getByTestId('architecture-languages-bar')).first();
  await expect(bar).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(bar.getByTestId('architecture-language-segment')).toHaveCount(2);
  const legend = visible(lead.getByTestId('architecture-language-legend')).first();
  await expect(legend).toBeVisible();
  for (const language of [a, b]) {
    const entry = legend.getByTestId('architecture-language-entry').filter({ hasText: language });
    await expect(entry, `the legend's "${language}"`).toHaveCount(1);
    await expect(entry).toHaveText(new RegExp(`${escapeRe(language)}\\s*\\d+(\\.\\d+)?\\s*%`));
  }
});

Then('the Architecture tab keeps what the numbers cannot tell out of sight', async ({ e2e }) => {
  await expect(byId(e2e.window, 'architecture-caveats')).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(visible(tab(e2e.window).getByTestId('architecture-limits'))).toHaveCount(0);
});

When('I open the caveats of the Architecture tab', async ({ e2e }) => {
  const button = byId(e2e.window, 'architecture-caveats');
  await expect(button).toHaveRole('button');
  await button.click();
});

Then('the Architecture tab shows what the numbers cannot tell', async ({ e2e }) => {
  const limits = byId(e2e.window, 'architecture-limits');
  await expect(limits).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(limits).not.toBeEmpty();
});

Then('the finding {string} shows a score and a one-line summary', async ({ e2e }, title) => {
  const row = findingRow(e2e.window, title);
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(row.getByTestId('architecture-finding-score')).toContainText(/\d/);
  const summary = row.getByTestId('architecture-finding-summary');
  await expect(summary).toBeVisible();
  await expect(summary).not.toBeEmpty();
  expect((await summary.innerText()).trim(), 'the summary is one line').not.toMatch(/\n/);
});

Then('the details of the finding {string} are hidden', async ({ e2e }, title) => {
  const row = findingRow(e2e.window, title);
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(visible(row.getByTestId('architecture-finding-details'))).toHaveCount(0);
});

When('I click {string} on the finding {string}', async ({ e2e }, label, title) => {
  const more = findingRow(e2e.window, title).getByTestId('architecture-finding-more');
  await expect(more).toHaveRole('button');
  await expect(more).toHaveAccessibleName(new RegExp(escapeRe(label), 'i'));
  await more.click();
});

Then('the details of the finding {string} show its evidence and its refactor', async ({ e2e }, title) => {
  const finding = SEVERITY_FINDINGS.find((f) => f.title === title);
  const details = findingRow(e2e.window, title).getByTestId('architecture-finding-details');
  await expect(details).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(details).toContainText(finding.evidence);
  await expect(details).toContainText(finding.refactor);
});

When('I filter the findings by {string} severity', async ({ e2e }, severity) => {
  const filter = byId(e2e.window, `architecture-filter-${severity.toLowerCase()}`);
  await expect(filter).toHaveRole('button');
  await filter.click();
});

Then('the Architecture tab lists only the 2 high-severity findings', async ({ e2e }) => {
  const page = e2e.window;
  await expect(byId(page, 'architecture-filter-high'), 'the "high" filter counts its findings').toContainText(/\b2\b/);
  await expect(visible(tab(page).getByTestId('architecture-finding'))).toHaveCount(HIGH_TITLES.length, { timeout: LOAD_TIMEOUT });
  for (const title of HIGH_TITLES) await expect(findingRow(page, title), `the high finding "${title}"`).toBeVisible();
  for (const title of OTHER_TITLES) await expect(visible(tab(page).getByTestId('architecture-finding')).filter({ hasText: title }), `"${title}" is filtered out`).toHaveCount(0);
});

When('I send the finding {string} to Refactor', async ({ e2e }, title) => {
  const send = findingRow(e2e.window, title).getByTestId('architecture-send-refactor');
  await expect(send).toBeVisible({ timeout: LOAD_TIMEOUT });
  await send.click();
  await expect(send).toContainText(/sent to refactor/i, { timeout: LOAD_TIMEOUT });
});

When('I send all the findings to Refactor', async ({ e2e }) => {
  const button = byId(e2e.window, 'architecture-send-all');
  await expect(button).toHaveRole('button');
  await expect(button).toHaveAccessibleName(/send all to refactor/i);
  await button.click();
});

Then('every finding of the Architecture tab is marked sent to Refactor', async ({ e2e }) => {
  const rows = visible(tab(e2e.window).getByTestId('architecture-finding'));
  await expect(rows).toHaveCount(SEVERITY_FINDINGS.length, { timeout: LOAD_TIMEOUT });
  for (let i = 0; i < SEVERITY_FINDINGS.length; i += 1) {
    await expect(rows.nth(i).getByTestId('architecture-send-refactor')).toContainText(/sent to refactor/i, { timeout: LOAD_TIMEOUT });
  }
});

// the Refactor tab's proposals, read from the scratch workspace (<workspace>/refactor/<id>/proposals.json)
Then('the Refactor tab of {string} has {int} proposals from the Architecture tab', async ({ e2e }, name, count) => {
  const projects = require(path.join(root, 'packages', 'engine', 'domains', 'project', 'projects'));
  const { listProposals } = require(path.join(root, 'packages', 'engine', 'domains', 'refactor', 'refactor-proposals'));
  const wsDir = path.join(e2e.scratch, 'workspace');
  const project = projects.listProjects(path.join(wsDir, 'projects')).find((p) => p.name === name);
  expect(project, `the project "${name}"`).toBeTruthy();
  await expect.poll(() => listProposals(path.join(wsDir, 'refactor'), project.id).filter((p) => p.source === 'architecture').length, { timeout: LOAD_TIMEOUT })
    .toBe(count);
});

// --- City v2 buildings (#449) ---
// The contract these steps assume: window.ProjectCity.stats() (the city on screen) keeps
// { firstFrameMs, fps } and adds `buildings`: one entry per drawn file, { path, archetype, greyed },
// archetype one of shed / pavilion / hall / block / tower / complex, greyed true when an overlay
// layer is set and highlights another file. The hover card stays data-testid="project-city-hover",
// the card a search pins "project-city-card" (with its "project-city-open-facts" button).

const ARCHETYPES = ['shed', 'pavilion', 'hall', 'block', 'tower', 'complex'];
const cityStats = (page) => page.evaluate(() => window.ProjectCity?.stats?.() || null);
const drawnBuildings = async (page) => (await cityStats(page))?.buildings || null;

Then('the city draws its {int} files as buildings of the new kinds', async ({ e2e }, count) => {
  await expect.poll(async () => (await drawnBuildings(e2e.window))?.length ?? -1, { timeout: LOAD_TIMEOUT, message: 'the drawn buildings' }).toBe(count);
  for (const b of await drawnBuildings(e2e.window)) {
    expect(ARCHETYPES, `the kind of building of "${b.path}"`).toContain(b.archetype);
  }
});

When('I search the city for {string}', async ({ e2e }, name) => {
  const search = visible(tab(e2e.window).getByRole('searchbox', { name: /search the city/i })).first();
  await expect(search).toBeVisible({ timeout: LOAD_TIMEOUT });
  await search.fill(name);
  await search.press('Enter');
});

Then('the city card of {string} names its district {string} and its zone {string} and offers "Open in Facts"', async ({ e2e }, file, district, zone) => {
  const card = byId(e2e.window, 'project-city-card');
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card).toContainText(file.split('/').pop());
  await expect(card).toContainText(district);
  await expect(card).toContainText(zone);
  await expect(card.getByRole('button', { name: /open in facts/i })).toBeVisible();
});

When('I close the city card', async ({ e2e }) => {
  const card = byId(e2e.window, 'project-city-card');
  await card.getByRole('button', { name: /close the card/i }).click();
  await expect(visible(tab(e2e.window).getByTestId('project-city-card'))).toHaveCount(0);
});

// After the search the camera has flown to the file: its building is under the city's centre. The
// pointer is moved there until the hover card names it (the camera's flight takes a moment).
Then('pointing at the middle of the city shows the hover card of {string}', async ({ e2e }, file) => {
  const canvas = byId(e2e.window, 'project-city').locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: LOAD_TIMEOUT });
  const hover = byId(e2e.window, 'project-city-hover');
  const name = file.split('/').pop();
  await expect.poll(async () => {
    const box = await canvas.boundingBox();
    if (!box) return '';
    await e2e.window.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 + 3);
    await e2e.window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    return (await hover.isVisible()) ? (await hover.textContent()) || '' : '';
  }, { timeout: LOAD_TIMEOUT, message: `the hover card of "${file}"` }).toContain(name);
});

Then('the city highlights the building {string} and greys {string}', async ({ e2e }, lit, grey) => {
  const state = async () => {
    const all = (await drawnBuildings(e2e.window)) || [];
    const of = (p) => all.find((b) => b.path === p);
    return { lit: of(lit) ? !of(lit).greyed : null, grey: of(grey) ? !!of(grey).greyed : null };
  };
  await expect.poll(state, { timeout: LOAD_TIMEOUT, message: `"${lit}" highlighted, "${grey}" greyed` }).toEqual({ lit: true, grey: true });
});

// --- City life (#450) ---
// The contract these steps assume: the city header has two toggle buttons with aria-pressed
// "true"/"false": data-testid="project-city-life" (accessible name containing "City life", on by
// default in the Architecture tab) and data-testid="project-city-glow" (name containing "Glow"),
// the same ids as test/city-life-450.test.js.
// window.ProjectCity.stats() adds `props`: how many life props (trees, benches, lamps, cars, lamp
// pools) are shown, 0 when City life is off. "Not rebuilt": the city's canvas is marked (a JS
// property, no attribute) the first time a switch is turned; afterwards the visible canvas still
// carries the mark and stats().buildings keeps its count.

const CITY_SWITCHES = { 'city life': 'project-city-life', glow: 'project-city-glow' };
const citySwitch = (page, name) => {
  const id = CITY_SWITCHES[name.toLowerCase()];
  if (!id) throw new Error(`no city switch "${name}" (known: ${Object.keys(CITY_SWITCHES).join(', ')})`);
  return byId(page, id);
};
const onOff = (word) => {
  if (!/^(on|off)$/i.test(word)) throw new Error(`a switch is "on" or "off", not "${word}"`);
  return /^on$/i.test(word) ? 'true' : 'false';
};
const cityCanvas = (page) => cityBox(page).locator('canvas').first();

Then('the {string} switch of the city is {word}', async ({ e2e }, name, state) => {
  const button = citySwitch(e2e.window, name);
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toHaveRole('button');
  await expect(button).toHaveAccessibleName(new RegExp(escapeRe(name), 'i'));
  await expect(button).toHaveAttribute('aria-pressed', onOff(state), { timeout: LOAD_TIMEOUT });
});

When('I turn the {string} switch of the city {word}', async ({ e2e }, name, state) => {
  const wanted = onOff(state);
  const button = citySwitch(e2e.window, name);
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  // mark the city on screen once, so a later step can tell it was not rebuilt
  await cityCanvas(e2e.window).evaluate((c) => { if (!c.__e2eCityMark) c.__e2eCityMark = true; });
  await expect(button, `the "${name}" switch is not ${state} yet`).toHaveAttribute('aria-pressed', wanted === 'true' ? 'false' : 'true');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', wanted, { timeout: LOAD_TIMEOUT });
});

Then('the city shows its trees, benches, lamps and cars', async ({ e2e }) => {
  await expect.poll(async () => (await cityStats(e2e.window))?.props ?? -1, { timeout: LOAD_TIMEOUT, message: 'the city life props shown' }).toBeGreaterThan(0);
});

Then('the city shows no trees, benches, lamps or cars', async ({ e2e }) => {
  await expect.poll(async () => (await cityStats(e2e.window))?.props ?? -1, { timeout: LOAD_TIMEOUT, message: 'the city life props shown' }).toBe(0);
});

Then('the city on screen is the same one, not rebuilt, with its {int} buildings', async ({ e2e }, count) => {
  const canvas = cityCanvas(e2e.window);
  await expect(canvas).toBeVisible({ timeout: LOAD_TIMEOUT });
  expect(await canvas.evaluate((c) => c.__e2eCityMark === true), 'the canvas drawn before the switch is still the one shown').toBe(true);
  await expect.poll(async () => (await drawnBuildings(e2e.window))?.length ?? -1, { timeout: LOAD_TIMEOUT, message: 'the drawn buildings' }).toBe(count);
});

// --- City modes (#440) and its panels (#441) ---
// The contract these steps assume: the city's root carries data-city-mode = explore | live | replay |
// impact | stage | release (one at a time); its header title data-testid="city-mode-title" (the
// project in Explore, "Live", "Issue #426", "Release 1.0.0 → 1.1.2"...), its Close button
// data-testid="city-mode-close" (back to where the mode was opened from; in Architecture: Explore).
// Each panel's root has data-city-panel = notes | connections | agents | impact | release | replay |
// legend, with a chevron button data-testid="city-panel-toggle" whose aria-expanded is "true" or
// "false" (minimized: only the title row shows). The legend closes with data-testid=
// "city-legend-close"; a button data-testid="city-legend-open" ("Legend") brings it back; its rows are
// list items. The Live switch data-testid="city-live-toggle" (a checkbox or a button with
// aria-pressed / aria-checked) is off by default. The city may be a modal outside the Architecture
// tab, so these locators are page-wide.

const CITY_MODES = { explore: 'explore', live: 'live', 'run replay': 'replay', 'issue impact': 'impact', stage: 'stage', release: 'release' };
const CITY_PANELS = {
  notes: 'notes', 'city plan': 'notes', 'most connected': 'connections', 'agents at work': 'agents',
  'impact preview': 'impact', release: 'release', replay: 'replay', legend: 'legend',
};
const cityModeOf = (name) => {
  const mode = CITY_MODES[name.toLowerCase()];
  if (!mode) throw new Error(`no city mode "${name}" (known: ${Object.keys(CITY_MODES).join(', ')})`);
  return mode;
};
const cityPanelId = (name) => {
  const id = CITY_PANELS[name.toLowerCase()];
  if (!id) throw new Error(`no city panel "${name}" (known: ${Object.keys(CITY_PANELS).join(', ')})`);
  return id;
};
const cityRoot = (page) => visible(page.locator('[data-city-mode]')).first();
const cityPanel = (page, name) => page.locator(`[data-city-panel="${cityPanelId(name)}"]`).filter({ visible: true });
const panelToggle = (panel) => panel.getByTestId('city-panel-toggle').first();
const cityLegend = (page) => cityPanel(page, 'legend').first();
const legendRowOf = (page, label) => cityLegend(page).getByRole('listitem').filter({ hasText: new RegExp(escapeRe(label), 'i') }).filter({ visible: true });
const liveToggle = (page) => visible(page.getByTestId('city-live-toggle')).first();
// a checkbox's checked, else aria-pressed / aria-checked
const liveIsOn = (page) => liveToggle(page).evaluate((el) => (el.type === 'checkbox'
  ? el.checked : (el.getAttribute('aria-pressed') || el.getAttribute('aria-checked')) === 'true'));

Then('the city is in the {string} mode titled {string}', async ({ e2e }, mode, title) => {
  const city = cityRoot(e2e.window);
  await expect(city).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(city).toHaveAttribute('data-city-mode', cityModeOf(mode), { timeout: LOAD_TIMEOUT });
  await expect(visible(e2e.window.locator('[data-city-mode]')), 'one city, in one mode').toHaveCount(1);
  await expect(city.getByTestId('city-mode-title')).toContainText(title, { timeout: LOAD_TIMEOUT });
});

Then('the city shows the {string} panel', async ({ e2e }, name) => {
  await expect(cityPanel(e2e.window, name).first(), `the "${name}" panel`).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the city shows no {string} panel', async ({ e2e }, name) => {
  await expect(cityRoot(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(cityPanel(e2e.window, name), `no "${name}" panel`).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

Then('the city\'s Live switch is {word}', async ({ e2e }, state) => {
  const wanted = onOff(state) === 'true';
  await expect(liveToggle(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect.poll(() => liveIsOn(e2e.window), { timeout: LOAD_TIMEOUT, message: `the Live switch is ${state}` }).toBe(wanted);
});

When('I turn the city\'s Live switch {word}', async ({ e2e }, state) => {
  const wanted = onOff(state) === 'true';
  await expect(liveToggle(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  expect(await liveIsOn(e2e.window), `the Live switch is not ${state} yet`).toBe(!wanted);
  await liveToggle(e2e.window).click();
  await expect.poll(() => liveIsOn(e2e.window), { timeout: LOAD_TIMEOUT, message: `the Live switch is ${state}` }).toBe(wanted);
});

When('I close the city\'s mode', async ({ e2e }) => {
  const close = cityRoot(e2e.window).getByTestId('city-mode-close');
  await expect(close).toBeVisible({ timeout: LOAD_TIMEOUT });
  await close.click();
});

Then('the city legend has the {string} row', async ({ e2e }, label) => {
  await expect(cityLegend(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(legendRowOf(e2e.window, label).first(), `the legend's "${label}"`).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the city legend has no {string} row', async ({ e2e }, label) => {
  await expect(cityLegend(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(legendRowOf(e2e.window, label), `no "${label}" in the legend`).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

When('I minimize the city\'s {string} panel', async ({ e2e }, name) => {
  const toggle = panelToggle(cityPanel(e2e.window, name).first());
  await expect(toggle).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false', { timeout: LOAD_TIMEOUT });
});

When('I expand the city\'s {string} panel', async ({ e2e }, name) => {
  const toggle = panelToggle(cityPanel(e2e.window, name).first());
  await expect(toggle).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: LOAD_TIMEOUT });
});

// minimized: the panel stays with its title row, its content (lists, fields, the rest) hidden
Then('the city\'s {string} panel shows only its title row', async ({ e2e }, name) => {
  const panel = cityPanel(e2e.window, name).first();
  await expect(panel).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(panelToggle(panel)).toHaveAttribute('aria-expanded', 'false', { timeout: LOAD_TIMEOUT });
  await expect(panel.locator('select, input, textarea, li, table').filter({ visible: true }), 'no content shows').toHaveCount(0, { timeout: LOAD_TIMEOUT });
  const box = await panel.boundingBox();
  expect(box && box.height, 'one title row high').toBeLessThan(80);
});

Then('the city\'s {string} panel is expanded', async ({ e2e }, name) => {
  const panel = cityPanel(e2e.window, name).first();
  await expect(panel).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(panelToggle(panel)).toHaveAttribute('aria-expanded', 'true', { timeout: LOAD_TIMEOUT });
  await expect(panel.locator('select, input, textarea, li, table, p').filter({ visible: true }).first(), 'its content shows').toBeVisible({ timeout: LOAD_TIMEOUT });
});

When('I close the city legend', async ({ e2e }) => {
  const close = cityLegend(e2e.window).getByTestId('city-legend-close');
  await expect(close).toBeVisible({ timeout: LOAD_TIMEOUT });
  await close.click();
});

Then('the city shows no legend but a {string} button', async ({ e2e }, label) => {
  await expect(cityPanel(e2e.window, 'legend'), 'the legend is closed').toHaveCount(0, { timeout: LOAD_TIMEOUT });
  const open = visible(e2e.window.getByTestId('city-legend-open')).first();
  await expect(open).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(open).toHaveRole('button');
  await expect(open).toHaveAccessibleName(new RegExp(escapeRe(label), 'i'));
});

When('I bring the city legend back with its {string} button', async ({ e2e }, label) => {
  const open = visible(e2e.window.getByTestId('city-legend-open')).first();
  await expect(open).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(open).toContainText(label);
  await open.click();
});

Then('the city shows no {string} button for the legend', async ({ e2e }, label) => {
  await expect(cityLegend(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(visible(e2e.window.getByTestId('city-legend-open')), `no "${label}" button`).toHaveCount(0);
});

// --- Send to Refactor waits for the owner's OK (#435, #447) ---

// "#432 · stage 117, waiting for your OK": the issue, the stage, and that it waits for the owner
const WHERE = /#\d+\s*·\s*stage\s+\d+\s*,\s*waiting for your OK/i;
const ISSUE_REF = /#\d+/;
const STAGE_WAITING = /stage\s+\d+[^]*waiting for your OK/i;
// the place and size of a finding's Send to Refactor button before the click, per scenario
const notedBoxes = new WeakMap();
const sendButtonOf = (page, title) => findingRow(page, title).getByTestId('architecture-send-refactor');

When('I note the place and size of the Send to Refactor button of the finding {string}', async ({ e2e }, title) => {
  const button = sendButtonOf(e2e.window, title);
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toBeEnabled();
  await expect(button).toHaveText(/^\s*Send to Refactor\s*$/);
  if (!notedBoxes.has(e2e)) notedBoxes.set(e2e, new Map());
  notedBoxes.get(e2e).set(title, await button.boundingBox());
});

Then('the Send to Refactor button of the finding {string} is the same small button, disabled, reading {string}, in the same place and size', async ({ e2e }, title, text) => {
  const button = sendButtonOf(e2e.window, title);
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button, 'still a button, not a badge').toHaveRole('button');
  await expect(button).toHaveClass(/(^|\s)btn(\s|$)/);
  await expect(button).toHaveClass(/(^|\s)sm(\s|$)/);
  await expect(button).toBeDisabled({ timeout: LOAD_TIMEOUT });
  await expect(button).toHaveText(new RegExp(`^\\s*${escapeRe(text)}\\s*$`));
  const before = notedBoxes.get(e2e)?.get(title);
  expect(before, `the place and size of the button of "${title}" noted before the click`).toBeTruthy();
  const after = await button.boundingBox();
  expect(Math.abs(after.x - before.x), 'the same left edge').toBeLessThanOrEqual(2);
  expect(Math.abs(after.y - before.y), 'the same top edge').toBeLessThanOrEqual(2);
  expect(Math.abs(after.height - before.height), 'the same height').toBeLessThanOrEqual(2);
  // "Send" and "Sent" differ by one letter: the width stays within a few pixels
  expect(Math.abs(after.width - before.width), 'the same width').toBeLessThanOrEqual(Math.max(6, before.width * 0.1));
});

Then('the Send to Refactor button of the finding {string} has a tooltip naming its issue and a stage waiting for your OK', async ({ e2e }, title) => {
  const button = sendButtonOf(e2e.window, title);
  await expect(button).toHaveAttribute('title', ISSUE_REF, { timeout: LOAD_TIMEOUT });
  await expect(button).toHaveAttribute('title', STAGE_WAITING);
});

Then('next to the Send to Refactor button of the finding {string} a link names its issue and a stage waiting for your OK', async ({ e2e }, title) => {
  const row = findingRow(e2e.window, title);
  const button = row.getByTestId('architecture-send-refactor');
  const where = row.getByTestId('architecture-refactor-where');
  await expect(where).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(where).toHaveRole('link');
  await expect(where).toHaveText(WHERE);
  // on the button's line, right beside it
  const b = await button.boundingBox();
  const w = await where.boundingBox();
  expect(w.y < b.y + b.height && b.y < w.y + w.height, 'the link is on the button\'s line').toBe(true);
  const gap = w.x >= b.x ? w.x - (b.x + b.width) : b.x - (w.x + w.width);
  expect(gap, 'the link sits next to the button').toBeLessThanOrEqual(24);
});

Then('the Refactor proposal {string} names its issue and a stage waiting for your OK', async ({ e2e }, title) => {
  const refactorTab = projectPage(e2e.window).locator('#project-panel-refactor');
  const row = visible(refactorTab.getByTestId('refactor-proposal')).filter({ hasText: title }).first();
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  const where = row.getByTestId('refactor-proposal-where');
  await expect(where).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(where).toHaveText(WHERE);
});

Then('the roadmap\'s last stage comes after {string}, is disabled, is named like {string} and holds {string}', async ({ e2e }, earlier, name, item) => {
  const page = e2e.window;
  const stages = page.getByTestId('roadmap-stage');
  await expect(stages.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  const names = async () => stages.evaluateAll((els) => els.map((el) => el.querySelector('input')?.value || ''));
  await expect.poll(async () => (await names()).at(-1), { timeout: LOAD_TIMEOUT, message: 'the last stage\'s name' }).toBe(name);
  const all = await names();
  expect(all.indexOf(earlier), `the stage "${earlier}"`).toBeGreaterThanOrEqual(0);
  expect(all.indexOf(earlier), `"${earlier}" comes before the waiting stage`).toBeLessThan(all.length - 1);
  const last = stages.last();
  await expect(last).toHaveAttribute('data-disabled', 'true');
  await expect(last.getByTestId('roadmap-stage-disabled')).toHaveText('Disabled');
  await expect(last.getByTestId('roadmap-item').filter({ hasText: item })).toHaveCount(1);
});

// Two reports: the earlier one with the `kept` finding only, the later one (a minute ago) with the
// `kept` finding and the `added` one, so the later shows them "kept" and "new" (compareReports)
Given('the workspace has a git project {string} with a JavaScript and a Python file and two saved architecture reports, the later one keeping {string} and adding {string}', async ({ e2e }, name, kept, added) => {
  const pick = (title) => {
    const f = SEVERITY_FINDINGS.find((x) => x.title === title);
    if (!f) throw new Error(`no seeded finding "${title}" (known: ${SEVERITY_FINDINGS.map((x) => x.title).join(', ')})`);
    return f;
  };
  await seedGitProject(e2e, name, { withReport: true, findings: [pick(kept), pick(added)] });
  const projects = require(path.join(root, 'packages', 'engine', 'domains', 'project', 'projects'));
  const project = projects.listProjects(path.join(e2e.scratch, 'workspace', 'projects')).find((p) => p.name === name);
  const dir = path.join(e2e.scratch, 'workspace', 'architecture', project.id);
  const later = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.json') && f !== 'city-plan.json')), 'utf8'));
  const date = new Date(Date.parse(later.date) - 3600e3).toISOString();
  const earlier = { ...later, id: date.replace(/[:.]/g, '-'), date, report: { ...later.report, findings: [pick(kept)] } };
  fs.writeFileSync(path.join(dir, `${earlier.id}.json`), JSON.stringify(earlier, null, 2));
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

Then('the status badge of the finding {string} reads {string}', async ({ e2e }, title, text) => {
  const badge = findingRow(e2e.window, title).getByTestId('architecture-finding-status');
  await expect(badge).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(badge).toHaveText(new RegExp(`^\\s*${escapeRe(text)}\\s*$`, 'i'));
});

// ---------- the City's "Analyze this project" reads the project's own folder (#732) ----------
// The City view's action (fronts/analyser/views/project/project-city-notes.js): the button
// data-testid="project-city-analyze" (in the "No city plan yet" note, and "Analyze again" in the error
// note), the run in progress "project-city-analyzing", the failure "project-city-analysis-error"
// (role alert, "The analysis failed" + the reason + "Analyze again" with its estimate). #732: the
// action reads the project's folder as the service has it now, not the window's cached project list,
// so a project the onboarding just created analyses at once; a project with no folder on this machine
// gets the reason in the interface language with what to do (clone it again, or point its folder from
// the Overview), and its retry shows no "≈ US$" estimate (a retry that cannot work costs nothing).

// the City mode button by its data-testid, whatever the interface language ("City" / "Cidade")
When('I switch the Architecture tab to its City view', async ({ e2e }) => {
  const button = visible(tab(e2e.window).getByTestId('architecture-mode-city')).first();
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: LOAD_TIMEOUT });
});

When('I click {string} on the city', async ({ e2e }, label) => {
  const button = visible(tab(e2e.window).getByTestId('project-city-analyze')).first();
  await expect(button).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(button).toHaveText(new RegExp(escapeRe(label), 'i'));
  await expect(button).toBeEnabled();
  await button.click();
});

Then('the city shows no analysis error', async ({ e2e }) => {
  await expect(visible(tab(e2e.window).getByTestId('project-city-analysis-error'))).toHaveCount(0);
  await expect(tab(e2e.window)).not.toContainText(/has no folder|n[ãa]o tem pasta/i);
});

// The project's folder is gone from this machine while its City is on screen (no reload: the window's
// cached project list still names the folder). The folder is moved aside, so the project entry keeps
// its path but nothing is there (projects.listProjects reports exists: false).
When('the folder of the project {string} is gone from this machine', async ({ e2e }, name) => {
  const project = projectOf(e2e, name);
  const aside = `${project.folder}-gone-732`;
  for (let attempt = 0; ; attempt += 1) {
    try { fs.renameSync(project.folder, aside); break; } catch (e) {
      if (attempt >= 10 || !['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  expect(fs.existsSync(project.folder), `the folder of "${name}" is gone`).toBe(false);
});

Then('the city says the analysis failed with {string}, to clone the project again or to point its folder from the {string} tab', async ({ e2e }, reason, overview) => {
  const note = visible(tab(e2e.window).getByTestId('project-city-analysis-error')).first();
  await expect(note).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(note).toHaveAttribute('role', 'alert');
  await expect(note).toContainText(reason);
  await expect(note, 'the reason is translated, not the English one').not.toContainText(/has no folder|nothing to analyse/i);
  await expect(note, 'it says to clone the project again').toContainText(/clon/i);
  await expect(note, `it says to point the folder from the "${overview}" tab`).toContainText(overview);
});

Then('the city\'s retry shows no cost estimate in US$', async ({ e2e }) => {
  const note = visible(tab(e2e.window).getByTestId('project-city-analysis-error')).first();
  await expect(note).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(note).not.toContainText(/≈\s*US\$/);
  await expect(note).not.toContainText(/US\$\s*\d/);
});
