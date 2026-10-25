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
const { Then } = require('./fixtures');

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
// (src/renderer/live-turn.js) while a simulated turn runs (Given the app is open with slow simulated
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
