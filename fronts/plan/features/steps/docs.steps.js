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
  await page.getByTestId('docs-new-item').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('docs-new-item-title').fill(title);
  await dialog.getByTestId('docs-new-item-start').click();
  await expect(dialog).toBeHidden();
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
