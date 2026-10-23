// Steps of features/app.feature, features/settings.feature and features/navigation.feature (#222,
// #254, #264): open the app, move through the sidebar's menu (grouped by the flow: Home, Plan &
// Design, Code & Build, Workflows, AI, Night watch, Settings; a group's title collapses it), the
// header (project selector, Oracle, notifications bell), the Workflows screen's tabs, Settings
// (#276: Execution's Memory guard group), the failed app update banner (#279), the Pipelines tab's
// cards (features/pipelines.feature, #378), the window kept on the app's page (#466), Settings ›
// About's warning when the app was started without Chromium's sandbox (#476).
// Locators are roles and data-testid only (skills/ui-conventions).
// #254: a menu group is a role="group" named by its title, holding its title's toggle button
// (aria-expanded, named like the group) and its items' buttons; the header's project selector is a
// <select> with data-testid="header-project" (accessible name "Project").

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { VISUAL_NOW } = require('../support/fixed-clock');
const { Given, When, Then } = require('./fixtures');
const { LOAD_TIMEOUT, runScreenStatus, demoProjectCard, openProjects } = require('../support/run-screen');

const root = path.join(__dirname, '..', '..');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sidebar = (page) => page.getByRole('navigation');
const header = (page) => page.getByRole('banner');
// a sidebar entry by its label; a count badge may follow it ("Backlog 2", or "Night watch ☾ 0" while a watch is on)
const entryName = (name) => new RegExp(`^${escapeRe(name)}(\\s+(☾\\s+)?\\d+)?$`);
const navItem = (page, name) => sidebar(page).getByRole('button', { name: entryName(name) });
const menuGroup = (page, name) => sidebar(page).getByRole('group', { name, exact: true });
const groupToggle = (page, name) => menuGroup(page, name).getByRole('button', { name, exact: true });
const workflowsTabs = (page) => page.getByRole('tablist', { name: 'Workflows', exact: true });

Given('the app is open', async ({ e2e }) => {
  await e2e.open();
});

// the visual scenarios' opening: they render at a fixed clock, never the real one (#362)
Given('the app is open in the {word} theme', async ({ e2e }, theme) => {
  await e2e.open({ theme, now: VISUAL_NOW });
});

When('I open {string} in the sidebar', async ({ e2e }, name) => {
  await navItem(e2e.window, name).click();
});

When('I reload the app', async ({ e2e }) => {
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

Then('the sidebar offers {string}', async ({ e2e }, name) => {
  await expect(navItem(e2e.window, name)).toBeVisible();
});

Then('the sidebar does not offer {string}', async ({ e2e }, name) => {
  await expect(navItem(e2e.window, 'Home')).toBeVisible();
  await expect(navItem(e2e.window, name)).toHaveCount(0);
});

// #412: the run's status is on the Run screen's tab row (run-screen-status), no longer in the header.
// The status id (#266: the pill reads "Running", "Paused"…; its id stays in data-status). "idle": no
// run is on screen, or the one shown is idle.
Then('the run status shows {string}', async ({ e2e }, text) => {
  const page = e2e.window;
  await expect(navItem(page, 'Home')).toBeVisible();
  const shown = page.getByTestId('run-screen-status').filter({ visible: true });
  if (text === 'idle' && !(await shown.count())) return;
  await expect(runScreenStatus(page)).toHaveAttribute('data-status', text, { timeout: LOAD_TIMEOUT });
});

// #412: no Start in the header; the Start panel opens from Projects › a project's "Start workflow"
Then('the Start a workflow button is enabled', async ({ e2e }) => {
  await openProjects(e2e);
  await expect(demoProjectCard(e2e).getByRole('button', { name: 'Start workflow', exact: true })).toBeEnabled();
});

When('I open the {string} settings tab', async ({ e2e }, name) => {
  await e2e.window.getByRole('button', { name, exact: true }).click();
});

When('I choose {string} as the default development workflow', async ({ e2e }, file) => {
  // fails when the workflow is not offered
  await e2e.window.getByTestId('settings-default-workflow').selectOption(file);
});

Then('the default development workflow is {string}', async ({ e2e }, file) => {
  await expect(e2e.window.getByRole('combobox', { name: 'Default development workflow' })).toHaveValue(file);
});

// ---- Settings › Execution › Memory guard (#276) -------------------------------------------------------
// data-testids: memory-guard-enabled (checkbox), memory-guard-limit / memory-guard-floor (number
// inputs), memory-guard-limit-hint ("(8.0 GB on this machine)"). A field saves on change, like the
// rest of the Execution tab: setting a value fills it and leaves it (Tab).

const memoryGuard = (page, field) => page.getByTestId(`memory-guard-${field}`);

Then('the memory guard is on', async ({ e2e }) => {
  await expect(memoryGuard(e2e.window, 'enabled')).toBeChecked();
});

// field: limit | floor
Then("the memory guard's {word} is {int}", async ({ e2e }, field, value) => {
  await expect(memoryGuard(e2e.window, field)).toHaveValue(String(value));
});

When("I set the memory guard's {word} to {int}", async ({ e2e }, field, value) => {
  const input = memoryGuard(e2e.window, field);
  await input.fill(String(value));
  await input.press('Tab');
});

// the hint's GB figure is the limit's share of this machine's RAM (GiB or GB, one decimal)
Then("the memory guard's hint gives its limit in GB for this machine", async ({ e2e }) => {
  const os = require('os');
  const page = e2e.window;
  const limit = Number(await memoryGuard(page, 'limit').inputValue());
  const hint = memoryGuard(page, 'limit-hint');
  await expect(hint).toHaveText(/\d+(\.\d+)?\s*GB/);
  const shown = Number((await hint.innerText()).match(/(\d+(?:\.\d+)?)\s*GB/)[1]);
  const bytes = (os.totalmem() * limit) / 100;
  expect(shown).toBeGreaterThanOrEqual(Math.floor((bytes / 1024 ** 3) * 10) / 10 - 0.1);
  expect(shown).toBeLessThanOrEqual(Math.ceil((bytes / 1e9) * 10) / 10 + 0.1);
});

// the field's error state: aria-invalid, an error/invalid class, or the input's own :invalid
Then("the memory guard's {word} field shows an error", async ({ e2e }, field) => {
  const input = memoryGuard(e2e.window, field);
  await expect.poll(() => input.evaluate((el) => el.getAttribute('aria-invalid') === 'true'
    || /\b(error|invalid)\b/.test(el.className) || el.matches(':invalid'))).toBe(true);
});

// ---- the menu by the flow (#254) ---------------------------------------------------------------------

// | entry | items |: an entry is a group's title (its items comma-separated) or a single item (no
// items); the entries follow each other top to bottom in the table's order
Then('the sidebar reads, top to bottom:', async ({ e2e }, table) => {
  const page = e2e.window;
  let lastY = -Infinity;
  for (const row of table.hashes()) {
    const items = String(row.items || '').split(',').map((s) => s.trim()).filter(Boolean);
    const entry = items.length ? groupToggle(page, row.entry) : navItem(page, row.entry);
    await expect(entry, `the sidebar's entry "${row.entry}"`).toBeVisible();
    const box = await entry.boundingBox();
    expect(box.y, `"${row.entry}" comes after the entry above it`).toBeGreaterThan(lastY);
    lastY = box.y;
    for (const item of items) {
      await expect(menuGroup(page, row.entry).getByRole('button', { name: entryName(item) }), `"${item}" in the group "${row.entry}"`).toBeVisible();
    }
  }
});

Then('{string} is the top entry of the sidebar', async ({ e2e }, name) => {
  const page = e2e.window;
  const top = await navItem(page, name).boundingBox();
  expect(top, `the sidebar's entry "${name}"`).not.toBeNull();
  for (const button of await sidebar(page).getByRole('button').filter({ visible: true }).all()) {
    const box = await button.boundingBox();
    if (box) expect(box.y).toBeGreaterThanOrEqual(top.y);
  }
});

When('I collapse the {string} menu group', async ({ e2e }, name) => {
  const toggle = groupToggle(e2e.window, name);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

Then('the {string} menu group is collapsed, hiding {string}', async ({ e2e }, name, item) => {
  const page = e2e.window;
  await expect(groupToggle(page, name)).toHaveAttribute('aria-expanded', 'false');
  await expect(menuGroup(page, name).getByRole('button', { name: entryName(item) })).toBeHidden();
});

Then('the Workflows screen is on its {string} tab', async ({ e2e }, name) => {
  await expect(workflowsTabs(e2e.window).getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
});

// ---- the Pipelines tab's cards (#378: the bundled release-then-refactors pipeline) ---------------------
// A pipeline card is data-testid="pipeline-card" with data-pipe="<file name>" (its display name is
// not fixed); its description data-testid="pipeline-description"; each stage data-testid="pipeline-stage"
// (a workflow's carries data-goto="<workflow file>", the Product Owner's reads "Product Owner").
const LIST_TIMEOUT = 30000;
const pipelineCard = (page, file) => page.locator(`[data-testid="pipeline-card"][data-pipe="${file}"]`).filter({ visible: true });

Then('the Pipelines tab lists the pipeline {string}', async ({ e2e }, file) => {
  await expect(pipelineCard(e2e.window, file)).toHaveCount(1, { timeout: LIST_TIMEOUT });
});

Then('the pipeline {string} runs {string}, then {string}, then the Product Owner', async ({ e2e }, file, first, second) => {
  const stages = pipelineCard(e2e.window, file).getByTestId('pipeline-stage');
  await expect(stages).toHaveCount(3);
  await expect(stages.nth(0)).toHaveAttribute('data-goto', first);
  await expect(stages.nth(1)).toHaveAttribute('data-goto', second);
  await expect(stages.nth(2)).toContainText('Product Owner');
});

// the description says the analysis is a real model call and gives a cost estimate (an amount in dollars)
Then('the description of the pipeline {string} says {string} and gives a cost estimate', async ({ e2e }, file, text) => {
  const description = pipelineCard(e2e.window, file).getByTestId('pipeline-description');
  await expect(description).toContainText(new RegExp(escapeRe(text), 'i'));
  await expect(description).toContainText(/\$\s?\d|\d(\.\d+)?\s*(USD|dollars?)\b/i);
});

// ---- the header: project selector, Oracle, notifications (#254) --------------------------------------

const projectSelect = (page) => header(page).getByTestId('header-project');

// A second project, with its own synced backlog of one open issue, added to the scratch workspace;
// the app reloads to read the project list again
Given('the workspace has a second project {string} whose backlog has the open issue {string}', async ({ e2e }, name, title) => {
  const workspace = require(path.join(root, 'src', 'workspace'));
  const projects = require(path.join(root, 'src', 'projects'));
  const { taskProgress } = require(path.join(root, 'src', 'backlog'));
  const ws = workspace.setupWorkspace(path.join(e2e.scratch, 'workspace'), { persist: false });
  const repo = `https://github.com/example/${name}`;
  const created = await projects.createProject(ws.projects, { name, description: 'A second project (simulated data)' });
  const project = projects.updateProject(ws.projects, created.id, { repo });
  const now = new Date().toISOString();
  const issue = { number: 1, title, state: 'open', labels: [], body: '', url: `${repo}/issues/1`, author: 'octocat', assignees: [], tasks: taskProgress(''), createdAt: now, updatedAt: now };
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${project.id}.json`), JSON.stringify({ projectId: project.id, platform: 'github', repo, syncedAt: now, issues: [issue], epics: [], epicsError: null }, null, 2));
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

Then('the header shows the project {string}', async ({ e2e }, name) => {
  const select = projectSelect(e2e.window);
  await expect(select).toBeVisible();
  await expect.poll(() => select.evaluate((el) => el.selectedOptions[0]?.textContent.trim())).toBe(name);
});

When('I choose the project {string} in the header', async ({ e2e }, name) => {
  await projectSelect(e2e.window).selectOption({ label: name });
});

When('I open the notifications from the header bell', async ({ e2e }) => {
  await header(e2e.window).getByRole('button', { name: /^Notifications\b/ }).click();
});

Then('the notification centre is open', async ({ e2e }) => {
  await expect(e2e.window.getByRole('dialog', { name: 'Notifications', exact: true })).toBeVisible();
});

Then('the header offers {string}', async ({ e2e }, name) => {
  await expect(header(e2e.window).getByRole('button', { name: entryName(name) })).toBeVisible();
});

// ---- the header without the run's controls (#412) -----------------------------------------------------
// The header keeps: the project select (header-project), the 24/7 chip (occupancy-chip) and the usage
// widget (usage-widget) right after it, the Oracle's button, the notifications bell, and the account chip
// (account-chip) last at the right end. The run's status and id, its KPIs, Open logs, Start, Stop and
// "Pause after current step" are gone from it (Stop and Pause are on the Run screen's tab row, #410).

const HEADER_ITEMS = {
  Project: (page) => projectSelect(page),
  '24/7': (page) => header(page).getByTestId('occupancy-chip'),
  Usage: (page) => header(page).getByTestId('usage-widget'),
  Oracle: (page) => header(page).getByRole('button', { name: /^Oracle\b/ }),
  Notifications: (page) => header(page).getByRole('button', { name: /^Notifications\b/ }),
  Account: (page) => header(page).getByTestId('account-chip'),
};

// reading order: on the same row (vertical centres within the other's height) left to right, else top to bottom
const comesAfter = (a, b) => {
  const sameRow = Math.abs((a.y + a.height / 2) - (b.y + b.height / 2)) < Math.max(a.height, b.height) / 2;
  return sameRow ? b.x >= a.x + a.width - 1 : b.y > a.y;
};

// | item |: Project, 24/7, Usage, Oracle, Notifications, Account
Then('the header reads, left to right:', async ({ e2e }, table) => {
  const page = e2e.window;
  let prev = null;
  for (const { item } of table.hashes()) {
    const of = HEADER_ITEMS[item];
    expect(of, `a known header item (${Object.keys(HEADER_ITEMS).join(', ')})`).toBeTruthy();
    const el = of(page).first();
    await expect(el, `the header's "${item}"`).toBeVisible({ timeout: LOAD_TIMEOUT });
    const box = await el.boundingBox();
    if (prev) expect(comesAfter(prev.box, box), `"${item}" comes after "${prev.item}" in the header`).toBe(true);
    prev = { item, box };
  }
});

// nothing the header shows lies to the right of the account chip
Then('the account chip is at the right end of the header', async ({ e2e }) => {
  const page = e2e.window;
  const chip = HEADER_ITEMS.Account(page).first();
  await expect(chip).toBeVisible({ timeout: LOAD_TIMEOUT });
  const end = await chip.boundingBox();
  const controls = header(page).locator('button, select, a, [role="button"]').filter({ visible: true });
  for (const control of await controls.all()) {
    const box = await control.boundingBox();
    if (!box || (await control.getAttribute('data-testid')) === 'account-chip') continue;
    const name = (await control.getAttribute('aria-label')) || (await control.innerText()).trim();
    expect(box.x + box.width, `"${name}" ends before the account chip`).toBeLessThanOrEqual(end.x + end.width + 1);
  }
});

Then('the header shows no run status, no run KPIs, and no Start, Stop, Pause after current step or Open logs button', async ({ e2e }) => {
  const page = e2e.window;
  const bar = header(page);
  await expect(projectSelect(page)).toBeVisible();
  for (const id of ['run-status', 'run-id', 'run-total-cost', 'quick-start', 'run-pause', 'run-stop']) {
    await expect(bar.getByTestId(id), `the header's ${id}`).toHaveCount(0);
  }
  for (const name of ['Start', 'Stop', 'Pause after current step', 'Open logs']) {
    await expect(bar.getByRole('button', { name, exact: true }).filter({ visible: true }), `the header's "${name}" button`).toHaveCount(0);
  }
  for (const kpi of ['Time', 'Sessions', 'Tokens in / out', 'Reasoning', 'Cost']) {
    await expect(bar.getByText(kpi, { exact: true }).filter({ visible: true }), `the header's "${kpi}" KPI`).toHaveCount(0);
  }
});

// ---- a failed app update (#279) -----------------------------------------------------------------------
// <workspace>/oracle/app-update.json is the intent Self-healing writes before it applies merged fixes to
// the app: { from, to, subjects, roadmaps, appDir, at }. Still there with `at` over 2 minutes old: the new
// code did not start. The app then shows data-testid="app-update-failed-banner" (what was updated and
// `git -C <appDir> checkout <from>`, not role="banner": that is the header) with a "Dismiss" button,
// kept until dismissed. The app checks when the window loads, so the step reloads it.

const failedUpdateBanner = (page) => page.getByTestId('app-update-failed-banner');

Given('an app update from {string} to {string} was started {int} minutes ago without finishing', async ({ e2e }, from, to, minutes) => {
  const dir = path.join(e2e.scratch, 'workspace', 'oracle');
  fs.mkdirSync(dir, { recursive: true });
  const intent = {
    from, to,
    subjects: ['Fix the roadmap dispatch after a restart'],
    roadmaps: [],
    appDir: root,
    at: new Date(Date.now() - minutes * 60000).toISOString(),
  };
  fs.writeFileSync(path.join(dir, 'app-update.json'), JSON.stringify(intent, null, 2));
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
});

Then('a banner says the app update to {string} did not start', async ({ e2e }, to) => {
  const banner = failedUpdateBanner(e2e.window);
  await expect(banner).toBeVisible({ timeout: 30000 });
  await expect(banner).toContainText(to);
  await expect(banner).toContainText('Fix the roadmap dispatch after a restart');
});

Then('the banner gives the command to go back to {string}', async ({ e2e }, from) => {
  await expect(failedUpdateBanner(e2e.window)).toContainText(new RegExp(`git -C .+ checkout ${escapeRe(from)}`));
});

When('I dismiss the failed app update banner', async ({ e2e }) => {
  await failedUpdateBanner(e2e.window).getByRole('button', { name: /^Dismiss/ }).click();
});

Then('no failed app update banner shows', async ({ e2e }) => {
  await expect(navItem(e2e.window, 'Home')).toBeVisible();
  await expect(failedUpdateBanner(e2e.window)).toHaveCount(0);
});

// ---- the window never leaves the app's page (#466) ----------------------------------------------------
// A form, a link or a dropped file must never navigate the window away from the app's index.html. A
// drop that Playwright dispatches is not a trusted event, so Chromium never navigates on it: the step
// records whether the app refused it (dragover and drop default-prevented, which is what keeps a real
// drop from opening the file), and the page is checked as well.

Then('the app is still on its own page', async ({ e2e }) => {
  const page = e2e.window;
  // a navigation, if one was triggered, has had the time to start
  await page.waitForTimeout(1000);
  expect(page.url(), 'the window is on the app\'s page').toMatch(/\/index\.html([?#].*)?$/);
  await expect(navItem(page, 'Home')).toBeVisible();
});

When('I drop an HTML file onto the Home screen, outside any drop box', async ({ e2e }) => {
  const page = e2e.window;
  await navItem(page, 'Home').click();
  const target = page.getByRole('main').first();
  await expect(target).toBeVisible({ timeout: LOAD_TIMEOUT });
  e2e.lastDrop = await target.evaluate((el) => {
    const data = new DataTransfer();
    data.items.add(new File(['<h1>Not the app</h1>'], 'report.html', { type: 'text/html' }));
    const fire = (type) => {
      const ev = new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true, composed: true });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    fire('dragenter');
    const over = fire('dragover');
    const drop = fire('drop');
    return { over, drop };
  });
});

Then('the window refuses the dropped file', async ({ e2e }) => {
  expect(e2e.lastDrop, 'a file was dropped').toBeTruthy();
  expect(e2e.lastDrop.over, 'the window refuses a file dragged over it').toBe(true);
  expect(e2e.lastDrop.drop, 'the window refuses a file dropped on it').toBe(true);
});

// ---- started without Chromium's sandbox (#476) --------------------------------------------------------
// The Linux AppImage's launcher sets MULTIAGENT_NO_SANDBOX=1 when it falls back to --no-sandbox; the
// scenario sets it the same way. Settings › About's warning: data-testid="settings-sandbox-warning".

const sandboxWarning = (page) => page.getByTestId('settings-sandbox-warning');

Given('the app was started without the Chromium sandbox', async ({ e2e }) => {
  await e2e.open({ env: { MULTIAGENT_NO_SANDBOX: '1' } });
});

Then('Settings warns that the app runs without the sandbox', async ({ e2e }) => {
  await expect(sandboxWarning(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(sandboxWarning(e2e.window)).toContainText(/sandbox/i);
});

Then('the sandbox warning mentions {string}', async ({ e2e }, text) => {
  await expect(sandboxWarning(e2e.window)).toContainText(text);
});

Then('Settings shows no sandbox warning', async ({ e2e }) => {
  // the About tab has drawn (its app version shows) before the warning's absence counts
  await expect(e2e.window.getByText('App version', { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(sandboxWarning(e2e.window)).toHaveCount(0);
});

// ---- no Supervisor in the header (#264)---------------------------------------------------------------

// every screen the menu opens (a group's title only collapses its group: skipped)
Then('no screen of the menu shows a {string} button in the header', async ({ e2e }, name) => {
  const page = e2e.window;
  const items = [];
  for (const button of await sidebar(page).getByRole('button').filter({ visible: true }).all()) {
    if ((await button.getAttribute('aria-expanded')) !== null) continue;
    items.push((await button.innerText()).replace(/\s+\d+$/, '').trim());
  }
  expect(items.length, 'the menu has screens').toBeGreaterThan(5);
  for (const item of items) {
    await navItem(page, item).click();
    await expect(header(page).getByRole('button', { name: new RegExp(escapeRe(name)) }), `the header on "${item}"`).toHaveCount(0);
  }
});
