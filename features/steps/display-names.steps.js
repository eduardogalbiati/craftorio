// Steps of features/display-names.feature (#245): screens name a workflow's steps by their display
// name, never by a snake_case step id, which stays in the element's tooltip (title). A screen's part
// is named in the step text ("roadmap progress", "run list progress", "run chat steps": REGIONS).
// Locators are roles and data-testid only (skills/ui-conventions).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// a step id: lowercase words joined by underscores ("acceptance_tests", "verify_change")
const SNAKE_CASE = /\b[a-z]+_[a-z_]+\b/g;

// the parts of the screens that name steps (every match: one per roadmap card, run row, chat tag)
const REGIONS = {
  // the text next to a roadmap card's progress ring (the step or group the run is at)
  'roadmap progress': (page) => page.getByTestId('roadmap-progress-step'),
  // a run row's progress strip (Workflows › Runs, Projects › Project)
  'run list progress': (page) => page.getByTestId('run-progress-strip'),
  // the step tag of each message in the run chat
  'run chat steps': (page) => page.getByTestId('run-chat-step'),
};
const region = (page, name) => {
  const of = REGIONS[name];
  expect(of, `a known screen part (${Object.keys(REGIONS).join(', ')})`).toBeTruthy();
  return of(page);
};

// The demo run whose id ends in `-<fragment>` (scripts/screenshot.js demoRoadmapRuns: running, owned
// by "another app") finishes its current step and starts `step`: its events.jsonl gets the two
// events (the run list re-reads a run whose file changed). Before the screen opens.
Given('the running demo run {string} has moved on to the step {string}', async ({ e2e }, fragment, step) => {
  const runs = path.join(e2e.scratch, 'workspace', 'runs');
  const dir = (fs.existsSync(runs) ? fs.readdirSync(runs) : []).find((d) => d.endsWith(`-${fragment}`));
  expect(dir, `the demo workspace has no run ending in -${fragment}`).toBeTruthy();
  const file = path.join(runs, dir, 'events.jsonl');
  const events = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const current = events.filter((e) => e.type === 'step.started').at(-1);
  expect(current, `the demo run ${dir} has a step running`).toBeTruthy();
  const now = Date.now();
  const at = (ms) => new Date(now + ms).toISOString();
  const sid = `s-${step}`;
  const session = { agent: 'test_writer', provider: 'claude', model: 'claude-sonnet-5' };
  const added = [
    { ts: at(-2000), type: 'step.finished', step_id: current.step_id, duration_ms: 60000 },
    { ts: at(-1000), type: 'step.started', step_id: step, step_type: 'agent', agent: session.agent },
    { ts: at(-500), type: 'session.opened', session_id: sid, session },
  ];
  fs.appendFileSync(file, `${added.map((e) => JSON.stringify(e)).join('\n')}\n`);
});

// Workflows › Runs (the sidebar's Runs, in the Workflows group, opens it): its search keeps the matching runs.
// #362: the step returns once the debounced search has reloaded the list: the rows shown before the
// search are marked, and it waits until every visible row is a new one that matches the query (the
// matching row is already visible before the reload, which replaces it a moment later).
When('I search the runs for {string}', async ({ e2e }, text) => {
  const page = e2e.window;
  // simulated runs are hidden until "Show simulated" is ticked: the search has to find them too
  const showSim = page.getByRole('checkbox', { name: 'Show simulated', exact: true }).filter({ visible: true }).first();
  await showSim.check();
  await page.evaluate(() => document.querySelectorAll('[data-testid="run-list-row"]').forEach((r) => r.setAttribute('data-e2e-stale', '')));
  await page.getByRole('textbox', { name: 'Search runs', exact: true }).filter({ visible: true }).first().fill(text);
  await page.waitForFunction((needle) => {
    const rows = [...document.querySelectorAll('[data-testid="run-list-row"]')].filter((r) => r.checkVisibility());
    return rows.length > 0 && rows.every((r) => !r.hasAttribute('data-e2e-stale') && `${r.dataset.run} ${r.textContent}`.toLowerCase().includes(needle));
  }, text.toLowerCase(), { timeout: LOAD_TIMEOUT });
  // the row shows its task and title, not the run id: the id is its data-run attribute
  await expect(page.locator(`[data-testid="run-list-row"][data-run$="${text}"]`).filter({ visible: true }).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// the Run screen's Chat / Details / 3D tabs (#410: a tablist "Run view" on the screen's first row)
When('I switch the run to its chat', async ({ e2e }) => {
  const page = e2e.window;
  await page.getByRole('tablist', { name: 'Run view', exact: true }).filter({ visible: true }).first()
    .getByRole('tab', { name: 'Chat', exact: true }).click();
  await expect(region(page, 'run chat steps').filter({ visible: true }).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// the readable name, case and all ("Code review", not "code_review" nor "code review")
Then('the {string} shows the step {string}', async ({ e2e }, part, name) => {
  const shown = region(e2e.window, part).filter({ visible: true }).filter({ hasText: new RegExp(escapeRe(name)) });
  await expect(shown.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// innerText only: what the screen shows, not its tooltips (title, aria-label) nor hidden hover cards
Then('no visible text in the {string} shows a snake_case step id', async ({ e2e }, part) => {
  const parts = region(e2e.window, part).filter({ visible: true });
  await expect(parts.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  const texts = await parts.evaluateAll((els) => els.map((el) => el.innerText));
  const ids = texts.flatMap((t) => t.match(SNAKE_CASE) || []);
  expect(ids, `step ids shown in the ${part}: ${texts.join(' | ')}`).toEqual([]);
});

// the tooltip of the part or of an element inside it: a native title, an aria-label, or the app's
// tooltip card (role="tooltip"), since #236 keeps native titles off the roadmap ring and step text
Then('the {string} tooltip contains {string}', async ({ e2e }, part, id) => {
  const parts = region(e2e.window, part).filter({ visible: true });
  await expect(parts.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  const titles = await parts.evaluateAll((els) => els.flatMap((el) => {
    const up = el.parentElement || el;
    const scope = up.closest('li, article, [data-testid]') || up;
    return [el, ...el.querySelectorAll('[title], [aria-label]'), ...scope.querySelectorAll('[role="tooltip"]')]
      .flatMap((n) => [n.getAttribute('title'), n.getAttribute('aria-label'),
        n.getAttribute('role') === 'tooltip' ? n.textContent : null]);
  }).filter(Boolean));
  expect(titles.some((t) => t.includes(id)), `a tooltip with "${id}" among: ${titles.join(' | ')}`).toBe(true);
});
