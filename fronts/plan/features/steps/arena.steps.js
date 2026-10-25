// Steps of fronts/plan/features/arena.feature (#311): an AI Arena run's chat screen and its right column
// (fronts/plan/views/arena/arena.js): Documents (its tabs), Peer scores, Supervisor. A cancelled
// simulated ai-arena run of the demo project is written into the scratch workspace like
// scripts/screenshot.js demoRoadmapRuns; Workflows › Runs › "Open chat" opens it in the Arena screen.
// Locators are roles and data-testid only (skills/ui-conventions). NEW data-testids (#311):
// arena-side (the <aside> column), arena-doc-section / arena-scores-section / arena-supervisor-section
// (its three <section>s), arena-doc-tabs (#arena-doc-tabs), arena-score-row (one per peer score row),
// arena-score-name / arena-score-bar / arena-score-value (the row's name, bar track and value).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, Then } = require('../../../../features/steps/fixtures');

const LOAD_TIMEOUT = 30000;
// the main window's minWidth / minHeight (apps/desktop/host/main.js)
const MIN_SIZE = '1100x700';
const WORKFLOW = 'ai-arena';
const LONG_NAME = 'quarterly-planning-reference-notes-for-the-appointment-booking-platform-for-small-clinics-with-payments-and-reminders-v12-final-reviewed.md';
const CONTENDERS = [
  { agent: 'contender_1', provider: 'claude', model: 'claude-opus-5-5' },
  { agent: 'contender_2', provider: 'claude', model: 'claude-sonnet-5-5' },
  { agent: 'contender_3', provider: 'codex', model: 'gpt-6-luna' },
];
const SECTIONS = { Documents: 'arena-doc-section', 'Peer scores': 'arena-scores-section', Supervisor: 'arena-supervisor-section' };

const side = (page) => page.getByTestId('arena-side').filter({ visible: true }).first();
const section = (page, name) => side(page).getByTestId(SECTIONS[name]);
const heading = (page, name) => section(page, name).getByRole('heading', { name, exact: true });
const box = async (locator, what) => {
  const b = await locator.boundingBox();
  expect(b, `${what} has a box`).not.toBeNull();
  return { top: b.y, bottom: b.y + b.height, left: b.x, right: b.x + b.width, width: b.width, height: b.height };
};

Given('the app is open at its minimum window size in the {word} theme', async ({ e2e }, theme) => {
  await e2e.open({ theme, size: MIN_SIZE });
});

// A simulated ai-arena run of the demo project, cancelled during the synthesis: three contenders
// delivered a proposal, each scored the others (blind critique), a reference document with a long
// name was attached (the Documents panel's first tab). events.jsonl + summary.json; the run list
// reads the runs folder when the screen opens, so no reload is needed.
Given('the demo project has a cancelled AI Arena run {string} whose reference document has a long name', async ({ e2e }, suffix) => {
  const min = 6e4;
  const start = Date.now() - 4 * 3600e3;
  const runId = `${new Date(start).toISOString().slice(0, 10).replace(/-/g, '')}-091500-${suffix}`;
  const dir = path.join(e2e.scratch, 'workspace', 'runs', runId);
  const at = (m) => new Date(start + m * min).toISOString();
  const projectId = e2e.project.id;
  const task = `Write a PRD for an appointment-booking app for small clinics, with payments, reminders, waiting lists and a rollout plan across every clinic of the network (${suffix})`;
  const inputs = {
    task,
    document_skill: 'prd-writing',
    peer_review: 'yes',
    lenses: 'off',
    attachments: `===== Attached file: ${LONG_NAME} =====\n# Reference notes\n\nClinics book by phone today; no-shows are 18%.`,
  };
  CONTENDERS.forEach((c, i) => Object.assign(inputs, {
    [`contender_${i + 1}_provider`]: c.provider, [`contender_${i + 1}_model`]: c.model, [`contender_${i + 1}_effort`]: 'high',
  }));
  for (let i = CONTENDERS.length + 1; i <= 5; i++) inputs[`contender_${i}_provider`] = 'none';
  const agents = CONTENDERS.map((c) => c.agent);
  const steps = [
    { id: 'compete', type: 'agent', agent: agents.join(' · ') },
    { id: 'critique', type: 'agent', agent: agents.join(' · ') },
    { id: 'synthesize', type: 'agent', agent: 'synthesizer' },
    { id: 'verify', type: 'agent', agent: 'verifier' },
    { id: 'review', type: 'human_approval' },
  ];
  const proposal = (c) => `# PRD: appointment booking\n\n## Problem\n\nClinics lose bookings by phone (${c.model}).\n\n## Scope\n\n- Online booking\n- Reminders\n- Payments`;
  // every contender scores every proposal; the screen leaves out a contender's score of its own
  const critique = (k) => ({
    evaluations: [1, 2, 3].map((n) => ({ proposal: n, score: 6 + ((n + k) % 3), strengths: ['Clear scope'], weaknesses: ['No metrics'], errors: [] })),
    best_ideas: ['A waiting list that fills cancelled slots'],
    self_revision: 'Add success metrics.',
  });
  const events = [
    { ts: at(0), type: 'workflow.started', workflow: WORKFLOW, file: `${WORKFLOW}.yaml`, project_id: projectId, mock: true, inputs, steps },
    { ts: at(0), type: 'step.started', step_id: 'compete', step_type: 'agent', agent: agents.join(' · '), visit: 1 },
    ...CONTENDERS.map((c) => ({ ts: at(0), type: 'session.opened', session_id: `s-compete-${c.agent}`, session: c })),
    ...CONTENDERS.map((c, i) => ({ ts: at(10 + i), type: 'session.message_received', session_id: `s-compete-${c.agent}`, step_id: `compete:${c.agent}`, text: proposal(c), cost_usd: 0.3, duration_ms: 10 * min, session: c })),
    { ts: at(13), type: 'step.finished', step_id: 'compete', duration_ms: 13 * min, output: { succeeded: agents, failed: [], results: Object.fromEntries(CONTENDERS.map((c) => [c.agent, { text: proposal(c) }])) } },
    { ts: at(13), type: 'step.started', step_id: 'critique', step_type: 'agent', agent: agents.join(' · '), visit: 1 },
    { ts: at(20), type: 'step.finished', step_id: 'critique', duration_ms: 7 * min, output: { results: Object.fromEntries(agents.map((a, k) => [a, critique(k)])) } },
    { ts: at(20), type: 'step.started', step_id: 'synthesize', step_type: 'agent', agent: 'synthesizer', visit: 1 },
    { ts: at(24), type: 'log', level: 'error', step_id: 'synthesize', message: 'synthesize: attempt 1/2 failed: the CLI stopped answering (simulated)' },
    { ts: at(26), type: 'workflow.finished', status: 'cancelled', error: 'Stopped by the user', summary: { cost_usd: 1.4, duration_ms: 26 * min } },
  ].map((e, i) => ({ seq: i + 1, run_id: runId, ...e }));
  const files = {
    'events.jsonl': `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
    'summary.json': JSON.stringify({
      run_id: runId, workflow: WORKFLOW, project_id: projectId, mock: true, inputs, status: 'cancelled', started_at: at(0), finished_at: at(26), duration_ms: 26 * min, sessions: [],
    }, null, 2),
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
});

// consecutive sections: the bottom of one never passes the top of the next (half a pixel of rounding)
Then('the Arena side column shows the sections {string}, {string} and {string}, top to bottom, without overlapping', async ({ e2e }, a, b, c) => {
  const page = e2e.window;
  await expect(side(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  // the replay has drawn the board and the checks
  await expect(section(page, 'Peer scores').getByTestId('arena-score-row').first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  const names = [a, b, c];
  const boxes = [];
  for (const name of names) {
    await expect(section(page, name), `the section "${name}"`).toBeVisible();
    boxes.push(await box(section(page, name), `the section "${name}"`));
  }
  for (let i = 0; i + 1 < boxes.length; i++) {
    expect(boxes[i].height, `"${names[i]}" has a height`).toBeGreaterThan(0);
    expect(boxes[i].bottom, `the bottom of "${names[i]}" stays above the top of "${names[i + 1]}"`).toBeLessThanOrEqual(boxes[i + 1].top + 0.5);
  }
});

// each heading inside its own section's box, never covered by the section below it
Then('each Arena side section shows its heading', async ({ e2e }) => {
  const page = e2e.window;
  const names = Object.keys(SECTIONS);
  for (let i = 0; i < names.length; i++) {
    const h = heading(page, names[i]);
    await expect(h, `the heading "${names[i]}"`).toBeVisible();
    const hb = await box(h, `the heading "${names[i]}"`);
    const sb = await box(section(page, names[i]), `the section "${names[i]}"`);
    expect(hb.height, `the heading "${names[i]}" has a height`).toBeGreaterThan(0);
    expect(hb.top, `the heading "${names[i]}" starts inside its section`).toBeGreaterThanOrEqual(sb.top - 0.5);
    expect(hb.bottom, `the heading "${names[i]}" ends inside its section`).toBeLessThanOrEqual(sb.bottom + 0.5);
    if (i > 0) {
      const above = await box(section(page, names[i - 1]), `the section "${names[i - 1]}"`);
      expect(above.bottom, `"${names[i - 1]}" does not cover the heading "${names[i]}"`).toBeLessThanOrEqual(hb.top + 0.5);
    }
  }
});

// the column fits the window; when its content is taller, it scrolls and its last section can be reached
Then('the Arena side column scrolls to its last section when it is taller than the window', async ({ e2e }) => {
  const page = e2e.window;
  const column = side(page);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  const cb = await box(column, 'the side column');
  expect(cb.bottom, 'the side column ends inside the window').toBeLessThanOrEqual(viewportHeight + 0.5);
  const scrollHeight = await column.evaluate((el) => el.scrollHeight);
  const clientHeight = await column.evaluate((el) => el.clientHeight);
  const overflowY = await column.evaluate((el) => getComputedStyle(el).overflowY);
  if (scrollHeight > clientHeight + 1) expect(['auto', 'scroll'], 'the taller side column scrolls').toContain(overflowY);
  const last = heading(page, 'Supervisor');
  await last.scrollIntoViewIfNeeded();
  await expect(last, 'the last section\'s heading can be scrolled into view').toBeInViewport();
});

// the tab row stays inside the Documents section, under its heading; the long tab is no wider than its row
Then('the long reference document\'s tab stays inside the Documents section', async ({ e2e }) => {
  const page = e2e.window;
  const docs = section(page, 'Documents');
  const tabs = docs.getByTestId('arena-doc-tabs');
  const tab = tabs.getByRole('button', { name: /quarterly-planning-reference-notes/ });
  await expect(tab).toBeVisible({ timeout: LOAD_TIMEOUT });
  const sb = await box(docs, 'the Documents section');
  const rb = await box(tabs, 'the document tabs');
  const tb = await box(tab, 'the long document tab');
  const hb = await box(heading(page, 'Documents'), 'the heading "Documents"');
  expect(rb.left, 'the tabs start inside the Documents section').toBeGreaterThanOrEqual(sb.left - 0.5);
  expect(rb.right, 'the tabs end inside the Documents section').toBeLessThanOrEqual(sb.right + 0.5);
  expect(rb.top, 'the tabs sit under the heading "Documents"').toBeGreaterThanOrEqual(hb.bottom - 0.5);
  expect(rb.bottom, 'the tabs end inside the Documents section').toBeLessThanOrEqual(sb.bottom + 0.5);
  expect(tb.width, 'the long tab is clipped or wrapped to its row').toBeLessThanOrEqual(rb.width + 0.5);
  expect(tb.left, 'the long tab starts inside the Documents section').toBeGreaterThanOrEqual(sb.left - 0.5);
});

Then('the Arena peer scores list {string}, {string} and {string}', async ({ e2e }, a, b, c) => {
  const rows = section(e2e.window, 'Peer scores').getByTestId('arena-score-row');
  await expect(rows.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(rows.getByTestId('arena-score-name')).toHaveText([a, b, c]);
});

// name, bar, value left to right in each row, none of them squeezed out: the bar's track is wider than zero
Then('each Arena peer score row shows the model\'s name, a bar wider than zero and its value, side by side', async ({ e2e }) => {
  const rows = section(e2e.window, 'Peer scores').getByTestId('arena-score-row');
  await expect(rows.first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  const n = await rows.count();
  expect(n, 'the board has rows').toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const name = row.getByTestId('arena-score-name');
    const bar = row.getByTestId('arena-score-bar');
    const value = row.getByTestId('arena-score-value');
    await expect(name).toBeVisible();
    await expect(name).not.toHaveText('');
    await expect(value).toBeVisible();
    await expect(value).toHaveText(/^\d+(\.\d)?$/);
    const label = await name.innerText();
    const rb = await box(row, `the row "${label}"`);
    const nb = await box(name, `the name "${label}"`);
    const bb = await box(bar, `the bar of "${label}"`);
    const vb = await box(value, `the value of "${label}"`);
    expect(bb.width, `the bar of "${label}" is wider than zero`).toBeGreaterThan(0);
    expect(nb.width, `the name "${label}" is wider than zero`).toBeGreaterThan(0);
    expect(nb.right, `the name "${label}" ends before its bar`).toBeLessThanOrEqual(bb.left + 0.5);
    expect(bb.right, `the bar of "${label}" ends before its value`).toBeLessThanOrEqual(vb.left + 0.5);
    expect(nb.left, `the name "${label}" starts inside its row`).toBeGreaterThanOrEqual(rb.left - 0.5);
    expect(vb.right, `the value of "${label}" ends inside its row`).toBeLessThanOrEqual(rb.right + 0.5);
  }
});

Then('the Arena document tabs do not overlap the {string} heading', async ({ e2e }, name) => {
  const page = e2e.window;
  const tabs = section(page, 'Documents').getByTestId('arena-doc-tabs');
  await expect(tabs.getByRole('button').first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  const h = heading(page, name);
  await expect(h).toBeVisible();
  const tb = await box(tabs, 'the document tabs');
  const hb = await box(h, `the heading "${name}"`);
  expect(tb.bottom, `the document tabs end above the heading "${name}"`).toBeLessThanOrEqual(hb.top + 0.5);
});
