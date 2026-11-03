// Steps of fronts/build/features/roadmap.feature's #748 scenarios: a stage's ⋮ menu that opens at once,
// in place (the roadmap not drawn again, the page not moved), its entries in groups divided by lines, no
// explanation line inside it, and its last entry "Remove from roadmap" (asks first, naming the stage and
// its items; refused while one of its items runs or waits at a gate). Seeds through the demo workspace's
// roadmap and backlog files, as roadmap.steps.js and backlog-archive.steps.js do (the app follows them).
// Locators are roles and data-testid only (skills/ui-conventions).
//
// What the screen exposes (the renderer's contract for these steps; new for #748):
// - the stage's ⋮ button: data-testid="roadmap-stage-menu" (exists, #282), accessible name "Stage actions".
// - its menu: the ui-kit's shared menu, role="menu", entries role="menuitem" (their accessible name is
//   the label, icons aria-hidden), groups divided by role="separator"; no text outside the entries.
// - a refused entry: aria-disabled="true", its reason only in its tooltip (a title, or the app's
//   tooltip card role="tooltip" on hover), never on a line in the menu.
// - "Remove from roadmap": data-testid="roadmap-stage-remove", the last entry, a danger entry
//   (data-tone="danger" or a `danger` class); it asks first in the confirm modal (data-testid=
//   "confirm-modal", exists) "Remove stage N and its M items from the roadmap?", button "Remove".
// - the scrolling list is whichever ancestor of the stages scrolls (or the document).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');

const LOAD_TIMEOUT = 30000;
// "at once": the menu shows within this, not after a redraw of a long roadmap
const AT_ONCE = 1000;

const stage = (page, n) => page.getByTestId('roadmap-stage').filter({ hasText: new RegExp(`\\bStage ${n}\\b`) }).first();
const stageMenuButton = (page, n) => stage(page, n).getByRole('button', { name: 'Stage actions', exact: true });
const stageMenu = (page) => page.getByRole('menu').filter({ visible: true }).first();
const confirmModal = (page) => page.getByTestId('confirm-modal');

// ---- the demo workspace's files, edited before the screen opens ---------------------------------------

const roadmapFile = (e2e) => path.join(e2e.scratch, 'workspace', 'backlog', `${e2e.project.id}.roadmap.json`);
const backlogFile = (e2e) => path.join(e2e.scratch, 'workspace', 'backlog', `${e2e.project.id}.json`);
function editRoadmap(e2e, fn) {
  const file = roadmapFile(e2e);
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  fn(r);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...r, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, file);
}
// a planned item of the demo roadmap as the model (its workflow and inputs), on the given issue
function plannedItem(r, id, issue) {
  const model = r.stages.flatMap((s) => s.items).find((x) => x.status === 'planned' && !x.runId && !x.error);
  expect(model, 'a planned item in the demo roadmap').toBeTruthy();
  const base = JSON.parse(JSON.stringify(model));
  for (const k of ['issues', 'reason', 'modeReason', 'origin', 'cost']) delete base[k];
  return { ...base, id, ...issue, issues: [issue], status: 'planned', runId: null, runs: [], error: null };
}

// `count` planned stages after the demo's 5, one item each (issues #7001…, made up): stages 6 to 5 + count
Given('the roadmap ends with {int} planned stages of one item each', async ({ e2e }, count) => {
  editRoadmap(e2e, (r) => {
    for (let k = 0; k < count; k += 1) {
      const number = 7001 + k;
      const issue = { number, url: `https://github.com/example/demo-app/issues/${number}`, title: `Long roadmap item ${number}`, body: '', knownPullRequests: [] };
      r.stages.push({ id: `stage-long-${number}`, name: `Long stage ${k + 1}`, note: '', items: [plannedItem(r, `long-${number}`, issue)] });
    }
  });
});

// a last planned stage named `name`, one item per backlog issue (the issues must be in the backlog)
Given('the roadmap ends with a planned stage {string} holding the issues {string} and {string}', async ({ e2e }, name, a, b) => {
  const backlog = JSON.parse(fs.readFileSync(backlogFile(e2e), 'utf8'));
  const issues = [a, b].map((title) => {
    const i = backlog.issues.find((x) => x.title === title);
    expect(i, `the backlog issue "${title}"`).toBeTruthy();
    return { number: i.number, url: i.url, title: i.title, body: i.body || '', knownPullRequests: [] };
  });
  editRoadmap(e2e, (r) => {
    r.stages.push({ id: 'stage-748-remove', name, note: '', items: issues.map((issue) => plannedItem(r, `remove-748-${issue.number}`, issue)) });
  });
});

// ---- the long roadmap: scroll to a stage, note the page, open its menu --------------------------------

// brings more stages in (infinite scroll, #268) until stage n is there, then its ⋮ button into view
When('I scroll the roadmap down to stage {int}', async ({ e2e }, n) => {
  const page = e2e.window;
  const stages = page.getByTestId('roadmap-stage');
  await expect(stages.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  const target = stage(page, n);
  for (let round = 0; round < 80 && !(await target.count()); round += 1) {
    const count = await stages.count();
    await stages.last().scrollIntoViewIfNeeded();
    await expect.poll(() => stages.count(), { timeout: 3000 }).toBeGreaterThan(count).catch(() => {});
  }
  await expect(target).toBeAttached({ timeout: LOAD_TIMEOUT });
  await stageMenuButton(page, n).scrollIntoViewIfNeeded();
  await expect(stageMenuButton(page, n)).toBeInViewport();
});

// marks the stage's element and its cards (a property on the DOM nodes, nothing in the app: an element
// drawn again loses it) and records the scrolling list's scrollTop and the stage's top on the screen
When("I note the roadmap's scroll position and where stage {int} is on the screen", async ({ e2e }, n) => {
  const page = e2e.window;
  await expect(stage(page, n)).toBeInViewport({ timeout: LOAD_TIMEOUT });
  const noted = await stage(page, n).evaluate((el) => {
    const scrolls = (x) => x.scrollTop > 0 && x.scrollHeight > x.clientHeight;
    let box = el.parentElement;
    while (box && !scrolls(box)) box = box.parentElement;
    const scroller = box || document.scrollingElement;
    window.e2eScroller748 = scroller;
    el.e2eNoted748 = true;
    for (const card of el.querySelectorAll('[data-testid="roadmap-item"]')) card.e2eNoted748 = true;
    return { scrollTop: scroller.scrollTop, top: el.getBoundingClientRect().top };
  });
  expect(noted.scrollTop, 'the roadmap is scrolled down to the stage').toBeGreaterThan(0);
  e2e.noted748 = noted;
});

Then('the stage actions menu of stage {int} is open', async ({ e2e }, n) => {
  const page = e2e.window;
  await expect(stageMenu(page)).toBeVisible({ timeout: AT_ONCE });
  await expect(stageMenuButton(page, n)).toHaveAttribute('aria-expanded', 'true', { timeout: AT_ONCE });
  await expect(stageMenu(page).getByRole('menuitem').first()).toBeVisible();
});

Then('stage {int} was not drawn again', async ({ e2e }, n) => {
  const s = stage(e2e.window, n);
  expect(await s.evaluate((el) => el.e2eNoted748 === true), `stage ${n} is the same element, not drawn again`).toBe(true);
  const cards = await s.getByTestId('roadmap-item').evaluateAll((els) => els.map((el) => el.e2eNoted748 === true));
  expect(cards.length, `stage ${n} still shows its cards`).toBeGreaterThan(0);
  expect(cards.every(Boolean), `the cards of stage ${n} are the same elements, not drawn again`).toBe(true);
});

// after two frames (the layout settled), the same scrolling list at the same scrollTop, the stage at the same top
Then('the roadmap has not scrolled and stage {int} has not moved on the screen', async ({ e2e }, n) => {
  const before = e2e.noted748;
  expect(before, 'the scroll position noted earlier').toBeTruthy();
  const now = await stage(e2e.window, n).evaluate((el) => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const scroller = window.e2eScroller748;
    done({ same: !!scroller && scroller.isConnected, scrollTop: scroller ? scroller.scrollTop : null, top: el.getBoundingClientRect().top });
  }))));
  expect(now.same, 'the scrolling list is still the same element').toBe(true);
  expect(Math.abs(now.scrollTop - before.scrollTop), `the list stays scrolled at ${before.scrollTop}px, not ${now.scrollTop}px`).toBeLessThanOrEqual(1);
  expect(Math.abs(now.top - before.top), `stage ${n} stays at ${before.top}px from the top, not ${now.top}px`).toBeLessThanOrEqual(1);
});

// ---- the menu's entries --------------------------------------------------------------------------------

// the menu's entries in order, cut into groups at each separator: [["Disable", "Run this stage"], …]
const groupsOf = (menu) => menu.evaluate((el) => {
  const label = (item) => {
    const copy = item.cloneNode(true);
    for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
    return copy.textContent.replace(/\s+/g, ' ').trim();
  };
  const groups = [[]];
  for (const node of el.querySelectorAll('[role="menuitem"], [role="separator"]')) {
    if (node.getAttribute('role') === 'separator') groups.push([]);
    else groups[groups.length - 1].push(label(node));
  }
  return groups.filter((g) => g.length);
});

// one row per group, its entries separated by commas
Then('the stage actions menu shows these groups of entries, divided by lines:', async ({ e2e }, table) => {
  const expected = table.raw().map(([row]) => row.split(',').map((s) => s.trim()).filter(Boolean));
  const menu = stageMenu(e2e.window);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('separator')).toHaveCount(expected.length - 1);
  expect(await groupsOf(menu)).toEqual(expected);
});

// every text of the menu is inside an entry: no reason or hint line under one
Then('the stage actions menu shows no explanation line', async ({ e2e }) => {
  const menu = stageMenu(e2e.window);
  await expect(menu).toBeVisible();
  const loose = await menu.evaluate((el) => {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent.trim();
      if (text && !node.parentElement.closest('[role="menuitem"]')) out.push(text);
    }
    return out;
  });
  expect(loose, 'text in the menu outside its entries').toEqual([]);
});

Then('the stage actions menu does not offer {string}', async ({ e2e }, name) => {
  const menu = stageMenu(e2e.window);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name, exact: true })).toHaveCount(0);
  await expect(menu.getByText(name, { exact: true })).toHaveCount(0);
});

Then('the stage actions menu ends with {string}, shown as a dangerous action', async ({ e2e }, name) => {
  const menu = stageMenu(e2e.window);
  const last = menu.getByRole('menuitem').last();
  await expect(last).toHaveAccessibleName(name);
  await expect(last).toHaveAttribute('data-testid', 'roadmap-stage-remove');
  const danger = await last.evaluate((el) => el.getAttribute('data-tone') === 'danger' || /\bdanger\b/.test(el.className));
  expect(danger, `"${name}" is a danger entry (data-tone="danger" or a danger class)`).toBe(true);
});

// ---- Remove from roadmap ----------------------------------------------------------------------------------

Then('the confirm dialog asks {string}', async ({ e2e }, question) => {
  const dialog = confirmModal(e2e.window);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(question);
});

// dimmed and refused (aria-disabled), its reason in its tooltip only, no line about it in the menu
Then('the stage actions menu entry {string} is refused, with its reason in its tooltip only', async ({ e2e }, name) => {
  const page = e2e.window;
  const menu = stageMenu(page);
  const entry = menu.getByRole('menuitem', { name, exact: true });
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute('aria-disabled', 'true');
  await entry.hover();
  const title = (await entry.getAttribute('title')) || '';
  const card = page.getByRole('tooltip').filter({ visible: true });
  const tip = title.trim() || ((await card.count()) ? (await card.first().innerText()).trim() : '');
  expect(tip, `the tooltip of the refused "${name}" says why`).not.toBe('');
  expect(tip).not.toBe(name);
  const shown = (await menu.innerText()).replace(/\s+/g, ' ');
  expect(shown.includes(tip.replace(/\s+/g, ' ')), `the reason "${tip}" shows only in the tooltip, not in the menu`).toBe(false);
});

// a refused entry still takes the click (aria-disabled, not disabled): the click must do nothing
When('I try {string} in the stage actions menu', async ({ e2e }, name) => {
  await stageMenu(e2e.window).getByRole('menuitem', { name, exact: true }).click({ force: true });
});

Then('no confirm dialog opens', async ({ e2e }) => {
  await expect(confirmModal(e2e.window)).toBeHidden();
});
