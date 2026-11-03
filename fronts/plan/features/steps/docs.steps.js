// Steps of fronts/plan/features/docs.feature (#647, write doc phase 1): Plan & Design > Documents, the
// editor of an item's intent and spec with the writer's chat, the changes by request, the unreviewed
// queue and the SDLC gates (docs/work/write-doc/spec.md R1, R8-R13). Opening the screen reuses
// app.steps.js ("I open {string} in the sidebar"). The run is simulated (MULTIAGENT_SIMULATION_ONLY):
// the writer's draft, its turns and the review come from the mock provider.
//
// Assumes these data-testids (the developer adds them; skills/ui-conventions):
//   docs-new-item                  the Documents screen's "New item" button
//   docs-new-item-title            the New item dialog's (role=dialog) title textbox
//   docs-new-item-start            and its button that starts the intent
//   docs-item                      an item of the list (its title, its stage, its actions as buttons
//                                  named by their label, e.g. "Write the spec")
//   doc-editor                     the editor, data-stage="intent|spec"; the reader's <iframe> inside
//                                  it renders the document (headings by role, blocks with data-src)
//   doc-selection-chip             the selection chip above the writer's chat (shown once a passage
//                                  is selected on the page)
//   agent-chat-input, -send,       the writer's chat (packages/ui-kit/agent-chat.js) inside doc-editor
//   agent-chat-messages
//   doc-changes                    the changes by request; doc-change one entry per request (its text
//                                  holds the request), inside it doc-undo-change ("Undo this change")
//   doc-unreviewed-count           the count of unreviewed changes
//   doc-send-to-review             "Send to review" (ends the human_edit step)
//   doc-gate-accept                the approval gate's button: "Accept intent" or "Sign off spec"
//   doc-status                     the document's status ("Draft", "Accepted", "Signed off")
// After the sign-off, "Create epic and phase issues" and "Start the Build" are buttons of doc-editor,
// found by their names.
//
// The accepted intent of scenario 2 is seeded as files committed to the demo project's folder (a git
// repository, fixed identity), the way an earlier run would have left it; nothing else is seeded.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('../../../../features/steps/fixtures');

const RUN_TIMEOUT = 60000; // a simulated writer's or reviewer's turn
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const slugOf = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const editor = (page) => page.getByTestId('doc-editor');
const reader = (page) => editor(page).locator('iframe').first().contentFrame();
const heading = (page, name) => reader(page).getByRole('heading', { name: new RegExp(`^\\s*${escapeRe(name)}\\s*$`) });
// the section's first block below its heading (a paragraph or a list the reader tagged with data-src)
const firstBlock = (page, section) => heading(page, section).locator('xpath=following-sibling::*[@data-src][1]');
const chat = (page) => editor(page);
const changes = (page) => editor(page).getByTestId('doc-changes');
const change = (page, text) => changes(page).getByTestId('doc-change').filter({ hasText: text });
const item = (page, title) => page.getByTestId('docs-item').filter({ hasText: title });

// git in the project's folder with a fixed identity, never the machine's config
function git(e2e, cwd, args) {
  const config = path.join(e2e.scratch, 'empty.gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_AUTHOR_DATE: '2026-10-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T10:00:00Z' };
  return execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, env, encoding: 'utf8' }).trim();
}

const demoFolder = (e2e) => {
  const folder = e2e.project && e2e.project.folder;
  expect(folder, 'the demo project has a folder').toBeTruthy();
  return folder;
};

// what "no issue filed, no build started" compares against: the project's backlog and the runs folder
function workSnapshot(e2e) {
  const ws = path.join(e2e.scratch, 'workspace');
  const backlogFile = path.join(ws, 'backlog', `${e2e.project.id}.json`);
  const runsDir = path.join(ws, 'runs');
  return {
    backlog: fs.existsSync(backlogFile) ? fs.readFileSync(backlogFile, 'utf8') : null,
    runs: fs.existsSync(runsDir) ? fs.readdirSync(runsDir).sort() : [],
  };
}

const intentMd = (slug, title, lang) => [
  '---',
  `item: ${slug}`,
  'issue: "#1"',
  'stage: intent',
  'status: accepted',
  'approver: Product Owner',
  'date: 2026-10-01',
  lang === 'en' ? 'translation: intent.pt-BR.md' : 'source: intent.md',
  '---',
  '',
  `# Intent: ${title}`,
  '',
  '## Problem',
  '',
  'Owners cannot take a list of runs out of the app to share it.',
  '',
  '## Proposed outcome',
  '',
  'A button exports the visible runs as a CSV file.',
  '',
  '## Affected users and systems',
  '',
  'Owners; the Runs screen.',
  '',
  '## Constraints',
  '',
  'No network; the file stays on the machine.',
  '',
  '## Open questions',
  '',
  'None.',
  '',
].join('\n');

// ---- the Documents screen ---------------------------------------------------------------------------

When('I start a new item {string}', async ({ e2e }, title) => {
  const page = e2e.window;
  // #671: New item is the side panel of mock-1 (no dialog)
  await page.getByTestId('docs-new-item').click();
  const panel = page.getByTestId('docs-new-panel');
  await expect(panel).toBeVisible();
  await panel.getByTestId('docs-new-item-title').fill(title);
  await panel.getByTestId('docs-new-item-start').click();
});

Given('the demo project\'s repository has the item {string} with an accepted intent', async ({ e2e }, title) => {
  seedAcceptedIntent(e2e, title, slugOf(title));
});

// #696: a long title under a short folder name (docs/work/<folder>/), the path stays short on Windows
Given('the demo project\'s repository has the item {string} in the folder {string} with an accepted intent', async ({ e2e }, title, slug) => {
  seedAcceptedIntent(e2e, title, slug);
});

function seedAcceptedIntent(e2e, title, slug) {
  const folder = demoFolder(e2e);
  const dir = path.join(folder, 'docs', 'work', slug);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(folder, '.git'))) git(e2e, folder, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'intent.md'), intentMd(slug, title, 'en'));
  fs.writeFileSync(path.join(dir, 'intent.pt-BR.md'), intentMd(slug, title, 'pt-BR'));
  git(e2e, folder, ['add', '-A']);
  git(e2e, folder, ['commit', '-q', '-m', `Accept the intent of ${title}`]);
  e2e.docItem = { title, slug, dir };
}

When('I choose {string} on the item {string}', async ({ e2e }, action, title) => {
  const row = item(e2e.window, title);
  await expect(row).toBeVisible({ timeout: RUN_TIMEOUT });
  await row.getByRole('button', { name: action, exact: true }).click();
});

// ---- the editor and the writer ------------------------------------------------------------------------

Then('the writer drafts the {word} with the section {string}', async ({ e2e }, stage, section) => {
  const page = e2e.window;
  await expect(editor(page)).toBeVisible();
  await expect(editor(page)).toHaveAttribute('data-stage', stage);
  await expect(heading(page, section)).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(firstBlock(page, section)).not.toHaveText('');
  await expect(chat(page).getByTestId('agent-chat-input')).toBeEnabled({ timeout: RUN_TIMEOUT });
});

When('I select a passage of the {string} section', async ({ e2e }, section) => {
  const page = e2e.window;
  const block = firstBlock(page, section);
  await expect(block).toBeVisible();
  e2e.docBefore = { section, text: (await block.innerText()).trim() };
  // a triple click selects the block on the rendered page, as a person would
  await block.click({ clickCount: 3 });
  await expect(editor(page).getByTestId('doc-selection-chip')).toBeVisible();
});

When('I ask the writer {string} about the selected passage', async ({ e2e }, request) => {
  const page = e2e.window;
  const input = chat(page).getByTestId('agent-chat-input');
  await input.fill(request);
  const send = chat(page).getByTestId('agent-chat-send');
  await expect(send).toBeEnabled();
  const replies = chat(page).locator('[data-testid="agent-chat-message"][data-role="agent"]');
  const before = await replies.count();
  await send.click();
  await expect(chat(page).getByTestId('agent-chat-messages')).toContainText(request);
  // the writer's turn is over when its reply joins the conversation; Send stays off after a request
  // until a passage is selected again (the selection is used up by the change)
  await expect(replies).toHaveCount(before + 1, { timeout: RUN_TIMEOUT });
});

// ---- the changes by request and the unreviewed queue ------------------------------------------------

Then('the changes by request show the change {string}', async ({ e2e }, request) => {
  await expect(change(e2e.window, request)).toHaveCount(1, { timeout: RUN_TIMEOUT });
  await expect(change(e2e.window, request)).toBeVisible();
});

Then('the document has {int} unreviewed change(s)', async ({ e2e }, n) => {
  await expect(editor(e2e.window).getByTestId('doc-unreviewed-count')).toContainText(new RegExp(`(^|\\D)${n}(\\D|$)`));
});

When('I undo the change {string} in the unreviewed queue', async ({ e2e }, request) => {
  const undo = change(e2e.window, request).getByTestId('doc-undo-change');
  await expect(undo).toHaveAccessibleName('Undo this change');
  await undo.click();
});

Then('the unreviewed queue no longer shows the change {string}', async ({ e2e }, request) => {
  await expect(changes(e2e.window)).toBeVisible();
  await expect(change(e2e.window, request)).toHaveCount(0, { timeout: RUN_TIMEOUT });
});

Then('the {string} section no longer reads as before the change', async ({ e2e }, section) => {
  expect(e2e.docBefore?.section, 'a passage of this section was selected before').toBe(section);
  await expect(firstBlock(e2e.window, section)).not.toHaveText(e2e.docBefore.text, { timeout: RUN_TIMEOUT });
});

Then('the {string} section reads as before the change', async ({ e2e }, section) => {
  expect(e2e.docBefore?.section, 'a passage of this section was selected before').toBe(section);
  await expect(firstBlock(e2e.window, section)).toHaveText(e2e.docBefore.text, { timeout: RUN_TIMEOUT });
});

// ---- review and the gates ---------------------------------------------------------------------------

When('I send the document to review', async ({ e2e }) => {
  const page = e2e.window;
  e2e.docWorkBefore = workSnapshot(e2e);
  const send = editor(page).getByTestId('doc-send-to-review');
  await expect(send).toHaveAccessibleName('Send to review');
  await send.click();
  // the simulated reviewer runs, then the approval gate waits for the person
  await expect(editor(page).getByTestId('doc-gate-accept')).toBeEnabled({ timeout: RUN_TIMEOUT });
});

When('I choose {string} at the approval gate', async ({ e2e }, action) => {
  const gate = editor(e2e.window).getByTestId('doc-gate-accept');
  await expect(gate).toHaveAccessibleName(action);
  await gate.click();
});

Then('the document is shown as {string}', async ({ e2e }, status) => {
  await expect(editor(e2e.window).getByTestId('doc-status')).toContainText(status, { timeout: RUN_TIMEOUT });
});

Then('the document offers {string} and {string}', async ({ e2e }, first, second) => {
  for (const name of [first, second]) {
    await expect(editor(e2e.window).getByRole('button', { name, exact: true })).toBeEnabled();
  }
});

Then('no issue was filed and no build was started', async ({ e2e }) => {
  const before = e2e.docWorkBefore;
  expect(before, 'the work was recorded before the review').toBeTruthy();
  const now = workSnapshot(e2e);
  expect(now.backlog, 'the project\'s backlog is unchanged').toBe(before.backlog);
  expect(now.runs, 'no new run was started').toEqual(before.runs);
  if (e2e.docItem) expect(fs.existsSync(path.join(e2e.docItem.dir, 'plan.md')), 'the Build wrote no plan.md').toBe(false);
  // the Product Owner's proposal is not open either: it waits for "Create epic and phase issues"
  await expect(e2e.window.getByRole('dialog')).toHaveCount(0);
});

// ---- #671: the screens as in the mockups (docs/work/write-doc/images/mock-1..5.jpg, living-doc.jpg) ----
// Assumes the data-testids of the #671 contract: docs-item-stages, docs-item-pill (a row's stage chain
// and status pill); docs-new-panel (the New item side panel) with docs-new-starts-with (a <select>),
// docs-new-item-title, docs-new-screens, docs-new-writers, docs-new-item-start; doc-stepper with six
// doc-step (aria-current="step" on the open one); doc-toc; doc-toolbar (tabs by role, doc-lang-en,
// doc-lang-pt, doc-versions, doc-send-to-review); doc-writer-panel (doc-apply-now, doc-queue,
// doc-attach-image); doc-review-score, doc-review-note (doc-note-apply, -edit, -dismiss); doc-signoff
// with doc-signoff-frontmatter, doc-signoff-next and doc-gate-accept / doc-gate-revise / doc-gate-cancel.

const newPanel = (page) => page.getByTestId('docs-new-panel');
const listOf = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
const signoff = (page) => editor(page).getByTestId('doc-signoff');

Then('the item {string} shows the stages {string}', async ({ e2e }, title, stages) => {
  const row = item(e2e.window, title);
  await expect(row).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(row.getByTestId('docs-item-stages')).toContainText(stages);
});

Then('the item {string} shows the status of {string}', async ({ e2e }, title, file) => {
  const pill = item(e2e.window, title).getByTestId('docs-item-pill');
  await expect(pill).toBeVisible();
  // "<file> · <state>"
  await expect(pill).toHaveText(new RegExp(`^\\s*${escapeRe(file)}\\s*·\\s*\\S`));
});

When('I open the New item panel', async ({ e2e }) => {
  const page = e2e.window;
  await page.getByTestId('docs-new-item').click();
  await expect(newPanel(page)).toBeVisible();
  await expect(newPanel(page).getByRole('heading', { name: 'New item', exact: true })).toBeVisible();
});

Then('the New item panel starts with {string}', async ({ e2e }, option) => {
  const select = newPanel(e2e.window).getByTestId('docs-new-starts-with');
  await expect(select).toBeVisible();
  await expect(select.locator('option:checked')).toHaveText(option);
});

// each asked field: its label, and the control the contract names for it
const NEW_ITEM_FIELDS = {
  'What it is about': 'docs-new-item-title',
  'Screens to capture first': 'docs-new-screens',
  'Several writers': 'docs-new-writers',
};

Then('the New item panel asks {string}, {string} and {string}', async ({ e2e }, a, b, c) => {
  const panel = newPanel(e2e.window);
  for (const label of [a, b, c]) {
    await expect(panel.getByText(label, { exact: true })).toBeVisible();
    const testId = NEW_ITEM_FIELDS[label];
    if (testId) await expect(panel.getByTestId(testId)).toBeVisible();
  }
  await expect(panel.getByTestId('docs-new-writers')).not.toBeChecked();
  await expect(panel.getByTestId('docs-new-screen-add')).toBeVisible();
});

// #648: "Several writers" (Arena mode) is no longer disabled
When('I turn on {string} in the New item panel', async ({ e2e }, label) => {
  const control = newPanel(e2e.window).getByTestId(NEW_ITEM_FIELDS[label]);
  await expect(control).toBeEnabled();
  await control.check();
});

Then('the New item panel has {string} turned on', async ({ e2e }, label) => {
  await expect(newPanel(e2e.window).getByTestId(NEW_ITEM_FIELDS[label])).toBeChecked();
});

Then('the New item panel offers {string}', async ({ e2e }, name) => {
  const start = newPanel(e2e.window).getByTestId('docs-new-item-start');
  await expect(start).toHaveAccessibleName(name);
  await expect(start).toBeVisible();
});

Then('the Documents screen looks like the baseline {string}', async ({ e2e }, name) => {
  await expect(e2e.window).toHaveScreenshot(name);
});

Then('the document\'s stages are {string} with {string} open', async ({ e2e }, names, open) => {
  const steps = editor(e2e.window).getByTestId('doc-stepper').getByTestId('doc-step');
  const expected = listOf(names);
  await expect(steps).toHaveCount(expected.length);
  for (const [i, name] of expected.entries()) {
    await expect(steps.nth(i)).toContainText(name);
    if (name === open) await expect(steps.nth(i)).toHaveAttribute('aria-current', 'step');
    else await expect(steps.nth(i)).not.toHaveAttribute('aria-current', 'step');
  }
});

Then('the contents list {string} and {string}', async ({ e2e }, first, second) => {
  const toc = editor(e2e.window).getByTestId('doc-toc');
  for (const entry of [first, second]) await expect(toc.getByText(entry, { exact: true })).toBeVisible();
});

Then('the toolbar offers the tabs {string}, {string} and {string}', async ({ e2e }, a, b, c) => {
  const toolbar = editor(e2e.window).getByTestId('doc-toolbar');
  for (const name of [a, b, c]) await expect(toolbar.getByRole('tab', { name, exact: true })).toBeVisible();
});

Then('the toolbar switches the language between {string} and {string}', async ({ e2e }, en, pt) => {
  const toolbar = editor(e2e.window).getByTestId('doc-toolbar');
  await expect(toolbar.getByTestId('doc-lang-en')).toHaveText(en);
  await expect(toolbar.getByTestId('doc-lang-pt')).toHaveText(pt);
});

Then('the toolbar offers {string} and {string}', async ({ e2e }, a, b) => {
  const toolbar = editor(e2e.window).getByTestId('doc-toolbar');
  for (const name of [a, b]) await expect(toolbar.getByRole('button', { name, exact: true })).toBeVisible();
});

const WRITER_CONTROLS = { 'Apply now': 'doc-apply-now', Queue: 'doc-queue', 'Attach image': 'doc-attach-image' };

Then('the writer panel offers {string}, {string} and {string}', async ({ e2e }, a, b, c) => {
  const panel = editor(e2e.window).getByTestId('doc-writer-panel');
  await expect(panel).toBeVisible();
  for (const name of [a, b, c]) {
    const testId = WRITER_CONTROLS[name];
    const control = testId ? panel.getByTestId(testId) : panel.getByRole('button', { name, exact: true });
    await expect(control).toBeVisible();
    await expect(control).toContainText(name);
  }
});

Then('the editor looks like the baseline {string}', async ({ e2e }, name) => {
  await expect(editor(e2e.window)).toHaveScreenshot(name);
});

Then('the review shows its score out of 10', async ({ e2e }) => {
  await expect(editor(e2e.window).getByTestId('doc-review-score')).toHaveText(/^\s*\d+(\.\d+)?\s*\/\s*10\s*$/, { timeout: RUN_TIMEOUT });
});

const NOTE_ACTIONS = { Apply: 'doc-note-apply', Edit: 'doc-note-edit', Dismiss: 'doc-note-dismiss' };

Then('a review note offers {string}, {string} and {string}', async ({ e2e }, a, b, c) => {
  const note = editor(e2e.window).getByTestId('doc-review-note').first();
  await expect(note).toBeVisible();
  await expect(note).toContainText('#');
  for (const name of [a, b, c]) {
    const button = NOTE_ACTIONS[name] ? note.getByTestId(NOTE_ACTIONS[name]) : note.getByRole('button', { name, exact: true });
    await expect(button).toHaveAccessibleName(name);
    await expect(button).toBeEnabled();
  }
});

Then('the sign-off panel is headed {string}', async ({ e2e }, title) => {
  await expect(signoff(e2e.window)).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(signoff(e2e.window).getByRole('heading', { name: new RegExp(`^\\s*${escapeRe(title)}\\b`) })).toBeVisible();
});

Then('the sign-off panel shows the front matter after sign-off {string}', async ({ e2e }, text) => {
  const panel = signoff(e2e.window);
  await expect(panel.getByText('Front matter after sign-off', { exact: true })).toBeVisible();
  await expect(panel.getByTestId('doc-signoff-frontmatter')).toContainText(text);
});

Then('the sign-off panel proposes {string} and {string}', async ({ e2e }, a, b) => {
  const next = signoff(e2e.window).getByTestId('doc-signoff-next');
  for (const name of [a, b]) await expect(next.filter({ hasText: name })).toHaveCount(1);
});

const GATE_BUTTONS = { 'Sign off spec': 'doc-gate-accept', 'Back to editing': 'doc-gate-revise', Stop: 'doc-gate-cancel' };

Then('the sign-off panel offers {string}, {string} and {string}', async ({ e2e }, a, b, c) => {
  const panel = signoff(e2e.window);
  for (const name of [a, b, c]) {
    const button = GATE_BUTTONS[name] ? panel.getByTestId(GATE_BUTTONS[name]) : panel.getByRole('button', { name, exact: true });
    await expect(button).toHaveAccessibleName(name);
    await expect(button).toBeEnabled();
  }
});

// the front matter's date is the day of the run: masked so the baseline holds on any day
Then('the sign-off panel looks like the baseline {string}', async ({ e2e }, name) => {
  const panel = signoff(e2e.window);
  await expect(panel).toHaveScreenshot(name, { mask: [panel.getByTestId('doc-signoff-frontmatter')] });
});

// ---- #696: the list rows on one line (mock-1) and Send to review at the toolbar's right (mock-2) ------
// Assumes these data-testids (besides the #671 ones: docs-item-stages, docs-item-pill, doc-toolbar,
// doc-versions, doc-send-to-review): docs-item-title, the title of a list row.

const boxOf = async (locator, what) => {
  await expect(locator, what).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${what} has a box on the screen`).toBeTruthy();
  return box;
};
// two boxes are on one line when each one's vertical middle falls inside the other one
const middle = (b) => b.y + b.height / 2;
const inside = (y, b) => y >= b.y && y <= b.y + b.height;
const expectSameLine = (a, b, what) => {
  expect(inside(middle(a), b) && inside(middle(b), a), `${what} are on one line`).toBe(true);
};
const paddingRight = (locator) => locator.evaluate((el) => parseFloat(getComputedStyle(el).paddingRight) || 0);
const oneSpace = (s) => s.replace(/\s+/g, ' ').trim();

Then('the item {string} reads {string} on one line', async ({ e2e }, title, text) => {
  const row = item(e2e.window, title);
  await expect(row).toBeVisible({ timeout: RUN_TIMEOUT });
  const name = row.getByTestId('docs-item-title');
  const stages = row.getByTestId('docs-item-stages');
  const read = oneSpace(`${await name.textContent()} ${await row.getByText('·', { exact: true }).first().textContent()} ${await stages.textContent()}`);
  expect(read, 'the row reads its title, a dot and its stages').toBe(oneSpace(text));
  const titleBox = await boxOf(name, 'the title');
  expectSameLine(titleBox, await boxOf(stages, 'the stages'), 'the title and the stages');
  // every dot between the title and the stages, and between the stages, sits on the title's line
  const dots = row.getByText('·', { exact: true });
  const count = await dots.count();
  expect(count, 'the row separates its title and its stages with a dot').toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) expectSameLine(titleBox, await boxOf(dots.nth(i), `dot ${i + 1}`), `the title and dot ${i + 1}`);
});

Then('the item {string} shows its status and its actions at the right of its stages', async ({ e2e }, title) => {
  const row = item(e2e.window, title);
  const titleBox = await boxOf(row.getByTestId('docs-item-title'), 'the title');
  const stages = await boxOf(row.getByTestId('docs-item-stages'), 'the stages');
  const pill = await boxOf(row.getByTestId('docs-item-pill'), 'the status');
  expectSameLine(titleBox, pill, 'the title and the status');
  expect(pill.x, 'the status is right of the stages').toBeGreaterThanOrEqual(stages.x + stages.width);
  const buttons = row.getByRole('button');
  const n = await buttons.count();
  expect(n, 'the row offers an action').toBeGreaterThan(0);
  let rightmost = pill.x + pill.width;
  for (let i = 0; i < n; i += 1) {
    const b = await boxOf(buttons.nth(i), `action ${i + 1}`);
    expectSameLine(titleBox, b, `the title and action ${i + 1}`);
    expect(b.x, `action ${i + 1} is right of the stages`).toBeGreaterThanOrEqual(stages.x + stages.width);
    rightmost = Math.max(rightmost, b.x + b.width);
  }
  // the status and the actions end at the row's right edge (inside its padding)
  const rowBox = await boxOf(row, 'the row');
  expect(rightmost, 'the status and the actions sit at the right of the row').toBeGreaterThanOrEqual(rowBox.x + rowBox.width - (await paddingRight(row)) - 2);
});

Then('the title of the item {string} is cut with an ellipsis', async ({ e2e }, title) => {
  const name = item(e2e.window, title).getByTestId('docs-item-title');
  await expect(name).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(name).toHaveCSS('text-overflow', 'ellipsis');
  await expect(name).toHaveCSS('white-space', 'nowrap');
  const cut = await name.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(cut, 'the title is wider than its room, so the ellipsis shows').toBe(true);
});

Then('the toolbar ends with {string} right after {string}', async ({ e2e }, last, before) => {
  const toolbar = editor(e2e.window).getByTestId('doc-toolbar');
  const send = toolbar.getByTestId('doc-send-to-review');
  const versions = toolbar.getByTestId('doc-versions');
  await expect(send).toHaveAccessibleName(last);
  await expect(versions).toHaveAccessibleName(before);
  await expect(send).toBeEnabled({ timeout: RUN_TIMEOUT });
  const sendBox = await boxOf(send, `"${last}"`);
  const versionsBox = await boxOf(versions, `"${before}"`);
  expectSameLine(versionsBox, sendBox, `"${before}" and "${last}"`);
  expect(sendBox.x, `"${last}" is right of "${before}"`).toBeGreaterThanOrEqual(versionsBox.x + versionsBox.width);
  // nothing of the toolbar comes after it, and it ends at the toolbar's right edge
  const controls = toolbar.locator('button:visible, [role="tab"]:visible');
  for (let i = 0; i < await controls.count(); i += 1) {
    const b = await controls.nth(i).boundingBox();
    if (b) expect(b.x + b.width, `no control of the toolbar is right of "${last}"`).toBeLessThanOrEqual(sendBox.x + sendBox.width + 1);
  }
  const bar = await boxOf(toolbar, 'the toolbar');
  expect(sendBox.x + sendBox.width, `"${last}" sits at the toolbar's right`).toBeGreaterThanOrEqual(bar.x + bar.width - (await paddingRight(toolbar)) - 2);
});
