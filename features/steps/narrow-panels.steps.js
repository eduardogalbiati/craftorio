// Steps of features/narrow-panels.feature: text stays inside its card in narrow panels (#443) and
// status pills stay on one line with short Portuguese labels (#437), at the main window's minimum
// size (src/main.js minWidth / minHeight), in English or Portuguese (Brasil).
// The interface language is written into the scratch workspace's settings.json (language.interface,
// src/workspace.js) and the page reloads, so a scenario starts in that language; the steps that
// navigate read their labels from the app's catalogs (src/shared/i18n/<lang>.json) in the language
// the page shows (the html lang attribute, src/renderer/interface-language.js).
// Locators are roles and data-testid only (skills/ui-conventions). Existing: run-list-row (data-run:
// the run id), status-label (the pill's label, data-status), run-suite-card, run-gate. NEW:
//   run-side-column   the Run screen's left column (aside.panel.config: the run summary, its suite
//                     cards and scratch workspace line, the steps)
//   run-suite-file    a test file path in a suite card's list; its title is the whole path
//   run-title-text    a run's title text (run-meta.js runTitleHtml); its title is the whole title
// "Passes the edge": a text node's visible extent (its layout boxes, clipped by every ancestor whose
// overflow is not visible) reaches past its nearest card (data-testid ending in "-card", or the gate
// card) or the checked box; a text cut by a box without text-overflow: ellipsis also counts; a text
// cut with an ellipsis must have its whole text in a title on it or an ancestor.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const LOAD_TIMEOUT = 30000;
// the main window's minWidth / minHeight (src/main.js), as arena.steps.js
const MIN_SIZE = '1100x700';
const LANGUAGES = { English: 'en', 'Português (Brasil)': 'pt-BR' };
const I18N_DIR = path.join(__dirname, '..', '..', 'src', 'shared', 'i18n');
const catalogs = {};
const catalog = (code) => (catalogs[code] ||= JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${code}.json`), 'utf8')));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const visibleTestId = (page, id) => page.getByTestId(id).filter({ visible: true }).first();
const runRow = (page, fragment) => page.locator(`[data-testid="run-list-row"][data-run$="${fragment}"]`).filter({ visible: true }).first();

// the text of a catalog key in the language the page shows
async function label(page, key) {
  const lang = await page.evaluate(() => document.documentElement.lang || 'en');
  const code = lang.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
  const text = catalog(code)[key] ?? catalog('en')[key];
  if (!text) throw new Error(`no catalog entry "${key}"`);
  return text;
}

Given('the app is open in {string} at its minimum window size', async ({ e2e }, language) => {
  const code = LANGUAGES[language];
  if (!code) throw new Error(`no catalog for the language "${language}" (known: ${Object.keys(LANGUAGES).join(', ')})`);
  await e2e.open({ size: MIN_SIZE });
  const file = path.join(e2e.scratch, 'workspace', 'settings.json');
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, JSON.stringify({ ...settings, language: { ...(settings.language || {}), interface: code } }, null, 2));
  await e2e.window.reload();
  await e2e.window.waitForLoadState('domcontentloaded');
  await expect(e2e.window.locator('html')).toHaveAttribute('lang', code === 'en' ? /^en/ : code, { timeout: LOAD_TIMEOUT });
});

// ---- seeded runs ---------------------------------------------------------------------------------------
// A finished simulated ai-development-local-hero run of the demo project, written like run.steps.js
// seedAiDevRun (events.jsonl, summary.json); the run list reads the runs folder when it opens.
const AI_DEV = 'ai-development-local-hero';
function seedRun(e2e, suffix, task, steps, files = {}) {
  const min = 6e4;
  const start = Date.now() - 2 * 864e5;
  const runId = `${new Date(start).toISOString().slice(0, 10).replace(/-/g, '')}-101500-${suffix}`;
  const dir = path.join(e2e.scratch, 'workspace', 'runs', runId);
  const at = (m) => new Date(start + m * min).toISOString();
  const projectId = e2e.project.id;
  const inner = steps(at);
  const end = Math.max(1, ...inner.map((e) => (Date.parse(e.ts) - start) / min)) + 1;
  const stepList = [...new Map(inner.filter((e) => e.type === 'step.started').map((e) => [e.step_id, { id: e.step_id, type: e.step_type || 'agent', agent: e.agent }])).values()];
  const events = [
    { ts: at(0), type: 'workflow.started', run_id: runId, workflow: AI_DEV, file: `${AI_DEV}.yaml`, project_id: projectId, mock: true, inputs: { task }, steps: stepList },
    ...inner,
    { ts: at(end), type: 'workflow.finished', run_id: runId, status: 'success' },
  ].map((e, i) => ({ seq: i + 1, run_id: runId, ...e }));
  const all = {
    'events.jsonl': `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
    'summary.json': JSON.stringify({ run_id: runId, workflow: AI_DEV, project_id: projectId, mock: true, inputs: { task }, status: 'success', started_at: at(0), finished_at: at(end), duration_ms: end * min, sessions: [] }, null, 2),
    ...files,
  };
  for (const [rel, content] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return runId;
}
const developTurn = (at) => {
  const session = { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' };
  return [
    { ts: at(1), type: 'step.started', step_id: 'develop', step_type: 'agent', agent: 'developer', visit: 1 },
    { ts: at(1), type: 'session.opened', session_id: 's-develop', session },
    { ts: at(20), type: 'session.message_received', session_id: 's-develop', step_id: 'develop', text: 'Done.', cost_usd: 0.1, duration_ms: 19 * 6e4, session },
    { ts: at(20), type: 'step.finished', step_id: 'develop', duration_ms: 19 * 6e4, output: { summary: 'Implemented the task.' } },
  ];
};

// the suite step ran with scope "files" only (the scope badge reads "Only the affected tests"): three
// affected test files with long paths, each with a long reason
const LONG_FILES = {
  'test/integration/renderer/views/run/suite-cards-stay-inside-the-narrow-side-column-of-the-run-screen.test.js':
    'imports src/renderer/views/run/run.js, which draws the suite cards, the scratch workspace line and the run summary of the side column',
  'test/integration/renderer/artifacts-panel/scratch-workspace-line-with-its-open-in-button.test.js':
    'imports src/renderer/artifacts-panel.js through src/renderer/views/run/run.js and src/renderer/status-pill.js',
  'test/unit/shared/i18n/portuguese-catalog-keeps-every-status-pill-label-short-enough.test.js':
    'reads src/shared/i18n/pt-BR.json, changed by this run together with src/shared/i18n/en.json',
};
Given('the demo project has a finished AI Development run {string} whose suite ran only affected test files with long paths', async ({ e2e }, suffix) => {
  const files = Object.keys(LONG_FILES);
  const selection = {
    mode: 'affected', files, reasons: LONG_FILES, changed: ['src/renderer/views/run/run.js', 'src/renderer/artifacts-panel.js', 'src/shared/i18n/pt-BR.json'], slow: [],
    why: `the ${files.length} affected test file(s) reach the 3 changed file(s); the whole suite was not run`,
  };
  e2e.longPaths = files;
  seedRun(e2e, suffix, `A run whose affected suite lists long test file paths (${suffix})`, (at) => [
    ...developTurn(at),
    { ts: at(21), type: 'step.started', step_id: 'suite', step_type: 'suite', visit: 1 },
    {
      ts: at(25),
      type: 'step.finished',
      step_id: 'suite',
      duration_ms: 4 * 6e4,
      output: {
        kind: 'suite', status: 'pass', round: 1, scope: 'files', command: `node --test ${files.join(' ')}`, log: 'logs/suite-1.log', exit_code: 0, duration_ms: 3 * 6e4, passed: 27, failed: 0, failures: [], preexisting: [], selection,
        message: 'The affected tests passed in round 1.',
      },
    },
  ], { 'logs/suite-1.log': '$ node --test …   (simulated: nothing was run)\n' });
});

Given('the demo project has a finished AI Development run {string} whose title is too long for its row', async ({ e2e }, suffix) => {
  seedRun(e2e, suffix, `Add a health endpoint that reports the database, the job queue, the cache, the mail relay and the payment provider, each with its latency, its last error and the time it last answered (${suffix})`, (at) => developTurn(at));
});

// ---- the runs list (Workflows › Runs), in the language shown -------------------------------------------

async function openRunsList(page) {
  const runs = await label(page, 'nav.workflows.runs');
  await page.getByRole('navigation').getByRole('button', { name: new RegExp(`^${escapeRe(runs)}(\\s+(☾\\s+)?\\d+)?$`) }).first().click();
  // simulated runs (the seeded ones) are hidden until "Show simulated" is ticked
  const showSim = page.getByRole('checkbox', { name: await label(page, 'workflows.show_simulated'), exact: true }).filter({ visible: true }).first();
  await showSim.check({ timeout: LOAD_TIMEOUT });
  await expect(page.getByTestId('run-list-row').filter({ visible: true }).first()).toBeVisible({ timeout: LOAD_TIMEOUT });
}

async function searchRuns(page, text) {
  await page.evaluate(() => document.querySelectorAll('[data-testid="run-list-row"]').forEach((r) => r.setAttribute('data-e2e-stale', '')));
  await page.getByRole('textbox', { name: await label(page, 'workflows.search_runs'), exact: true }).filter({ visible: true }).first().fill(text);
  await page.waitForFunction((needle) => {
    const rows = [...document.querySelectorAll('[data-testid="run-list-row"]')].filter((r) => r.checkVisibility());
    return rows.length > 0 && rows.every((r) => !r.hasAttribute('data-e2e-stale') && `${r.dataset.run} ${r.textContent}`.toLowerCase().includes(needle));
  }, text.toLowerCase(), { timeout: LOAD_TIMEOUT });
  await expect(runRow(page, text)).toBeVisible({ timeout: LOAD_TIMEOUT });
}

When('I open the runs list', async ({ e2e }) => {
  await openRunsList(e2e.window);
});

When('I search the runs list for {string}', async ({ e2e }, text) => {
  await searchRuns(e2e.window, text);
});

// opens the runs list, finds the run and clicks its row's "Open run" (the row expands first)
When('I open the run {string} from the runs list', async ({ e2e }, fragment) => {
  const page = e2e.window;
  await openRunsList(page);
  await searchRuns(page, fragment);
  const row = runRow(page, fragment);
  const button = row.getByRole('button', { name: await label(page, 'run_list.open_run'), exact: true });
  if (!(await button.isVisible())) await row.locator('.pr-row').first().click();
  await button.click();
  await expect(visibleTestId(page, 'run-side-column')).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// ---- text inside its card (#443) -----------------------------------------------------------------------

// the texts of `box` that pass the edge of their card, and those cut with "…" but without a tooltip
function textOffenders(box) {
  const passing = [];
  const noTooltip = [];
  const describe = (n) => n.textContent.trim().slice(0, 80);
  const cardOf = (el) => {
    const card = el.closest('[data-testid$="-card"], [data-testid="run-gate"]');
    return card && box.contains(card) ? card : box;
  };
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || !el.checkVisibility({ visibilityProperty: true })) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) continue;
    let left = Math.min(...rects.map((r) => r.left));
    let right = Math.max(...rects.map((r) => r.right));
    const card = cardOf(el);
    const frame = card.getBoundingClientRect();
    let cut = false;
    // the ancestors that clip it, up to the checked box
    for (let a = el; a && a !== box.parentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible') continue;
      const b = a.getBoundingClientRect();
      if (right > b.right + 1 || left < b.left - 1) {
        if (cs.textOverflow === 'ellipsis' && a.scrollWidth > a.clientWidth) {
          if (!el.closest('[title]')?.getAttribute('title')?.trim()) noTooltip.push(describe(n));
        } else {
          cut = true;
        }
      }
      right = Math.min(right, b.right);
      left = Math.max(left, b.left);
    }
    if (cut || right > frame.right + 1 || left < frame.left - 1) passing.push(describe(n));
  }
  if (box.scrollWidth > box.clientWidth + 1) passing.push(`(the box itself scrolls sideways: ${box.scrollWidth} > ${box.clientWidth})`);
  return { passing, noTooltip };
}

async function expectTextInside(locator, what) {
  await expect(locator).toBeVisible({ timeout: LOAD_TIMEOUT });
  const { passing, noTooltip } = await locator.evaluate(textOffenders);
  expect(passing, `texts in ${what} that pass the edge of their card`).toEqual([]);
  expect(noTooltip, `texts in ${what} cut with "…" but without their whole text in a tooltip`).toEqual([]);
}

Then('no text in the run\'s side column passes the edge of its card', async ({ e2e }) => {
  const page = e2e.window;
  await expect(visibleTestId(page, 'run-suite-card')).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expectTextInside(visibleTestId(page, 'run-side-column'), 'the run\'s side column');
});

Then('no text in the gate card passes its edge', async ({ e2e }) => {
  await expectTextInside(visibleTestId(e2e.window, 'run-gate'), 'the gate card');
});

// each long path: on one line, cut with "…" (text-overflow: ellipsis on itself, wider than its box),
// its title the whole path
Then('the suite card\'s test file paths end in {string} with the whole path in their tooltip', async ({ e2e }, ellipsis) => {
  expect(ellipsis).toBe('…');
  const card = visibleTestId(e2e.window, 'run-suite-card');
  const paths = card.getByTestId('run-suite-file');
  await expect(paths).toHaveCount(e2e.longPaths.length, { timeout: LOAD_TIMEOUT });
  for (const file of e2e.longPaths) {
    const el = paths.filter({ hasText: file.slice(0, 20) }).first();
    await expect(el, `the path ${file}`).toHaveAttribute('title', file);
    const shown = await el.evaluate((node) => {
      const cs = getComputedStyle(node);
      const range = document.createRange();
      range.selectNodeContents(node);
      const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
      return { ellipsis: cs.textOverflow, clipped: node.scrollWidth > node.clientWidth + 1, lines: tops.size };
    });
    expect(shown, `the path ${file} is cut with "…" on one line`).toEqual({ ellipsis: 'ellipsis', clipped: true, lines: 1 });
  }
});

// ---- status pills on one line (#437) -------------------------------------------------------------------

// every visible status label of the run list: its text on one line (one line box), and the pill shows
// it whole (neither the label nor the pill is narrower than its content)
Then('every status pill on the run list stays on one line, whole', async ({ e2e }) => {
  const page = e2e.window;
  const labels = page.getByTestId('run-list-row').filter({ visible: true }).getByTestId('status-label');
  await expect(labels.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  const bad = await labels.evaluateAll((els) => els.filter((el) => el.checkVisibility()).map((el) => {
    const pill = el.closest('.pill') || el;
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
    const clipped = [el, pill].some((n) => n.scrollWidth > n.clientWidth + 1);
    return { text: el.textContent.trim(), lines: tops.size, clipped };
  }).filter((p) => p.lines > 1 || p.clipped));
  expect(bad, 'status pills that wrap or do not show their whole label').toEqual([]);
});

Then('the title of the run list row of {string} ends in {string} with the whole title in its tooltip', async ({ e2e }, fragment, ellipsis) => {
  expect(ellipsis).toBe('…');
  const title = runRow(e2e.window, fragment).getByTestId('run-title-text').first();
  await expect(title).toBeVisible({ timeout: LOAD_TIMEOUT });
  const shown = await title.evaluate((node) => {
    const cs = getComputedStyle(node);
    const range = document.createRange();
    range.selectNodeContents(node);
    const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
    return { ellipsis: cs.textOverflow, clipped: node.scrollWidth > node.clientWidth + 1, lines: tops.size, tooltip: node.getAttribute('title') === node.textContent.trim() };
  });
  expect(shown, 'the run title is cut with "…" on one line, its whole text in its tooltip').toEqual({ ellipsis: 'ellipsis', clipped: true, lines: 1, tooltip: true });
});

// the label the app shows for each status, named by its English label (the status_pill.status_<id>
// keys of the English catalog give the ids)
Then('the status pills read', async ({ e2e }, table) => {
  const en = catalog('en');
  for (const { status, label: expected } of table.hashes()) {
    const ids = Object.keys(en).filter((k) => k.startsWith('status_pill.status_') && en[k] === status).map((k) => k.slice('status_pill.status_'.length));
    expect(ids.length, `a status whose English label is "${status}"`).toBeGreaterThan(0);
    for (const id of ids) {
      const shown = await e2e.window.evaluate((s) => window.StatusPill.statusLabel(s), id);
      expect(shown, `the status "${id}" ("${status}")`).toBe(expected);
    }
  }
});
