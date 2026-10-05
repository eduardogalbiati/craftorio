// Steps of features/roadmap.feature: the Roadmap's readable statuses and run chip (#266), a stage's
// "+n done" chip (#267), the date filter, the Planned | All switch, infinite scroll and the header
// count (#268), the live run timer and a fix round (#272), no "Update the app after this" switch (#279),
// the bar's state dot, icons, ⋮ menu and filter row (#269), "Ask the Oracle about this failure" (#271),
// Undo a removal and earlier versions (#281), the developer's effort in Edit and on the card (#286),
// the item card's bands, Workflow band, pipeline and the
// stage actions menu (#282), disabling a stage (#284), no "Update the app after this" control (#285), on the demo roadmap (scripts/screenshot.js
// demoRoadmap / demoRoadmapRuns). Locators are roles and data-testid only (skills/ui-conventions).
//
// What the screens expose (the renderer's contract for these steps):
// - data-testid="roadmap-item" (exists) carries data-status: the item's status id (planned, running,
//   waiting, done, failed, skipped); a start refused before any run keeps its own id there.
// - data-testid="status-label": a readable status ("Running", "Failed", "Failed to start", "Waiting
//   for approval"…) with data-status = its id: on the roadmap card, in the run chip, in a run row.
//   A running one pulses (a CSS animation on it or on its ::before dot, like the sidebar's blue dot).
// - data-testid="run-chip": the kanban's run chip, on the roadmap card too: a button (status, the
//   workflow's display name, the run's title) with data-run = the run id; a click opens the run.
// - data-testid="run-id" on the Run screen's run id (index.html's #run-id).
// - data-testid="roadmap-done-chip": a stage's "+n done" / "Hide n done" button, aria-expanded.
// - role group "Roadmap items" with the buttons "Planned" and "All" (aria-pressed).
// - data-testid="roadmap-date-filter": a <select> (accessible name "Date range") with the 7 ranges.
// - data-testid="roadmap-count" header: "N of M items · last 24 hours".
// - data-testid="roadmap-loading": the "Loading…" row of the infinite scroll.
// - data-testid="roadmap-run-timer": the run timer under the progress ring ("52:13", "6:40:02"),
//   data-tone = ok | warn | over.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const roadmapItem = (page, title) => page.getByTestId('roadmap-item').filter({ hasText: title }).first();
const runChip = (page, title) => roadmapItem(page, title).getByTestId('run-chip');
const itemStatus = (page, title) => roadmapItem(page, title).getByTestId('status-label').first();
// stage n as the roadmap numbers it ("Stage 2"), whether or not the stages before it are shown
const stage = (page, n) => page.getByTestId('roadmap-stage').filter({ hasText: new RegExp(`\\bStage ${n}\\b`) }).first();
const doneChip = (page, n) => stage(page, n).getByTestId('roadmap-done-chip');
const itemSwitch = (page) => page.getByRole('group', { name: 'Roadmap items', exact: true });
const dateFilter = (page) => page.getByTestId('roadmap-date-filter');
const header = (page) => page.getByTestId('roadmap-count');
const timer = (page, title) => roadmapItem(page, title).getByTestId('roadmap-run-timer');
const ringOf = (item) => item.getByRole('button', { name: /Show the run's steps/ });

// ---- the demo workspace, edited before the screen opens (the app follows the files) -----------------

const roadmapFile = (e2e) => path.join(e2e.scratch, 'workspace', 'backlog', `${e2e.project.id}.roadmap.json`);
function editRoadmap(e2e, fn) {
  const file = roadmapFile(e2e);
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  fn(r);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...r, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, file);
}
const titleOf = (x) => x.issues?.[0]?.title || x.title || '';

function runEvents(e2e, fragment) {
  const runs = path.join(e2e.scratch, 'workspace', 'runs');
  const dir = (fs.existsSync(runs) ? fs.readdirSync(runs) : []).find((d) => d.endsWith(`-${fragment}`));
  expect(dir, `the demo workspace has no run ending in -${fragment}`).toBeTruthy();
  const file = path.join(runs, dir, 'events.jsonl');
  return { file, events: fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
}

// a copy of one of tonight's done items (its run finished a few hours ago) into stage n
Given('stage {int} of the roadmap also has an item done tonight', async ({ e2e }, n) => {
  editRoadmap(e2e, (r) => {
    const tonight = r.stages.find((s) => s.id === 'stage-tonight');
    const done = tonight?.items.find((x) => x.status === 'done' && x.runId);
    expect(done, 'a done item with a run in the demo stage "Tonight"').toBeTruthy();
    const target = r.stages[n - 1];
    expect(target, `the demo roadmap's stage ${n}`).toBeTruthy();
    target.items.push({ ...JSON.parse(JSON.stringify(done)), id: `${done.id}-copy-${n}` });
  });
});

Given('the roadmap item {string} was skipped', async ({ e2e }, title) => {
  editRoadmap(e2e, (r) => {
    const item = r.stages.flatMap((s) => s.items).find((x) => titleOf(x) === title);
    expect(item, `a roadmap item "${title}"`).toBeTruthy();
    Object.assign(item, { status: 'skipped', error: null });
  });
});

// a last stage of `count` planned items, issues #1001…
Given('the roadmap has a stage of {int} planned items', async ({ e2e }, count) => {
  editRoadmap(e2e, (r) => {
    const model = r.stages.flatMap((s) => s.items).find((x) => x.status === 'planned' && !x.runId && !x.error);
    const items = Array.from({ length: count }, (_, k) => {
      const number = 1001 + k;
      const issue = { number, url: `https://github.com/example/demo-app/issues/${number}`, title: `Planned item ${number}`, body: '', knownPullRequests: [] };
      return { ...JSON.parse(JSON.stringify(model)), id: `bulk-${number}`, ...issue, issues: [issue], status: 'planned', runId: null, runs: [], error: null };
    });
    r.stages.push({ id: 'stage-bulk', name: 'Bulk', note: '', items });
  });
});

// every event of the run moved earlier, so it started `minutes` ago (its current step still running)
Given('the running demo run {string} started {int} minutes ago', async ({ e2e }, fragment, minutes) => {
  const { file, events } = runEvents(e2e, fragment);
  const start = Date.parse(events.find((e) => e.type === 'workflow.started').ts);
  const shift = Date.now() - minutes * 60000 - start;
  const moved = events.map((e) => ({ ...e, ts: new Date(Date.parse(e.ts) + shift).toISOString() }));
  fs.writeFileSync(file, `${moved.map((e) => JSON.stringify(e)).join('\n')}\n`);
});

// the reviewer sends the change back: code review finishes and develop starts again (its 2nd visit)
When('the running demo run {string} goes back from code review to develop', async ({ e2e }, fragment) => {
  const { file, events } = runEvents(e2e, fragment);
  const current = events.filter((e) => e.type === 'step.started').at(-1);
  expect(current?.step_id, `the demo run ${fragment} is in code review`).toBe('code_review');
  const now = Date.now();
  const at = (ms) => new Date(now + ms).toISOString();
  const session = { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' };
  const added = [
    { ts: at(-3000), type: 'session.message_received', session_id: 's-code_review', step_id: 'code_review', cost_usd: 0.4, duration_ms: 60000, session: { agent: 'reviewer', provider: 'claude', model: 'claude-sonnet-5-5' } },
    { ts: at(-2000), type: 'step.finished', step_id: 'code_review', duration_ms: 6 * 60000, outcome: 'changes_requested' },
    { ts: at(-1000), type: 'step.started', step_id: 'develop', step_type: 'agent', agent: session.agent },
    { ts: at(-500), type: 'session.opened', session_id: 's-develop-2', session },
  ];
  fs.appendFileSync(file, `${added.map((e) => JSON.stringify(e)).join('\n')}\n`);
});

// ---- #266: readable statuses, the run chip --------------------------------------------------------------

Then('the roadmap item {string} shows a run chip reading {string}', async ({ e2e }, title, label) => {
  const chip = runChip(e2e.window, title);
  await expect(chip).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(chip.getByTestId('status-label')).toHaveText(label);
  await expect(chip.getByTestId('status-label')).toHaveAttribute('data-status', label.toLowerCase().replace(/\s+/g, '_'));
});

Then('the run chip of the roadmap item {string} names the workflow {string}', async ({ e2e }, title, name) => {
  await expect(runChip(e2e.window, title)).toContainText(new RegExp(escapeRe(name), 'i'));
});

Then('the {string} status of the roadmap item {string} pulses', async ({ e2e }, label, title) => {
  const status = itemStatus(e2e.window, title);
  await expect(status).toHaveText(label);
  const animated = await status.evaluate((el) => [getComputedStyle(el), getComputedStyle(el, '::before'), getComputedStyle(el, '::after')]
    .some((s) => s.animationName && s.animationName !== 'none'));
  expect(animated, `the "${label}" status has a pulse animation`).toBe(true);
});

When('I click the run chip of the roadmap item {string}', async ({ e2e }, title) => {
  await runChip(e2e.window, title).click();
});

Then('the run screen shows the run {string}', async ({ e2e }, fragment) => {
  await expect(e2e.window.getByTestId('run-id')).toContainText(fragment, { timeout: LOAD_TIMEOUT });
});

Then('the roadmap item {string} shows the status {string}', async ({ e2e }, title, label) => {
  await expect(itemStatus(e2e.window, title)).toHaveText(label);
});

// neither a link, a button nor inside one: nothing to open (no run)
Then('the status of the roadmap item {string} is not a link', async ({ e2e }, title) => {
  const status = itemStatus(e2e.window, title);
  await expect(status).toBeVisible();
  expect(await status.evaluate((el) => !!el.closest('a, button, [role="link"], [role="button"]'))).toBe(false);
  await expect(runChip(e2e.window, title)).toHaveCount(0);
});

Then('the roadmap item {string} shows the error {string}', async ({ e2e }, title, text) => {
  await expect(roadmapItem(e2e.window, title)).toContainText(text);
});

Then('the roadmap item {string} offers Retry and Skip, enabled', async ({ e2e }, title) => {
  const item = roadmapItem(e2e.window, title);
  await expect(item.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
  await expect(item.getByRole('button', { name: 'Skip', exact: true })).toBeEnabled();
});

// what the screen shows (innerText) starts with a capital and is not the bare id kept in data-status
Then('every status on the roadmap reads as a capitalised label, not its id', async ({ e2e }) => {
  const labels = e2e.window.getByTestId('roadmap-item').getByTestId('status-label').filter({ visible: true });
  await expect(labels.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  const shown = await labels.evaluateAll((els) => els.map((el) => ({ text: el.innerText.trim(), id: el.getAttribute('data-status') })));
  expect(shown.length).toBeGreaterThanOrEqual(4);
  for (const { text, id } of shown) {
    expect(id, `"${text}" keeps its status id in data-status`).toBeTruthy();
    expect(text, `the status "${id}" reads as a label`).toMatch(/^[A-Z]/);
    expect(text).not.toBe(id);
  }
});

Then('the run list row of {string} shows the status {string} with the id {string}', async ({ e2e }, fragment, label, id) => {
  const row = e2e.window.locator(`[data-testid="run-list-row"][data-run$="${fragment}"]`).filter({ visible: true }).first();
  const status = row.getByTestId('status-label').first();
  await expect(status).toHaveText(label, { timeout: LOAD_TIMEOUT });
  await expect(status).toHaveAttribute('data-status', id);
});

// ---- #267: a stage's "+n done" chip -----------------------------------------------------------------------

Then('stage {int} offers the chip {string}, {word}', async ({ e2e }, n, text, state) => {
  expect(['folded', 'expanded']).toContain(state);
  const chip = doneChip(e2e.window, n);
  await expect(chip).toHaveText(text);
  await expect(chip).toHaveAttribute('aria-expanded', state === 'expanded' ? 'true' : 'false');
});

When('I click the done chip of stage {int}', async ({ e2e }, n) => {
  await doneChip(e2e.window, n).click();
});

Then('stage {int} shows {int} done items', async ({ e2e }, n, count) => {
  await expect(stage(e2e.window, n).locator('[data-testid="roadmap-item"][data-status="done"]')).toHaveCount(count);
});

// ---- #268: Planned | All, the date filter, the header, infinite scroll ---------------------------------

Then("the roadmap's item switch is on {string}", async ({ e2e }, name) => {
  const group = itemSwitch(e2e.window);
  await expect(group.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const other of ['Planned', 'All'].filter((x) => x !== name)) {
    await expect(group.getByRole('button', { name: other, exact: true })).toHaveAttribute('aria-pressed', 'false');
  }
});

When('I switch the roadmap to {string}', async ({ e2e }, name) => {
  await itemSwitch(e2e.window).getByRole('button', { name, exact: true }).click();
  await expect(itemSwitch(e2e.window).getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
});

Then('the roadmap offers no {string} checkbox', async ({ e2e }, name) => {
  await expect(e2e.window.getByRole('checkbox', { name, exact: true })).toHaveCount(0);
});

Then("the roadmap's date filter is {string}", async ({ e2e }, label) => {
  await expect.poll(() => dateFilter(e2e.window).evaluate((el) => el.selectedOptions[0]?.textContent.trim())).toBe(label);
});

Then("the roadmap's date filter offers {string}, {string}, {string}, {string}, {string}, {string} and {string}", async ({ e2e }, a, b, c, d, e, f, g) => {
  const labels = [a, b, c, d, e, f, g];
  const options = (await dateFilter(e2e.window).locator('option').allTextContents()).map((t) => t.trim());
  expect(options).toEqual(labels);
});

When("I set the roadmap's date filter to {string}", async ({ e2e }, label) => {
  await dateFilter(e2e.window).selectOption({ label });
});

// "N of M items · last 24 hours": N is the number of item cards shown, M at least N
Then('the roadmap header counts the items shown out of all, for {string}', async ({ e2e }, range) => {
  const page = e2e.window;
  const re = new RegExp(`^(\\d+) of (\\d+) items? · ${escapeRe(range)}$`);
  await expect(header(page)).toHaveText(re);
  const [, n, m] = (await header(page).innerText()).trim().match(re);
  expect(Number(m)).toBeGreaterThanOrEqual(Number(n));
  await expect(page.getByTestId('roadmap-item')).toHaveCount(Number(n));
});

Then('the roadmap shows the {word} item {string}', async ({ e2e }, status, title) => {
  await expect(e2e.window.locator(`[data-testid="roadmap-item"][data-status="${status}"]`).filter({ hasText: title }).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the roadmap does not show the {word} item {string}', async ({ e2e }, status, title) => {
  const page = e2e.window;
  await expect(page.getByTestId('roadmap-item').first()).toBeVisible();
  await expect(page.locator(`[data-testid="roadmap-item"][data-status="${status}"]`).filter({ hasText: title })).toHaveCount(0);
});

Then('the roadmap shows fewer than {int} items at first', async ({ e2e }, n) => {
  const items = e2e.window.getByTestId('roadmap-item');
  await expect(items.first()).toBeVisible();
  expect(await items.count()).toBeLessThan(n);
});

// records whether the "Loading…" row appeared (window.__rmLoading), then brings the last card into
// view until the count stops growing
When('I scroll the roadmap to its end until nothing more loads', async ({ e2e }) => {
  const page = e2e.window;
  await page.evaluate(() => {
    window.__rmLoading = false;
    const seen = () => {
      const row = document.querySelector('[data-testid="roadmap-loading"]');
      if (row && row.getClientRects().length && /Loading…/.test(row.textContent)) window.__rmLoading = true;
    };
    seen();
    new MutationObserver(seen).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  const items = page.getByTestId('roadmap-item');
  let last = -1;
  for (let round = 0; round < 60; round += 1) {
    const count = await items.count();
    if (count === last) break;
    last = count;
    await items.last().scrollIntoViewIfNeeded();
    await expect.poll(() => items.count(), { timeout: 3000 }).toBeGreaterThan(count).catch(() => {});
  }
});

Then('a {string} row showed while more items came', async ({ e2e }, text) => {
  expect(text).toBe('Loading…');
  expect(await e2e.window.evaluate(() => window.__rmLoading), 'the "Loading…" row appeared').toBe(true);
});

Then('the roadmap shows as many items as its header counts', async ({ e2e }) => {
  const page = e2e.window;
  const [, n] = (await header(page).innerText()).trim().match(/^(\d+) of (\d+) items?/);
  expect(Number(n)).toBeGreaterThan(200);
  await expect(page.getByTestId('roadmap-item')).toHaveCount(Number(n));
});

// ---- #272: the run timer, a fix round --------------------------------------------------------------------

// "52:13" (minutes:seconds) or "6:40:02" (hours:minutes:seconds) → seconds
const seconds = (text) => {
  const parts = text.trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  expect(parts, `a timer like 23:41, not "${text}"`).toBeTruthy();
  const [a, b, c] = parts.slice(1).map((x) => (x == null ? null : Number(x)));
  return c == null ? a * 60 + b : a * 3600 + b * 60 + c;
};

// #282: the timer is the value of the item's Time meter, and the only timer on the card
Then('the roadmap item {string} shows a run timer in its Time line', async ({ e2e }, title) => {
  const item = roadmapItem(e2e.window, title);
  const line = item.getByTestId('roadmap-meter-time');
  await expect(line.getByTestId('roadmap-run-timer')).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(item.getByTestId('roadmap-run-timer')).toHaveCount(1);
});

Then('the run timer of the roadmap item {string} reads about {int} minutes', async ({ e2e }, title, minutes) => {
  const s = seconds(await timer(e2e.window, title).innerText());
  expect(s).toBeGreaterThanOrEqual(minutes * 60);
  expect(s).toBeLessThan((minutes + 5) * 60);
});

Then('the run timer of the roadmap item {string} ticks', async ({ e2e }, title) => {
  const clock = timer(e2e.window, title);
  const before = seconds(await clock.innerText());
  await expect.poll(async () => seconds(await clock.innerText()), { timeout: 5000 }).toBeGreaterThan(before);
});

Then('the run timer of the roadmap item {string} is coloured {string}', async ({ e2e }, title, tone) => {
  await expect(timer(e2e.window, title)).toHaveAttribute('data-tone', tone, { timeout: LOAD_TIMEOUT });
});

// the ring's estimated percent, from its accessible name ("47% estimated, Review. Show the run's steps")
const percentOf = async (page, title) => {
  const name = await ringOf(roadmapItem(page, title)).getAttribute('aria-label');
  const m = String(name).match(/^(\d+)% estimated/);
  expect(m, `the ring's percent in "${name}"`).toBeTruthy();
  return Number(m[1]);
};
const noted = new WeakMap();

When('I note the progress of the roadmap item {string}', async ({ e2e }, title) => {
  await expect(ringOf(roadmapItem(e2e.window, title))).toBeVisible({ timeout: LOAD_TIMEOUT });
  noted.set(e2e, await percentOf(e2e.window, title));
});

Then('the roadmap item {string} shows {string}', async ({ e2e }, title, text) => {
  await expect(roadmapItem(e2e.window, title)).toContainText(text, { timeout: LOAD_TIMEOUT });
});

Then('the run chip of the roadmap item {string} still opens the run {string}', async ({ e2e }, title, fragment) => {
  const chips = runChip(e2e.window, title);
  await expect(chips).toHaveCount(1);
  await expect(chips).toHaveAttribute('data-run', new RegExp(`-${escapeRe(fragment)}$`));
});

Then('the progress of the roadmap item {string} has not dropped', async ({ e2e }, title) => {
  const before = noted.get(e2e);
  expect(before, 'the progress noted earlier').not.toBeUndefined();
  expect(await percentOf(e2e.window, title)).toBeGreaterThanOrEqual(before);
});

// ---- #279: "Update the app after this" ---------------------------------------------------------------
// #285 removed the switch (data-testid="roadmap-update-after", a checkbox named "Update the app after
// this"): the step asserts that no card draws it any more.

Then('the roadmap item {string} offers no {string} switch', async ({ e2e }, title, name) => {
  const item = roadmapItem(e2e.window, title);
  await expect(item).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(item.getByTestId('roadmap-update-after')).toHaveCount(0);
  await expect(item.getByRole('checkbox', { name, exact: true })).toHaveCount(0);
});

// ---- #269: the roadmap bar's state dot, Pause / Stop icons, the ⋮ menu, the filter row --------------
// What the screen exposes (new for #269):
// - data-testid="roadmap-state-dot": the dot before "Roadmap" in the bar; data-state = running | paused |
//   paused-failed | planned | done; aria-label (and title) = the readable state ("Running", "Paused"…).
//   A running one pulses (a CSS animation on it or its ::before / ::after).
// - the bar's "Pause" and "Stop" buttons carry an icon element with data-icon="pause" / data-icon="stop"
//   (aria-hidden: the accessible name stays "Pause" / "Stop"); Pause amber, Stop red (their text colour).
// - data-testid="roadmap-menu-button": the ⋮ button at the end of the bar, accessible name "Roadmap
//   actions", aria-haspopup="menu", aria-expanded; its menu role="menu" (data-testid="roadmap-menu")
//   with role="menuitem" entries ("Clear", "Restore an earlier version…"); Enter opens it and focuses
//   its first entry, Esc closes it and gives the focus back to the ⋮ button.
// - data-testid="filter-row": the row above the bar (and above the Board) with the filters.
// The roadmap set running for #269 is simulated, its refused item skipped, so nothing real starts and
// no refused start pauses it again (MULTIAGENT_SIMULATION_ONLY=1 anyway).

const rmBar = (page) => page.getByTestId('roadmap-bar');
const stateDot = (page) => rmBar(page).getByTestId('roadmap-state-dot');
const menuButton = (page) => rmBar(page).getByRole('button', { name: 'Roadmap actions', exact: true });
const rmMenu = (page) => page.getByRole('menu').filter({ visible: true }).first();
const filterRow = (page) => page.getByTestId('filter-row').filter({ visible: true }).first();
const FILTERS = (scope) => [
  ['the epic filter', scope.getByRole('combobox', { name: 'Epic', exact: true })],
  ['the Planned | All switch', scope.getByRole('group', { name: 'Roadmap items', exact: true })],
  ['the date filter', scope.getByRole('combobox', { name: 'Date range', exact: true })],
  ['"Group by epic"', scope.getByRole('checkbox', { name: 'Group by epic', exact: true })],
];
const rgb = (css) => (String(css).match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);

Given('the roadmap is running as a simulation', async ({ e2e }) => {
  editRoadmap(e2e, (r) => {
    Object.assign(r, { state: 'running', simulated: true, pausedBy: null, error: null, scope: null, budget: null });
    for (const item of r.stages.flatMap((s) => s.items)) if (!item.runId && item.error) Object.assign(item, { status: 'skipped' });
  });
});

Then("the roadmap bar's state dot is {string} and reads {string}", async ({ e2e }, id, label) => {
  const dot = stateDot(e2e.window);
  await expect(dot).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(dot).toHaveAttribute('data-state', id, { timeout: 20000 });
  await expect(dot).toHaveAttribute('aria-label', new RegExp(`^${escapeRe(label)}`));
  await expect(dot).toHaveAttribute('title', new RegExp(`^${escapeRe(label)}`));
});

Then("the roadmap bar's state dot pulses", async ({ e2e }) => {
  const animated = await stateDot(e2e.window).evaluate((el) => [getComputedStyle(el), getComputedStyle(el, '::before'), getComputedStyle(el, '::after')]
    .some((s) => s.animationName && s.animationName !== 'none'));
  expect(animated, 'the running dot has a pulse animation').toBe(true);
});

// the dot is drawn left of the bar's "Roadmap" title
Then("the roadmap bar's state dot comes before {string}", async ({ e2e }, title) => {
  const dot = await stateDot(e2e.window).boundingBox();
  const text = await rmBar(e2e.window).getByText(title, { exact: true }).first().boundingBox();
  expect(dot && text, 'the dot and the title are shown').toBeTruthy();
  expect(dot.x + dot.width, 'the dot ends before the title starts').toBeLessThanOrEqual(text.x + 1);
});

Then('the roadmap bar offers {string} with a {word} icon', async ({ e2e }, name, icon) => {
  const button = rmBar(e2e.window).getByRole('button', { name, exact: true });
  await expect(button).toBeEnabled();
  await expect(button.locator(`[data-icon="${icon}"]`)).toHaveCount(1);
});

// "amber" (red and green over blue) or "red" (red well over green and blue): the button's text colour
Then("the roadmap bar's {string} button is {word}", async ({ e2e }, name, colour) => {
  const [r, g, b] = rgb(await rmBar(e2e.window).getByRole('button', { name, exact: true }).evaluate((el) => getComputedStyle(el).color));
  if (colour === 'red') expect(r > g + 40 && r > b + 40, `"${name}" reads red, not rgb(${r}, ${g}, ${b})`).toBe(true);
  else if (colour === 'amber') expect(r > b + 40 && g > b + 20, `"${name}" reads amber, not rgb(${r}, ${g}, ${b})`).toBe(true);
  else throw new Error(`unknown colour "${colour}"`);
});

When("I click {string} on the roadmap bar", async ({ e2e }, name) => {
  await rmBar(e2e.window).getByRole('button', { name, exact: true }).click();
});

Then('the confirm dialog asks before it stops, with a {string} button', async ({ e2e }, button) => {
  const dialog = e2e.window.getByTestId('confirm-modal');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/stop/i);
  await expect(dialog.getByRole('button', { name: button, exact: true })).toBeVisible();
});

Then('the roadmap bar offers no {string} button of its own', async ({ e2e }, name) => {
  await expect(menuButton(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(rmBar(e2e.window).getByRole('button', { name, exact: true })).toHaveCount(0);
});

// the ⋮ button is the bar's last control, at its right end
Then("the roadmap's ⋮ menu button ends the roadmap bar", async ({ e2e }) => {
  const page = e2e.window;
  await expect(menuButton(page)).toHaveAttribute('aria-haspopup', 'menu');
  const last = await rmBar(page).locator('button, select, input').filter({ visible: true }).last().getAttribute('aria-label');
  expect(last).toBe('Roadmap actions');
});

When("I open the roadmap's ⋮ menu with the keyboard", async ({ e2e }) => {
  const page = e2e.window;
  await menuButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(rmMenu(page)).toBeVisible();
  await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'true');
});

When("I open the roadmap's ⋮ menu", async ({ e2e }) => {
  await menuButton(e2e.window).click();
  await expect(rmMenu(e2e.window)).toBeVisible();
});

Then("the roadmap's menu offers {string}, focused", async ({ e2e }, name) => {
  const entry = rmMenu(e2e.window).getByRole('menuitem', { name, exact: true });
  await expect(entry).toBeVisible();
  await expect(entry).toBeFocused();
});

Then("the roadmap's menu offers {string}", async ({ e2e }, name) => {
  await expect(rmMenu(e2e.window).getByRole('menuitem', { name, exact: true })).toBeVisible();
});

Then("the roadmap's menu is closed, its ⋮ button focused", async ({ e2e }) => {
  const page = e2e.window;
  await expect(page.getByRole('menu').filter({ visible: true })).toHaveCount(0);
  await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(menuButton(page)).toBeFocused();
});

When("I choose {string} in the roadmap's menu", async ({ e2e }, name) => {
  await rmMenu(e2e.window).getByRole('menuitem', { name, exact: true }).click();
});

Then("the roadmap's filter row holds the epic filter, the Planned and All switch, the date filter and {string}", async ({ e2e }, groupBy) => {
  expect(groupBy).toBe('Group by epic');
  const row = filterRow(e2e.window);
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  for (const [what, control] of FILTERS(row)) await expect(control, `${what} in the filter row`).toBeVisible();
});

Then('the roadmap bar holds none of the filters', async ({ e2e }) => {
  await expect(rmBar(e2e.window)).toBeVisible();
  for (const [what, control] of FILTERS(rmBar(e2e.window))) await expect(control, `${what} in the roadmap bar`).toHaveCount(0);
});

Then('the filter row is above the roadmap bar', async ({ e2e }) => {
  const row = await filterRow(e2e.window).boundingBox();
  const bar = await rmBar(e2e.window).boundingBox();
  expect(row && bar, 'the filter row and the bar are shown').toBeTruthy();
  expect(row.y + row.height, 'the filter row ends above the bar').toBeLessThanOrEqual(bar.y + 1);
});

// ---- #271: "Ask the Oracle about this failure" on a failed item ----------------------------------------
// data-testid="roadmap-ask-oracle" (new): a button named "Ask the Oracle about this failure" in a failed
// item's actions, beside Retry and Skip, with the Oracle's avatar (data-testid="oracle-avatar"). It
// opens the Oracle drawer with a context chip for the item's run (data-testid="oracle-context-chip",
// "Run <run id>", as the gate's "Interact with Oracle") and the question prefilled and sent.

const ASK_ORACLE = 'Ask the Oracle about this failure';
const askOracle = (page, title) => roadmapItem(page, title).getByRole('button', { name: ASK_ORACLE, exact: true });
const oracleDrawer = (page) => page.getByRole('complementary', { name: 'Oracle', exact: true });

Then('the roadmap item {string} offers {string} beside Retry and Skip', async ({ e2e }, title, name) => {
  expect(name).toBe(ASK_ORACLE);
  const item = roadmapItem(e2e.window, title);
  const button = askOracle(e2e.window, title);
  await expect(button).toBeEnabled({ timeout: LOAD_TIMEOUT });
  await expect(button).toHaveAttribute('data-testid', 'roadmap-ask-oracle');
  await expect(button.getByTestId('oracle-avatar')).toBeVisible();
  // in the same row of actions as Retry and Skip
  const at = await button.boundingBox();
  for (const other of ['Retry', 'Skip']) {
    const b = await item.getByRole('button', { name: other, exact: true }).boundingBox();
    expect(b, `${other} is shown`).toBeTruthy();
    expect(Math.abs((b.y + b.height / 2) - (at.y + at.height / 2)), `"${name}" on the row of ${other}`).toBeLessThan(Math.max(b.height, at.height));
  }
});

Then('the roadmap item {string} offers no {string} button', async ({ e2e }, title, name) => {
  const item = roadmapItem(e2e.window, title);
  await expect(item).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(item.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(item.getByTestId('roadmap-ask-oracle')).toHaveCount(0);
});

When('I click {string} on the roadmap item {string}', async ({ e2e }, name, title) => {
  const item = roadmapItem(e2e.window, title);
  await item.scrollIntoViewIfNeeded();
  await item.getByRole('button', { name, exact: true }).click();
});

Then("the Oracle's context chip names the run of the roadmap item {string}", async ({ e2e }, title) => {
  const page = e2e.window;
  const runId = await runChip(page, title).getAttribute('data-run');
  expect(runId, `the roadmap item "${title}" has a run`).toBeTruthy();
  const chip = oracleDrawer(page).getByTestId('oracle-context-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(`Run ${runId}`);
});

// The first question is prefilled and sent (#271): it shows in the chat, not left in the box.
Then('the Oracle is asked {string}', async ({ e2e }, question) => {
  const drawer = oracleDrawer(e2e.window);
  await expect(drawer).toContainText(question, { timeout: LOAD_TIMEOUT });
  await expect(drawer.getByRole('textbox')).not.toHaveValue(question);
});

// ---- #281: Undo a removal, earlier versions of the roadmap ---------------------------------------------
// data-testid="toast" (new) on the app's toast (#toast, role status), with an "Undo" button after a
// removal. "Restore an earlier version…" in the ⋮ menu opens a dialog named "Restore an earlier version"
// (data-testid="roadmap-versions") listing the saved versions (data-testid="roadmap-version", newest
// first, each with a "Restore" button); a restore may ask first (confirm-modal, its "Restore" button).

const toast = (page) => page.getByTestId('toast');
const versions = (page) => page.getByTestId('roadmap-versions');

When('I remove the roadmap item {string}', async ({ e2e }, title) => {
  const item = roadmapItem(e2e.window, title);
  await expect(item).toBeVisible({ timeout: LOAD_TIMEOUT });
  await item.scrollIntoViewIfNeeded();
  await item.getByRole('button', { name: /^remove$/i }).click();
});

Then('a toast says {string} with an {string} button', async ({ e2e }, text, button) => {
  const t = toast(e2e.window);
  await expect(t).toBeVisible();
  await expect(t).toContainText(text);
  await expect(t.getByRole('button', { name: button, exact: true })).toBeEnabled();
});

When('I click {string} in the toast', async ({ e2e }, button) => {
  await toast(e2e.window).getByRole('button', { name: button, exact: true }).click();
});

Then('the toast says {string}', async ({ e2e }, text) => {
  await expect(toast(e2e.window)).toContainText(text);
});

Then('the roadmap no longer shows the item {string}', async ({ e2e }, title) => {
  const page = e2e.window;
  await expect(page.getByTestId('roadmap-item').first()).toBeVisible();
  await expect(page.getByTestId('roadmap-item').filter({ hasText: title })).toHaveCount(0);
});

Then('the earlier versions of the roadmap are listed, at least {int}', async ({ e2e }, n) => {
  const page = e2e.window;
  await expect(page.getByRole('dialog', { name: 'Restore an earlier version', exact: true })).toBeVisible();
  const rows = versions(page).getByTestId('roadmap-version');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThanOrEqual(n);
  await expect(rows.first().getByRole('button', { name: 'Restore', exact: true })).toBeEnabled();
});

When('I restore the most recent earlier version', async ({ e2e }) => {
  const page = e2e.window;
  await versions(page).getByTestId('roadmap-version').first().getByRole('button', { name: 'Restore', exact: true }).click();
  const confirm = page.getByTestId('confirm-modal');
  if (await confirm.isVisible()) await confirm.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(versions(page)).toBeHidden();
});

// ---- #286: the developer's effort in a roadmap item's Edit and on its card ---------------------------
// The Edit form (role group "Edit the inputs of this item") draws the workflow's inputs, "Developer
// effort" a row of pills next to "Developer model"; the card shows the item's inputs as
// data-testid="input-pill" ("Developer effort: High"), an input at its default ('default') left out.

const editForm = (page, title) => roadmapItem(page, title).getByRole('group', { name: 'Edit the inputs of this item', exact: true });

// the item's workflow set in the roadmap file (a planned item, so the app redraws it from the file)
Given('the roadmap item {string} runs the workflow {string}', async ({ e2e }, title, name) => {
  editRoadmap(e2e, (r) => {
    const item = r.stages.flatMap((s) => s.items).find((x) => titleOf(x) === title);
    expect(item, `a roadmap item "${title}"`).toBeTruthy();
    Object.assign(item, { workflow: `${name}.yaml`, workflowName: name });
  });
});

When('I edit the inputs of the roadmap item {string}', async ({ e2e }, title) => {
  const item = roadmapItem(e2e.window, title);
  await expect(item).toBeVisible({ timeout: LOAD_TIMEOUT });
  await item.scrollIntoViewIfNeeded();
  await item.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(editForm(e2e.window, title)).toBeVisible();
});

When('I save the inputs of the roadmap item {string}', async ({ e2e }, title) => {
  const form = editForm(e2e.window, title);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form).toBeHidden();
});

Then('the roadmap item {string} shows the input {string}', async ({ e2e }, title, text) => {
  const pill = roadmapItem(e2e.window, title).getByTestId('input-pill').filter({ hasText: text });
  await expect(pill.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('the roadmap item {string} shows no {string} input', async ({ e2e }, title, label) => {
  const item = roadmapItem(e2e.window, title);
  await expect(item).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(item.getByTestId('input-pill').filter({ hasText: new RegExp(`^\\s*${escapeRe(label)}:`) })).toHaveCount(0);
});

// ---- #282: the item card's bands, its Workflow band and pipeline, the stage actions menu ---------------
// What the card exposes (new for #282), inside data-testid="roadmap-item":
// - the issues band: the issue titles and data-testid="roadmap-issues-foot" ("N issues · complexity C");
//   the meters data-testid="roadmap-meter-cost" and "roadmap-meter-time"; one status block
//   data-testid="roadmap-status" (the ring, the status pill, the step, the full round line).
// - data-testid="roadmap-workflow": the Workflow band, with data-testid="roadmap-workflow-name" (the
//   workflow's display name), data-testid="roadmap-mode" (buttons data-mode="auto" / "validated", named
//   "Automatic" / "Validated", aria-pressed; a click saves the item's mode at once) and
//   data-testid="roadmap-pipeline", always shown: its stations data-testid="roadmap-station" with
//   data-state = done | running | back | todo | gate (the owner's gate reads "Your check").
// Each stage (data-testid="roadmap-stage") has a ⋮ button data-testid="roadmap-stage-menu" (accessible
// name "Stage actions", aria-haspopup="menu", aria-expanded) opening a role="menu" of role="menuitem"
// entries (Release here, Run this stage, Run earlier / later, the note, Disable / Enable); Enter opens it
// and focuses its first entry, Esc closes it and gives the focus back to the ⋮ button.

const MODES = { Automatic: 'auto', Validated: 'validated' };
const workflowBand = (page, title) => roadmapItem(page, title).getByTestId('roadmap-workflow');
const pipeline = (page, title) => workflowBand(page, title).getByTestId('roadmap-pipeline');
const stations = (page, title) => pipeline(page, title).getByTestId('roadmap-station');
const modeButton = (page, title, label) => {
  expect(Object.keys(MODES), `a mode named "${label}"`).toContain(label);
  return workflowBand(page, title).getByTestId('roadmap-mode').locator(`button[data-mode="${MODES[label]}"]`);
};
const stageMenuButton = (page, n) => stage(page, n).getByRole('button', { name: 'Stage actions', exact: true });
const stageMenu = (page) => page.getByRole('menu').filter({ visible: true }).first();

Then('the roadmap item {string} shows its issues, its cost and time meters and one status block', async ({ e2e }, title) => {
  const item = roadmapItem(e2e.window, title);
  await expect(item).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(item.getByTestId('roadmap-issues-foot')).toBeVisible();
  await expect(item.getByTestId('roadmap-meter-cost')).toBeVisible();
  await expect(item.getByTestId('roadmap-meter-time')).toBeVisible();
  await expect(item.getByTestId('roadmap-status')).toHaveCount(1);
  await expect(item.getByTestId('roadmap-status')).toBeVisible();
});

// the complexity follows the count only when the item has one (the demo items may not)
Then('the issues footer of the roadmap item {string} counts {string}', async ({ e2e }, title, count) => {
  await expect(roadmapItem(e2e.window, title).getByTestId('roadmap-issues-foot')).toHaveText(new RegExp(`^${escapeRe(count)}( · complexity \\S+)?$`));
});

Then('the Workflow band of the roadmap item {string} names the workflow {string}', async ({ e2e }, title, name) => {
  await expect(workflowBand(e2e.window, title).getByTestId('roadmap-workflow-name')).toHaveText(new RegExp(`^${escapeRe(name)}$`, 'i'), { timeout: LOAD_TIMEOUT });
});

Then('the roadmap item {string} is in {string} mode', async ({ e2e }, title, label) => {
  await expect(modeButton(e2e.window, title, label)).toHaveAttribute('aria-pressed', 'true', { timeout: LOAD_TIMEOUT });
  for (const other of Object.keys(MODES).filter((x) => x !== label)) {
    await expect(modeButton(e2e.window, title, other)).toHaveAttribute('aria-pressed', 'false');
  }
});

When('I switch the roadmap item {string} to {string} mode', async ({ e2e }, title, label) => {
  const button = modeButton(e2e.window, title, label);
  await button.scrollIntoViewIfNeeded();
  await expect(button).toHaveAccessibleName(label);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
});

// the gate station: the owner's check ("Your check"), data-state="gate"
Then('the pipeline of the roadmap item {string} shows the {string} station, waiting for me', async ({ e2e }, title, name) => {
  await expect(pipeline(e2e.window, title)).toBeVisible({ timeout: LOAD_TIMEOUT });
  const station = stations(e2e.window, title).filter({ hasText: name });
  await expect(station).toHaveCount(1);
  await expect(station).toHaveAttribute('data-state', 'gate');
});

Then('the pipeline of the roadmap item {string} shows no {string} station', async ({ e2e }, title, name) => {
  await expect(pipeline(e2e.window, title)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(stations(e2e.window, title).first()).toBeVisible();
  await expect(stations(e2e.window, title).filter({ hasText: name })).toHaveCount(0);
  await expect(pipeline(e2e.window, title).locator('[data-testid="roadmap-station"][data-state="gate"]')).toHaveCount(0);
});

// done stations first, exactly one running station after them, the rest still to do
Then('the pipeline of the roadmap item {string} shows done stations, then one running station', async ({ e2e }, title) => {
  await expect(pipeline(e2e.window, title)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(pipeline(e2e.window, title).locator('[data-testid="roadmap-station"][data-state="running"]')).toHaveCount(1);
  const states = await stations(e2e.window, title).evaluateAll((els) => els.map((el) => el.getAttribute('data-state')));
  const running = states.indexOf('running');
  expect(running, `a done station before the running one in ${states.join(', ')}`).toBeGreaterThan(0);
  expect(states.slice(0, running).every((s) => s === 'done'), `only done stations before the running one: ${states.join(', ')}`).toBe(true);
  expect(states.slice(running + 1).every((s) => s === 'todo' || s === 'gate'), `only stations to do after the running one: ${states.join(', ')}`).toBe(true);
});

Then('stage {int} offers no {string} button outside its stage actions menu', async ({ e2e }, n, name) => {
  await expect(stageMenuButton(e2e.window, n)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(stageMenuButton(e2e.window, n)).toHaveAttribute('data-testid', 'roadmap-stage-menu');
  await expect(stage(e2e.window, n).getByRole('button', { name, exact: true })).toHaveCount(0);
});

When('I open the stage actions menu of stage {int} with the keyboard', async ({ e2e }, n) => {
  const page = e2e.window;
  const button = stageMenuButton(page, n);
  await expect(button).toHaveAttribute('aria-haspopup', 'menu', { timeout: LOAD_TIMEOUT });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(stageMenu(page)).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
});

When('I open the stage actions menu of stage {int}', async ({ e2e }, n) => {
  const button = stageMenuButton(e2e.window, n);
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(stageMenu(e2e.window)).toBeVisible();
});

Then("the stage actions menu's first entry is focused", async ({ e2e }) => {
  await expect(stageMenu(e2e.window).getByRole('menuitem').first()).toBeFocused();
});

Then('the stage actions menu offers {string}', async ({ e2e }, name) => {
  await expect(stageMenu(e2e.window).getByRole('menuitem', { name, exact: true })).toBeVisible();
});

Then('the stage actions menu offers {string}, disabled', async ({ e2e }, name) => {
  const entry = stageMenu(e2e.window).getByRole('menuitem', { name, exact: true });
  await expect(entry).toBeVisible();
  await expect(entry).toBeDisabled();
});

When('I choose {string} in the stage actions menu', async ({ e2e }, name) => {
  await stageMenu(e2e.window).getByRole('menuitem', { name, exact: true }).click();
});

Then('the stage actions menu of stage {int} is closed, its ⋮ button focused', async ({ e2e }, n) => {
  const page = e2e.window;
  await expect(page.getByRole('menu').filter({ visible: true })).toHaveCount(0);
  await expect(stageMenuButton(page, n)).toHaveAttribute('aria-expanded', 'false');
  await expect(stageMenuButton(page, n)).toBeFocused();
});

// ---- #284: disable a stage ------------------------------------------------------------------------------
// "Disable" / "Enable" in the stage actions menu is data-testid="roadmap-stage-toggle"; a disabled stage
// keeps its place and number with data-disabled="true" on its section and a "Disabled" badge
// (data-testid="roadmap-stage-disabled"); "Run this stage" is disabled in its menu.

Then('the stage actions menu entry {string} is the stage toggle', async ({ e2e }, name) => {
  await expect(stageMenu(e2e.window).getByRole('menuitem', { name, exact: true })).toHaveAttribute('data-testid', 'roadmap-stage-toggle');
});

Then('stage {int} is shown as disabled', async ({ e2e }, n) => {
  const s = stage(e2e.window, n);
  await expect(s).toHaveAttribute('data-disabled', 'true', { timeout: LOAD_TIMEOUT });
  await expect(s.getByTestId('roadmap-stage-disabled')).toHaveText('Disabled');
});

Then('stage {int} is not shown as disabled', async ({ e2e }, n) => {
  const s = stage(e2e.window, n);
  await expect(s).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(s).not.toHaveAttribute('data-disabled', 'true');
  await expect(s.getByTestId('roadmap-stage-disabled')).toHaveCount(0);
});

Then('stage {int} shows {int} item card(s)', async ({ e2e }, n, count) => {
  await expect(stage(e2e.window, n).getByTestId('roadmap-item')).toHaveCount(count);
});

// in the page's order of stage sections, numbered as the roadmap numbers them ("Stage 3")
Then('stage {int} sits between stage {int} and stage {int}', async ({ e2e }, n, before, after) => {
  const page = e2e.window;
  await expect(stage(page, after)).toBeVisible();
  const order = await page.getByTestId('roadmap-stage').evaluateAll((els, ns) => ns.map((k) => els.findIndex((el) => new RegExp(`\\bStage ${k}\\b`).test(el.textContent))), [before, n, after]);
  expect(order.every((i) => i >= 0), `stages ${before}, ${n} and ${after} are shown`).toBe(true);
  expect(order[0] < order[1] && order[1] < order[2], `stage ${n} between stage ${before} and stage ${after}`).toBe(true);
});

// ---- #285: no "Update the app after this" control ------------------------------------------------------

Then('no roadmap item shows an {string} control', async ({ e2e }, name) => {
  const items = e2e.window.getByTestId('roadmap-item');
  await expect(items.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(items.getByTestId('roadmap-update-after')).toHaveCount(0);
  await expect(items.getByRole('checkbox', { name, exact: true })).toHaveCount(0);
  await expect(items.getByRole('switch', { name, exact: true })).toHaveCount(0);
  await expect(items.getByText(name, { exact: true })).toHaveCount(0);
});
