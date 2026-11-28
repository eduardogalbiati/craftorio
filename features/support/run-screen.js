// What the steps read on the Run screen and how they reach the Start panel, once the header no longer
// holds the run's status, id, KPIs, Start, Stop and Pause (#412) and the Run screen's first row is its
// tab row (#410). Shared by the step files (features/steps/*.steps.js); locators are roles and
// data-testid only (skills/ui-conventions).
//
// The renderer's contract:
// - data-testid="run-tab-row": the Run screen's first row, the same in Details and in the run chat
//   (above the fail, pause, chain and gate banners). It holds the tablist named "Run view" (role=tab
//   "Chat", "Details", "3D", aria-selected; the 3D tab keeps data-testid="run-3d"), the run's actions
//   on the right (Ask the supervisor, Watch, Review changes, Open in Analytics, "+ When it finishes…"
//   for a live run without a chain) and, for a live run, "Pause after current step"
//   (data-testid="run-pause") and "Stop" (data-testid="run-stop") at its right end.
// - data-testid="run-screen-status": the run's status pill on that row, data-status = the status id
//   (running, paused, cancelled…), its text the readable label ("Running", "Paused", "Cancelled").
//   Since the redesign of 2026-11-28 at most two of the run's actions are buttons of the row; the others are
//   entries (role=menuitem) of its ⋮ menu: data-testid="run-actions-more" opens data-testid="run-actions-menu"
//   (runAction finds an action either way).
// - data-testid="run-screen-id": the run's id, under that row (the stations row, data-testid="run-progress-row").
// - the Start panel opens from Projects › a project card's "Start workflow" (also Home, Workflows ›
//   Definitions); its own Start button stays data-testid="start-workflow".

const { expect } = require('@playwright/test');

const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const visibleTestId = (page, id) => page.getByTestId(id).filter({ visible: true }).first();
const runTabRow = (page) => visibleTestId(page, 'run-tab-row');
const runTabs = (page) => page.getByRole('tablist', { name: 'Run view', exact: true }).filter({ visible: true }).first();
const runTab = (page, name) => runTabs(page).getByRole('tab', { name: new RegExp(`^${escapeRe(name)}\\b`) });
const runScreenStatus = (page) => visibleTestId(page, 'run-screen-status');
const runScreenId = (page) => visibleTestId(page, 'run-screen-id');

// One of the run's actions (redesign 2026-11-28): its button on the tab row, else its entry in the row's ⋮ menu,
// which this opens (left open, so the next action is read in it too). A glyph may lead the name ("◆ Watch").
async function runAction(page, name) {
  const re = new RegExp(`(^|\\s)${escapeRe(name)}`);
  const row = runTabRow(page);
  const button = row.getByRole('button', { name: re }).filter({ visible: true }).first();
  const more = row.getByTestId('run-actions-more').filter({ visible: true }).first();
  await expect(button.or(more).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  if (await button.count()) return button;
  if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
  return page.getByTestId('run-actions-menu').getByRole('menuitem', { name: re }).filter({ visible: true }).first();
}

const navItem = (page, name) => page.getByRole('navigation').getByRole('button', { name: new RegExp(`^${escapeRe(name)}(\\s+\\d+)?$`) });

// the demo project's card on Projects
const demoProjectCard = (e2e) => e2e.window.getByTestId('project-card').filter({ hasText: e2e.project?.name || 'demo-app' }).first();

async function openProjects(e2e) {
  await navItem(e2e.window, 'Projects').click();
  await expect(demoProjectCard(e2e)).toBeVisible({ timeout: LOAD_TIMEOUT });
}

// opens the Start panel (from the demo project's card) unless it is open already
async function openStartPanel(e2e) {
  const page = e2e.window;
  if (await page.getByTestId('start-workflow').isVisible()) return;
  await openProjects(e2e);
  await demoProjectCard(e2e).getByRole('button', { name: 'Start workflow', exact: true }).click();
  await expect(page.getByTestId('start-workflow')).toBeVisible({ timeout: LOAD_TIMEOUT });
}

module.exports = {
  LOAD_TIMEOUT,
  escapeRe,
  visibleTestId,
  runTabRow,
  runTabs,
  runTab,
  runScreenStatus,
  runScreenId,
  runAction,
  demoProjectCard,
  openProjects,
  openStartPanel,
};
