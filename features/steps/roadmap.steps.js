// Steps of features/roadmap.feature: the Roadmap's readable statuses and run chip (#266), a stage's
// "+n done" chip (#267), the date filter, the Planned | All switch, infinite scroll and the header
// count (#268), the live run timer and a fix round (#272), on the demo roadmap (scripts/screenshot.js
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

Then('the roadmap item {string} shows a run timer under its progress ring', async ({ e2e }, title) => {
  const item = roadmapItem(e2e.window, title);
  const clock = timer(e2e.window, title);
  await expect(clock).toBeVisible({ timeout: LOAD_TIMEOUT });
  const ring = await ringOf(item).boundingBox();
  const box = await clock.boundingBox();
  expect(box.y, 'the timer is below the ring').toBeGreaterThanOrEqual(ring.y + ring.height - 1);
  expect(box.x + box.width > ring.x && box.x < ring.x + ring.width, 'the timer is under the ring').toBe(true);
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
