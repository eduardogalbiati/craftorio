// Steps of features/568-platform-triggers.feature (#568): runs started from git platform events, by the
// `triggers:` rules of a repository's .multiagent/project.yaml, turned on per project in Settings (off by
// default) and shown on the project page. Reuses "I open {string} in the sidebar" and "I open the {string}
// settings tab" (app.steps.js) and "I open the project {string} from the Projects screen"
// (fronts/build/features/steps/projects.steps.js). The project is seeded like #791's
// (project-workflow-kinds.steps.js): created in the workspace with its workflows, its checkout holding
// the manifest, committed, then the window reloaded.
// Locators are roles and data-testid only (skills/ui-conventions).
//
// What the screens expose (the renderer's contract for these steps):
// - Settings › Execution: a "Platform triggers" group; data-testid="settings-triggers-project": one row per
//   project, holding the project's name and a checkbox (or role="switch" with aria-checked) whose
//   accessible name is "Platform triggers for <project>"; unchecked by default; saves on change.
// - On the project page (data-testid="project-page"), data-testid="project-triggers-card":
//   - project-triggers-state: data-state="on" | "off" (its text says On / Off, in the interface language);
//   - project-trigger-rule: one row per valid rule, reading "<event> → <workflow>", e.g.
//     "issue labelled ready → feature", "@orchestrator comment on a pull request → fix",
//     "failed CI on main → fix";
//   - project-trigger-invalid: one row per ignored rule, naming its event, the missing workflow and that
//     the rule is ignored (the word "ignored" in English);
//   - project-triggers-last-event: the last event seen (or that none was seen yet);
//   - project-triggers-runs: the runs the triggers started (or that none was started yet).
//
// The manifest's rules (one per table row; the event is written in plain words in the feature):
//   issue labelled <label>                    -> { on: issue_labeled, label: <label>, workflow }
//   @orchestrator comment on a pull request   -> { on: pr_comment, mention: "@orchestrator", workflow }
//   failed CI on <branch>                     -> { on: ci_failed, branch: <branch>, workflow }

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');
const { fileOf } = require('../support/workflows');

const root = path.join(__dirname, '..', '..');
const engine = (...p) => require(path.join(root, 'packages', 'engine', ...p));
const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stem = (name) => fileOf(name).replace(/\.yaml$/, '');
// a text as the screen may lay it out: any run of spaces, any case
const loose = (text) => new RegExp(escapeRe(text.trim()).replace(/\s+/g, '\\s+'), 'i');

// a git commit of everything in `folder` (fixed identity, no machine config)
function commitAll(scratch, folder) {
  const config = path.join(scratch, 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_AUTHOR_DATE: '2026-10-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T10:00:00Z' };
  const git = (args) => execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd: folder, env, encoding: 'utf8' });
  git(['init', '-q', '-b', 'main']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'Declare the repository triggers']);
}

// one table row's event, in plain words, as the manifest's rule lines
function ruleLines(event, workflow) {
  const text = event.trim();
  let m;
  if ((m = /^issue labell?ed (\S+)$/i.exec(text))) return ['  - on: issue_labeled', `    label: ${m[1]}`, `    workflow: ${workflow}`];
  if (/^@orchestrator comment on a pull request$/i.test(text)) return ['  - on: pr_comment', '    mention: "@orchestrator"', `    workflow: ${workflow}`];
  if ((m = /^failed CI on (\S+)$/i.exec(text))) return ['  - on: ci_failed', `    branch: ${m[1]}`, `    workflow: ${workflow}`];
  throw new Error(`unknown trigger event "${event}" (known: "issue labelled <label>", "@orchestrator comment on a pull request", "failed CI on <branch>")`);
}

const visible = (locator) => locator.filter({ visible: true });
const triggersCard = (page) => visible(page.getByTestId('project-page')).first().getByTestId('project-triggers-card');
const settingsSwitch = (page, name) => visible(page.getByTestId('settings-triggers-project')).filter({ hasText: name }).first()
  .getByRole('checkbox', { name: `Platform triggers for ${name}`, exact: true })
  .or(visible(page.getByTestId('settings-triggers-project')).filter({ hasText: name }).first().getByRole('switch', { name: `Platform triggers for ${name}`, exact: true }));

// ---- the project and its manifest --------------------------------------------------------------------

// The project's workflows are "feature" and "fix": a rule naming another one is invalid.
Given('the workspace has a project {string} whose repository declares these triggers:', async ({ e2e }, name, table) => {
  if (!e2e.scratch) throw new Error('no scratch folder: open the app first');
  const projects = engine('domains', 'project', 'projects');
  const dir = engine('domains', 'workspace', 'workspace').setupWorkspace(path.join(e2e.scratch, 'workspace'), { persist: false }).projects;
  const created = await projects.createProject(dir, { name, description: 'A project with platform triggers (simulated data)' });
  const workflows = [
    { name: stem('feature'), origin: 'manifest', category: 'solo' },
    { name: stem('fix'), origin: 'manifest', category: 'fix' },
  ];
  const project = projects.updateProject(dir, created.id, { repo: `https://github.com/example/${name}`, workflows, defaultWorkflow: stem('feature') });
  const yaml = [
    'version: 1',
    `default: ${stem('feature')}`,
    'workflows:',
    ...workflows.flatMap((w) => [`  - name: ${w.name}`, `    category: ${w.category}`]),
    'triggers:',
    ...table.hashes().flatMap(({ event, workflow }) => ruleLines(event, workflow.trim())),
    '',
  ].join('\n');
  fs.mkdirSync(path.join(project.folder, '.multiagent'), { recursive: true });
  fs.writeFileSync(path.join(project.folder, 'README.md'), `# ${name}\n`);
  fs.writeFileSync(path.join(project.folder, '.multiagent', 'project.yaml'), yaml);
  commitAll(e2e.scratch, project.folder);
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

// ---- Settings ----------------------------------------------------------------------------------------

When('I turn on the platform triggers of {string}', async ({ e2e }, name) => {
  const toggle = settingsSwitch(e2e.window, name);
  await expect(toggle).toBeVisible({ timeout: LOAD_TIMEOUT });
  await toggle.check();
  await expect(toggle).toBeChecked();
});

Then('the platform triggers of {string} are off', async ({ e2e }, name) => {
  const toggle = settingsSwitch(e2e.window, name);
  await expect(toggle).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(toggle).not.toBeChecked();
});

// ---- the project page's Triggers card ----------------------------------------------------------------

Then("the project's triggers are on", async ({ e2e }) => {
  await expect(triggersCard(e2e.window).getByTestId('project-triggers-state')).toHaveAttribute('data-state', 'on', { timeout: LOAD_TIMEOUT });
});

Then("the project's triggers are off", async ({ e2e }) => {
  await expect(triggersCard(e2e.window).getByTestId('project-triggers-state')).toHaveAttribute('data-state', 'off', { timeout: LOAD_TIMEOUT });
});

Then("the project's triggers show the rule {string}", async ({ e2e }, rule) => {
  const rows = triggersCard(e2e.window).getByTestId('project-trigger-rule');
  await expect(rows.filter({ hasText: loose(rule) }), `the rule "${rule}"`).toHaveCount(1, { timeout: LOAD_TIMEOUT });
});

Then("the project's triggers show the last event seen and the runs they started", async ({ e2e }) => {
  const card = triggersCard(e2e.window);
  await expect(card.getByTestId('project-triggers-last-event')).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(card.getByTestId('project-triggers-runs')).toBeVisible();
});

Then("the project's triggers report the rule for {string} as ignored, the project having no workflow {string}", async ({ e2e }, event, workflow) => {
  const card = triggersCard(e2e.window);
  const invalid = card.getByTestId('project-trigger-invalid').filter({ hasText: loose(event) });
  await expect(invalid, `the ignored rule for "${event}"`).toHaveCount(1, { timeout: LOAD_TIMEOUT });
  await expect(invalid).toContainText(workflow);
  await expect(invalid).toContainText(/ignored/i);
  // an ignored rule is not listed with the rules that run
  await expect(card.getByTestId('project-trigger-rule').filter({ hasText: loose(event) })).toHaveCount(0);
});
