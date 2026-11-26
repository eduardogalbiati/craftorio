// Steps of features/interface-language.feature (#330, every screen translated; see its section
// below) and of features/settings.feature's interface language scenarios (#329): Settings › General's
// "Language" group (data-testid="settings-language", #327) gets an "Interface" select (aria-label
// "Interface") listing the languages with a catalog (English, Português (Brasil)); a change
// re-renders the open windows at once, without a restart. Choosing it and reading it reuse
// settings-language.steps.js ("I choose {string} as the {string} language", "the {string} language
// is {string}", "the {string} language list offers {string}"); the sidebar's entries reuse
// app.steps.js ("the sidebar offers {string}"). These steps read the sidebar and Settings' tabs
// (data-testid="settings-tabs") in whichever language is shown, so they never wait on an English
// entry such as "Home". Also #424 (the AI agents' "Same as the interface" names its language) and
// #423 (the Product Owner's live turn in the interface language) and #444 (the app and the browser
// under test in English), in their sections below. Locators
// are roles and data-testid only (skills/ui-conventions).

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { When, Then } = require('./fixtures');
const { demoProjectCard } = require('../support/run-screen');
const { tableTexts } = require('../support/english-texts');

const LOAD_TIMEOUT = 30000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// a sidebar entry by its label; a count badge may follow it (same rule as app.steps.js)
const navItem = (page, name) => page.getByRole('navigation').getByRole('button', { name: new RegExp(`^${escapeRe(name)}(\\s+(☾\\s+)?\\d+)?$`) });
const settingsTab = (page, name) => page.getByTestId('settings-tabs').filter({ visible: true }).getByRole('button', { name, exact: true });

// the entry is gone, not merely late: waits until no sidebar entry carries the label
Then('the sidebar no longer offers {string}', async ({ e2e }, name) => {
  await expect(e2e.window.getByRole('navigation').first()).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(navItem(e2e.window, name)).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

// ---- #330: every screen in the interface language ---------------------------------------------------
// Steps of features/interface-language.feature. A step names a label by its English text; the
// expected text in the chosen language is read from the catalogs (packages/shared/i18n/<lang>.json):
// every key whose English value is the label gives its value in that language. So the steps never
// depend on key names or on wording the developer picks. A label with no catalog entry fails with a
// clear message (the screen is not translated yet). Only visible elements count (views kept hidden
// in the DOM are ignored). A button or chip may carry a trailing count ("All 12").

const I18N_DIR = path.join(__dirname, '..', '..', 'packages', 'shared', 'i18n');
const LANGUAGE_FILES = { English: 'en', 'Português (Brasil)': 'pt-BR' };
const catalog = (code) => JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${code}.json`), 'utf8'));

// the texts the English label reads as in the language (one per catalog entry carrying the label)
function translations(english, language) {
  const code = LANGUAGE_FILES[language];
  if (!code) throw new Error(`no catalog for the language "${language}" (known: ${Object.keys(LANGUAGE_FILES).join(', ')})`);
  if (code === 'en') return [english];
  const en = catalog('en');
  const other = catalog(code);
  const keys = Object.keys(en).filter((k) => en[k] === english && typeof other[k] === 'string');
  if (!keys.length) throw new Error(`no catalog entry has the English text "${english}" with a ${language} value: the screen is not translated yet`);
  return [...new Set(keys.map((k) => other[k]))];
}

const anyOf = (texts, countSuffix) => new RegExp(`^(${texts.map(escapeRe).join('|')})${countSuffix ? '(\\s+\\d+)?' : ''}$`);
const KINDS = {
  button: (page, re) => page.getByRole('button', { name: re }),
  tab: (page, re) => page.getByRole('tab', { name: re }),
  heading: (page, re) => page.getByRole('heading', { name: re }),
};

async function expectLabelIn(page, kind, english, language) {
  const locate = KINDS[kind];
  if (!locate) throw new Error(`unknown kind of label "${kind}" (known: ${Object.keys(KINDS).join(', ')})`);
  const texts = translations(english, language);
  const counted = kind !== 'heading';
  await expect(locate(page, anyOf(texts, counted)).filter({ visible: true }).first(),
    `the ${kind} "${english}" in ${language} (${texts.join(' / ')})`).toBeVisible({ timeout: LOAD_TIMEOUT });
  // no English label left, unless the language writes it the same way
  if (!texts.includes(english)) {
    await expect(locate(page, anyOf([english], counted)).filter({ visible: true }),
      `the English ${kind} "${english}" is still shown`).toHaveCount(0, { timeout: LOAD_TIMEOUT });
  }
}

Then('the screen\'s {string} {word} reads in {string}', async ({ e2e }, english, kind, language) => {
  await expectLabelIn(e2e.window, kind, english, language);
});

// several labels of one kind at once: "Sync, New issue…" (comma-separated English labels)
Then('the screen\'s {string} {word}s read in {string}', async ({ e2e }, list, kind, language) => {
  for (const english of list.split(',').map((s) => s.trim()).filter(Boolean)) {
    await expectLabelIn(e2e.window, kind, english, language);
  }
});

// a run list row's status badge (data-testid="run-list-row", its label data-testid="status-label")
Then('the run list row of {string} shows the status {string} in {string}', async ({ e2e }, fragment, english, language) => {
  const texts = translations(english, language);
  const row = e2e.window.locator(`[data-testid="run-list-row"][data-run$="${fragment}"]`).filter({ visible: true }).first();
  await expect(row.getByTestId('status-label').first()).toHaveText(anyOf(texts, false), { timeout: LOAD_TIMEOUT });
});

// ---- #424: the AI agents' "Same as the interface" names the language it resolves to -----------------
// Settings › General › Language's "AI agents" select (settings-language.steps.js) labels its default
// option "<Same as the interface> (<interface language>)": "Same as the interface (English)",
// "Igual à interface (Português (Brasil))". The select's name and the option's text are read from the
// catalogs in the shown language; the language's own name (the parenthesis) is written as is.
Then('the {string} language reads {string} naming {string}, in {string}', async ({ e2e }, name, label, named, language) => {
  const group = e2e.window.getByTestId('settings-language').filter({ visible: true });
  const select = group.getByRole('combobox', { name: anyOf(translations(name, language), false) });
  await expect(select).toBeVisible({ timeout: LOAD_TIMEOUT });
  const option = new RegExp(`^(${translations(label, language).map(escapeRe).join('|')}) \\(${escapeRe(named)}\\)$`);
  await expect(select.locator('option:checked')).toHaveText(option, { timeout: LOAD_TIMEOUT });
});

// ---- #423: the agent chats' live turn in the interface language -------------------------------------
// The Product Owner's drawer (aside "Product Owner", the same name in both catalogs) shows the live turn
// (packages/ui-kit/live-turn.js) while a simulated turn runs (Given the app is open with slow simulated
// turns: thinking, then Read / Grep / gh steps of about 2.5 s each). Contract for these steps:
// data-testid="live-turn" on the live turn's root, "live-turn-label" on its activity line,
// "live-turn-steps" on the step count toggle, "live-turn-stop" on its Stop button. The expected texts
// are every live_turn.* entry of the language's catalog ({placeholders} match any text; the step count's
// plural forms both count); in a language other than English none of English's may show.

const TURN_TIMEOUT = 60000;
const liveTurn = (page) => page.getByRole('complementary', { name: 'Product Owner', exact: true }).getByTestId('live-turn').filter({ visible: true }).first();

// the live_turn.* texts of a language as patterns: "Lendo {what}" → /^Lendo .+$/
function liveTurnPatterns(language, keyFilter = () => true) {
  const code = LANGUAGE_FILES[language];
  if (!code) throw new Error(`no catalog for the language "${language}" (known: ${Object.keys(LANGUAGE_FILES).join(', ')})`);
  const texts = [];
  for (const [key, value] of Object.entries(catalog(code))) {
    if (!key.startsWith('live_turn.') || !keyFilter(key)) continue;
    texts.push(...(typeof value === 'string' ? [value] : Object.values(value)));
  }
  return texts.map((s) => new RegExp(`^${s.split(/\{[^}]+\}/).map(escapeRe).join('.+')}$`));
}
const matchesAny = (text, patterns) => patterns.some((re) => re.test(text.replace(/\s+/g, ' ').trim()));

async function expectLiveTurnText(page, testid, language, keyFilter, what) {
  const turn = liveTurn(page);
  await expect(turn, 'the Product Owner\'s live turn').toBeVisible({ timeout: TURN_TIMEOUT });
  const el = turn.getByTestId(testid).first();
  await expect(el, `the live turn's ${what}`).toBeVisible({ timeout: TURN_TIMEOUT });
  const own = liveTurnPatterns(language, keyFilter);
  const english = language === 'English' ? [] : liveTurnPatterns('English', keyFilter);
  await expect.poll(async () => {
    const text = (await el.innerText()).trim();
    return matchesAny(text, own) && !(english.length && matchesAny(text, english)) ? 'ok' : text;
  }, { message: `the live turn's ${what} in ${language}`, timeout: LOAD_TIMEOUT }).toBe('ok');
}

Then('the Product Owner\'s live turn shows its activity line in {string}', async ({ e2e }, language) => {
  await expectLiveTurnText(e2e.window, 'live-turn-label', language, (k) => k !== 'live_turn.steps_count', 'activity line');
});

Then('the Product Owner\'s live turn shows its step count in {string}', async ({ e2e }, language) => {
  await expectLiveTurnText(e2e.window, 'live-turn-steps', language, (k) => k === 'live_turn.steps_count', 'step count');
});

Then('the Product Owner\'s live turn offers its Stop button in {string}', async ({ e2e }, language) => {
  const stop = liveTurn(e2e.window).getByTestId('live-turn-stop');
  await expect(stop, 'the live turn\'s Stop button').toBeVisible({ timeout: TURN_TIMEOUT });
  await expect(stop).toHaveRole('button');
  const code = LANGUAGE_FILES[language];
  if (!code) throw new Error(`no catalog for the language "${language}"`);
  await expect(stop).toHaveAccessibleName(catalog(code)['live_turn.stop']);
  if (language !== 'English') await expect(stop).not.toHaveAccessibleName('Stop');
});

// ---- #444: the app and the browser under test in English ------------------------------------------
// The browser's language is navigator.language (Electron's --lang / the window's locale); the page's
// language is the html lang attribute the renderer sets to the interface language it resolved
// (the catalog's code: "en", "pt-BR").
Then('the browser\'s language is {string}', async ({ e2e }, locale) => {
  await expect.poll(() => e2e.window.evaluate(() => navigator.language), { message: 'navigator.language', timeout: LOAD_TIMEOUT }).toBe(locale);
});

Then('the page is shown in {string}', async ({ e2e }, language) => {
  const code = LANGUAGE_FILES[language];
  if (!code) throw new Error(`no catalog for the language "${language}" (known: ${Object.keys(LANGUAGE_FILES).join(', ')})`);
  await expect(e2e.window.locator('html')).toHaveAttribute('lang', code, { timeout: LOAD_TIMEOUT });
});

Then('Settings offers the {string} tab', async ({ e2e }, name) => {
  await expect(settingsTab(e2e.window, name)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('Settings no longer offers the {string} tab', async ({ e2e }, name) => {
  await expect(e2e.window.getByTestId('settings-tabs').filter({ visible: true })).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(settingsTab(e2e.window, name)).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});

// ---- #28: the screens of the first issue in the interface language --------------------------------
// Steps of features/28-ptbr-first-issue-screens.feature. Three parts of the window are read:
// - the open screen: the visible content of the <main> landmark (every view is kept in the DOM, the
//   hidden ones are skipped);
// - the Product Owner's drawer: the aside "Product Owner" (same name in both catalogs), its text box
//   data-testid="agent-chat-input";
// - the Start panel: the drawer (an aside, role complementary once open) holding the Start button
//   data-testid="start-workflow".
// "shows none of these English texts:" follows features/support/english-texts.js's rule (a text of 12
// characters or fewer counts only as the whole text of an element, an option or an attribute, so "now" never
// matches inside a Portuguese word; a longer one counts anywhere), on visible elements only: their own
// text, title, aria-label and placeholder, and the options of a visible select (a closed one's too).
// Column titles drawn in capitals by CSS ("TRIAGE") are read as written ("Triage").
// Reuses app.steps.js ("I open {string} in the sidebar"), settings-language.steps.js ("I choose {string}
// as the {string} language"), fronts/plan/features/steps/inbox.steps.js ("I capture the idea {string}
// with the text {string}", "I open the Inbox card {string}", "I accept the opened card"),
// fronts/build/features/steps/backlog.steps.js ("I open the Product Owner", "I click the suggested
// question {string}"), fronts/build/features/steps/run.steps.js ("I choose the workflow {string} in the
// Start panel").

const SHORT_TEXT = 12;
const openScreen = (page) => page.getByRole('main').filter({ visible: true }).first();
const poDrawerPart = (page) => page.getByRole('complementary', { name: 'Product Owner', exact: true });
const startPanelPart = (page) => page.getByRole('complementary').filter({ has: page.getByTestId('start-workflow') }).first();

// what the owner reads in the part: { whole: texts of single elements / options / attributes, all: one string }
async function visibleTextsOf(locator) {
  return locator.evaluate((root) => {
    const shown = (n) => (typeof n.checkVisibility === 'function' ? n.checkVisibility() : !!n.offsetParent);
    const whole = new Set();
    const parts = [];
    for (const n of [root, ...root.querySelectorAll('*')]) {
      if (!shown(n)) continue;
      const own = [...n.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join('').trim();
      if (own) parts.push(own);
      const text = (n.textContent || '').trim();
      if (text) whole.add(text);
      for (const a of ['title', 'aria-label', 'placeholder']) {
        const v = n.getAttribute(a);
        if (v) { whole.add(v.trim()); parts.push(v.trim()); }
      }
      if (n.tagName === 'SELECT') {
        for (const o of n.options) { const v = (o.textContent || '').trim(); if (v) { whole.add(v); parts.push(v); } }
      }
    }
    return { whole: [...whole], all: parts.join(' \n ') };
  });
}

async function expectNoneOfTheseTexts(locator, table, what) {
  const texts = tableTexts(table);
  await expect(locator, what).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect.poll(async () => {
    const { whole, all } = await visibleTextsOf(locator);
    const set = new Set(whole);
    return texts.filter((t) => (t.length <= SHORT_TEXT ? set.has(t) : all.includes(t)));
  }, { message: `English texts left in ${what}`, timeout: LOAD_TIMEOUT }).toEqual([]);
}

Then('the open screen shows none of these English texts:', async ({ e2e }, table) => {
  await expectNoneOfTheseTexts(openScreen(e2e.window), table, 'the open screen');
});

Then('the Product Owner\'s drawer shows none of these English texts:', async ({ e2e }, table) => {
  await expectNoneOfTheseTexts(poDrawerPart(e2e.window), table, 'the Product Owner\'s drawer');
});

Then('the Start panel shows none of these English texts:', async ({ e2e }, table) => {
  await expectNoneOfTheseTexts(startPanelPart(e2e.window), table, 'the Start panel');
});

// the open screen's title: its visible level-1 heading
Then('the open screen\'s title is {string}', async ({ e2e }, title) => {
  const heading = openScreen(e2e.window).getByRole('heading', { level: 1 }).filter({ visible: true }).first();
  await expect(heading).toHaveText(title, { timeout: LOAD_TIMEOUT });
});

// an option of a visible select of the open screen, e.g. the Backlog's platform select "Bitbucket (em breve)"
Then('the open screen offers the option {string}', async ({ e2e }, option) => {
  const screen = openScreen(e2e.window);
  await expect(screen).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect.poll(() => screen.evaluate((root, text) => [...root.querySelectorAll('select')]
    .filter((s) => (typeof s.checkVisibility === 'function' ? s.checkVisibility() : !!s.offsetParent))
    .some((s) => [...s.options].some((o) => (o.textContent || '').trim() === text)), option),
  { message: `a select of the open screen offers "${option}"`, timeout: LOAD_TIMEOUT }).toBe(true);
});

// the hint the shared paste helper (packages/ui-kit/paste-image.js) adds to the text box's placeholder
Then('the Product Owner\'s text box hints {string}', async ({ e2e }, hint) => {
  const box = poDrawerPart(e2e.window).getByTestId('agent-chat-input');
  await expect(box).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(box).toHaveAttribute('placeholder', new RegExp(escapeRe(hint)), { timeout: LOAD_TIMEOUT });
});

// Projects › the demo project's card › its Start button, named in the interface language
// ("Iniciar workflow" in Portuguese); the Start panel opens
When('I click {string} on the demo project\'s card', async ({ e2e }, label) => {
  const card = demoProjectCard(e2e);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  await card.getByRole('button', { name: label, exact: true }).click();
  await expect(e2e.window.getByTestId('start-workflow')).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// a select of the Start panel named by its label, e.g. the chain picker's "Quando terminar"
Then('the Start panel shows the {string} list', async ({ e2e }, name) => {
  await expect(startPanelPart(e2e.window).getByRole('combobox', { name, exact: true })).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// ---- #36: the Roadmap card and the Assign dialog in the interface language ------------------------
// Steps of features/36-ptbr-roadmap-card-assign-dialog.feature. Two more parts of the window are read,
// with the same "shows none of these English texts:" rule as #28 above:
// - a Roadmap card: data-testid="roadmap-item" holding the item's title (exists); its meters
//   data-testid="roadmap-meter-cost" / "roadmap-meter-time" (exist; their labels "Cost" / "Time" are drawn
//   in capitals by CSS, "COST" / "TIME", and read as written), its mode chips data-testid="roadmap-mode"
//   (exists), its stations data-testid="roadmap-station" (exist; the visible name, not data-step, counts);
// - the Assign dialog: data-testid="assign-modal" (exists), its workflow inputs' labels and options.
// "shows these texts:" is the positive side: each text is the whole text of a visible element of the part
// (or its own text, without its children's), a title / aria-label / placeholder, or an option of a select.
// "I open the Assign dialog for the backlog issue {string}" goes through the Backlog's Board in whichever
// language is shown: the language is the page's (the html lang attribute, #444) and each English label
// (the Board tab, the "Board view" group's List button, a row's "Select #n" checkbox, the selection bar's
// "Assign workflow…" button) is read from that language's catalog, as the #330 steps do.
// Reuses fronts/build/features/steps/roadmap-ending-and-skip.steps.js ("the roadmap plans the item
// {string} on the workflow {string} in {string} mode"), backlog.steps.js ("I open the Roadmap"),
// backlog-archive.steps.js ("the backlog has the open issues {string} and {string}") and
// backlog-plan-roadmap.steps.js ("the Assign dialog has the {string} workflow chosen").

const roadmapCardPart = (page, title) => page.getByTestId('roadmap-item').filter({ hasText: title }).filter({ visible: true }).first();
const assignDialogPart = (page) => page.getByTestId('assign-modal');

async function expectTheseTexts(locator, table, what) {
  const texts = tableTexts(table);
  await expect(locator, what).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect.poll(async () => {
    const { whole, all } = await visibleTextsOf(locator);
    const set = new Set(whole);
    const own = new Set(all.split(' \n ').map((s) => s.trim()));
    return texts.filter((t) => !set.has(t) && !own.has(t));
  }, { message: `texts missing from ${what}`, timeout: LOAD_TIMEOUT }).toEqual([]);
}

Then('the roadmap card {string} shows these texts:', async ({ e2e }, title, table) => {
  await expectTheseTexts(roadmapCardPart(e2e.window, title), table, `the roadmap card "${title}"`);
});

Then('the roadmap card {string} shows none of these English texts:', async ({ e2e }, title, table) => {
  await expectNoneOfTheseTexts(roadmapCardPart(e2e.window, title), table, `the roadmap card "${title}"`);
});

Then('the Assign dialog shows these texts:', async ({ e2e }, table) => {
  await expectTheseTexts(assignDialogPart(e2e.window), table, 'the Assign dialog');
});

Then('the Assign dialog shows none of these English texts:', async ({ e2e }, table) => {
  await expectNoneOfTheseTexts(assignDialogPart(e2e.window), table, 'the Assign dialog');
});

// the language the page is shown in, by its html lang attribute ("en", "pt-BR")
const LANGUAGE_NAMES = Object.fromEntries(Object.entries(LANGUAGE_FILES).map(([name, code]) => [code, name]));
async function shownLanguage(page) {
  const code = await page.locator('html').getAttribute('lang', { timeout: LOAD_TIMEOUT });
  const name = LANGUAGE_NAMES[code];
  if (!name) throw new Error(`the page's language "${code}" has no catalog (known: ${Object.keys(LANGUAGE_NAMES).join(', ')})`);
  return name;
}
// an English label as it reads in the shown language, as a pattern: "Select #{number}" → /^Selecionar #.+$/;
// `prefix` lets a count follow ("Atribuir workflow… (1)")
async function shownLabel(page, english, { prefix = false } = {}) {
  const texts = translations(english, await shownLanguage(page));
  return new RegExp(`^(${texts.map((s) => s.split(/\{[^}]+\}/).map(escapeRe).join('.+')).join('|')})${prefix ? '' : '$'}`);
}

When('I open the Assign dialog for the backlog issue {string}', async ({ e2e }, title) => {
  const page = e2e.window;
  await page.getByRole('tab', { name: await shownLabel(page, 'Board') }).filter({ visible: true }).first().click();
  await page.getByRole('group', { name: await shownLabel(page, 'Board view') }).filter({ visible: true }).first()
    .getByRole('button', { name: await shownLabel(page, 'List') }).click();
  const list = page.getByTestId('backlog-list');
  await expect(list).toBeVisible({ timeout: LOAD_TIMEOUT });
  await list.getByTestId('backlog-issue').filter({ hasText: title }).first()
    .getByRole('checkbox', { name: await shownLabel(page, 'Select #{number}') }).check();
  await page.getByRole('button', { name: await shownLabel(page, 'Assign workflow…', { prefix: true }) }).filter({ visible: true }).first().click();
  await expect(assignDialogPart(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// ---- #70: from a first idea to a real run in the interface language --------------------------------
// Steps of features/70-ptbr-first-run-path.feature, with the same "shows none of these English texts:" rule
// as #28 above on three more parts, all existing: the Descoberta card's panel (data-testid=
// "discovery-card-detail"), the commit dialog ("discovery-commit-dialog") and the app's confirm dialog
// ("confirm-modal"). The card, its interview and the commit dialog are opened by
// fronts/plan/features/steps/discovery.steps.js. Resume goes through the roadmap bar as
// fronts/build/features/steps/backlog.steps.js does, each label (Simulated, Resume, Start anyway) read
// from the shown language's catalog.

const discoveryCardPart = (page) => page.getByTestId('discovery-card-detail');
const commitDialogPart = (page) => page.getByTestId('discovery-commit-dialog');
const confirmDialogPart = (page) => page.getByTestId('confirm-modal');

Then('the card\'s panel shows none of these English texts:', async ({ e2e }, table) => {
  await expectNoneOfTheseTexts(discoveryCardPart(e2e.window), table, 'the Descoberta card\'s panel');
});

Then('the commit dialog shows none of these English texts:', async ({ e2e }, table) => {
  await expectNoneOfTheseTexts(commitDialogPart(e2e.window), table, 'the commit dialog');
});

Then('the confirm dialog shows none of these English texts:', async ({ e2e }, table) => {
  await expectNoneOfTheseTexts(confirmDialogPart(e2e.window), table, 'the confirm dialog');
});

// the push choice (#195) comes first on the demo roadmap: "Start anyway" goes on to the confirm
When('I press Resume on the roadmap with Simulated off, in the interface language', async ({ e2e }) => {
  const page = e2e.window;
  const bar = page.getByTestId('roadmap-bar');
  const menu = page.getByTestId('roadmap-menu');
  if (!await menu.isVisible()) await bar.getByTestId('roadmap-menu-button').click();
  const simulated = menu.getByRole('menuitemcheckbox', { name: await shownLabel(page, 'Simulated') });
  if ((await simulated.getAttribute('aria-checked')) !== 'false') await simulated.click();
  await expect(simulated).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await bar.getByRole('button', { name: await shownLabel(page, 'Resume') }).click();
  const dialog = confirmDialogPart(page);
  await expect(dialog).toBeVisible({ timeout: LOAD_TIMEOUT });
  const anyway = dialog.getByRole('button', { name: await shownLabel(page, 'Start anyway') });
  if (await anyway.isVisible()) await anyway.click();
});

// the wording is the catalog's: the question names the cost ("dinheiro", "custam", "gastam"…)
Then('the confirm dialog warns that real runs spend money, in Portuguese', async ({ e2e }) => {
  const dialog = confirmDialogPart(e2e.window);
  await expect(dialog).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(dialog).toContainText(/dinheiro|cust[ao]|gast[ao]/i, { timeout: LOAD_TIMEOUT });
});

Then('the confirm dialog offers {string} and {string}', async ({ e2e }, yes, no) => {
  const dialog = confirmDialogPart(e2e.window);
  for (const name of [yes, no]) await expect(dialog.getByRole('button', { name, exact: true })).toBeVisible({ timeout: LOAD_TIMEOUT });
});

// ---- #83: the refactor workflow and the sidebar's waiting run in the interface language ---------------
// Steps of features/83-ptbr-refactor-workflow-and-sidebar-gate.feature. The Start panel's part and its
// "shows none of these English texts:" are #28's above. The sidebar's runs in progress are
// data-testid="sidebar-footer" (exists), one button per run, data-gate="1" when it waits at a gate
// (exists); the row's visible line reads "<Waiting for you> · <step>" in the interface language (the
// title attribute counts too, with the same rule).

const waitingRunRow = (page) => {
  const footer = page.getByTestId('sidebar-footer');
  return footer.getByRole('button').and(footer.locator('[data-gate="1"]')).first();
};

Then('the run waiting at a gate in the sidebar reads {string} and the step it waits at', async ({ e2e }, words) => {
  const row = waitingRunRow(e2e.window);
  await expect(row).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(row).toContainText(new RegExp(`${escapeRe(words)}\\s*·\\s*\\S`), { timeout: LOAD_TIMEOUT });
});

Then('the run waiting at a gate in the sidebar shows none of these English texts:', async ({ e2e }, table) => {
  await expectNoneOfTheseTexts(waitingRunRow(e2e.window), table, 'the sidebar\'s run waiting at a gate');
});

// ---- #41: a new user's path in the interface language ----------------------------------------------
// Steps of features/41-ptbr-new-user-path.feature, with the same "shows none of these English texts:"
// rule as #28 above. The Product Owner's simulated draft (an issue request of eight words or more) shows
// the select of the filed issue's workflow (aria-label backlog_po.workflow_of_the_filed_issue, read from
// the shown language's catalog); its options name the project's default workflow without the English
// " (default)" mark. Reuses fronts/build/features/steps/backlog.steps.js ("I open the Product Owner",
// "I click the suggested question {string}", "I ask the Product Owner {string}"),
// backlog-po-recommendations.steps.js ("I close the Product Owner"), fronts/plan's discovery.steps.js
// (the cards, the interview), roadmap.steps.js ("I press {string} in the confirm dialog"),
// roadmap-stack-on-waiting-stage.steps.js (the waiting stage) and run.steps.js / run-environment.steps.js
// (the simulated run up to its gate, back to it from the sidebar).

Then('the Product Owner\'s drawer shows a draft of the issue, in the interface language', async ({ e2e }) => {
  const page = e2e.window;
  const select = poDrawerPart(page).getByRole('combobox', { name: await shownLabel(page, 'Workflow of the filed issue') }).filter({ visible: true }).last();
  await expect(select, 'the simulated draft\'s workflow select').toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('no workflow in the Product Owner\'s drawer is marked {string}', async ({ e2e }, mark) => {
  const drawer = poDrawerPart(e2e.window);
  await expect(drawer).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect.poll(() => drawer.evaluate((root, text) => [...root.querySelectorAll('select option')]
    .map((o) => (o.textContent || '').trim()).filter((s) => s.includes(text)), mark),
  { message: `workflow options marked "${mark}" in the Product Owner's drawer`, timeout: LOAD_TIMEOUT }).toEqual([]);
});
