// Steps of features/architecture.feature (#356, #381): a project's Architecture tab, its git facts
// (the hotspot table), the one action "Analyze this project" with its cost estimate (the project map
// run with the Oracle's analysis as its last step, no gate), a saved report (summary, findings marked
// new/gone, "Send to Refactor"), and its states. Locators are roles and data-testid only
// (skills/ui-conventions).
//
// What the tab exposes (the renderer's contract for these steps, src/renderer/views/project/):
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
// - Complexity per language (#385): the hotspot table has a "Complexity" column whenever one file is
//   measured (JavaScript/TypeScript always, inside the app), a measured file shows a whole number, a
//   file not measured shows no number (never 0); data-testid="architecture-measure-note": which
//   languages are not measured and how to install the tool ("pip install lizard", needs Python), one
//   data-testid="architecture-unmeasured-language" per language, its text the language's name. The
//   #385 scenarios skip themselves when lizard is on this machine (they describe a machine without it).
//
// The git project is seeded in the scenario's scratch folder after the app opened (like app.steps.js's
// second project): a repository on main with a .js and a .py file and three commits, the project
// entry, and optionally a saved report under <workspace>/architecture/<project id>/<stamp>.json in the
// shape architecture:analyze saves; the app reloads to read the project list again.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const root = path.join(__dirname, '..', '..');
const LOAD_TIMEOUT = 30000;
const ANALYSIS_TIMEOUT = 60000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const visible = (locator) => locator.filter({ visible: true });
const projectPage = (page) => visible(page.getByTestId('project-page')).first();
const tab = (page) => projectPage(page).locator('#project-panel-architecture');
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

// The saved report architecture:analyze writes (contract-356 §3), dated a minute ago
function savedReport(projectId, head) {
  const date = new Date(Date.now() - 60000).toISOString();
  const id = date.replace(/[:.]/g, '-');
  return {
    // a real (non-simulated) cost, so the Analyze button has an estimate from it (≈ US$ 0.42)
    id, date, project_id: projectId, costUsd: 0.42, tokens: 12000, simulated: false, head,
    report: {
      summary: SUMMARY,
      areas: [{ area: 'src', verdict: 'The API holds the billing rules.' }, { area: 'tools', verdict: 'The export repeats one of them.' }],
      findings: [{
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

async function seedGitProject(e2e, name, { withReport = false, planFolders = null, withPlan = false } = {}) {
  const workspace = require(path.join(root, 'src', 'workspace'));
  const projects = require(path.join(root, 'src', 'projects'));
  const arch = require(path.join(root, 'src', 'oracle-architecture'));
  const ws = workspace.setupWorkspace(path.join(e2e.scratch, 'workspace'), { persist: false });
  const folder = path.join(e2e.scratch, 'repos', name);
  const head = seedRepo(folder);
  const project = await projects.createProject(ws.projects, { name, folder, description: 'A git project (simulated data)' });
  const dir = path.join(ws.root, 'architecture', project.id);
  if (withReport) {
    const report = savedReport(project.id, head);
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
  const projects = require(path.join(root, 'src', 'projects'));
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

// The run folders of the scratch workspace whose records name the project-map workflow
function projectMapRuns(e2e) {
  const runsDir = path.join(e2e.scratch, 'workspace', 'runs');
  if (!fs.existsSync(runsDir)) return [];
  return fs.readdirSync(runsDir).filter((id) => ['events.jsonl', 'summary.json', 'meta.json'].some((file) => {
    try { return /project[-_ ]?map/i.test(fs.readFileSync(path.join(runsDir, id, file), 'utf8')); } catch { return false; }
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

// ---------- complexity per language (#385) ----------

// a precondition, not the app: these scenarios describe a machine without lizard (CI, a fresh PC)
Given('the complexity tool lizard is not installed on this machine', async ({ $test }) => {
  const { resolveCommand } = require(path.join(root, 'src', 'engine', 'providers'));
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
