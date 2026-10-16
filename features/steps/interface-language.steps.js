// Steps of features/interface-language.feature (#330, every screen translated; see its section
// below) and of features/settings.feature's interface language scenarios (#329): Settings › General's
// "Language" group (data-testid="settings-language", #327) gets an "Interface" select (aria-label
// "Interface") listing the languages with a catalog (English, Português (Brasil)); a change
// re-renders the open windows at once, without a restart. Choosing it and reading it reuse
// settings-language.steps.js ("I choose {string} as the {string} language", "the {string} language
// is {string}", "the {string} language list offers {string}"); the sidebar's entries reuse
// app.steps.js ("the sidebar offers {string}"). These steps read the sidebar and Settings' tabs
// (data-testid="settings-tabs") in whichever language is shown, so they never wait on an English
// entry such as "Home". Locators are roles and data-testid only (skills/ui-conventions).

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
// expected text in the chosen language is read from the catalogs (src/shared/i18n/<lang>.json):
// every key whose English value is the label gives its value in that language. So the steps never
// depend on key names or on wording the developer picks. A label with no catalog entry fails with a
// clear message (the screen is not translated yet). Only visible elements count (views kept hidden
// in the DOM are ignored). A button or chip may carry a trailing count ("All 12").

const I18N_DIR = path.join(__dirname, '..', '..', 'src', 'shared', 'i18n');
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

Then('Settings offers the {string} tab', async ({ e2e }, name) => {
  await expect(settingsTab(e2e.window, name)).toBeVisible({ timeout: LOAD_TIMEOUT });
});

Then('Settings no longer offers the {string} tab', async ({ e2e }, name) => {
  await expect(e2e.window.getByTestId('settings-tabs').filter({ visible: true })).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(settingsTab(e2e.window, name)).toHaveCount(0, { timeout: LOAD_TIMEOUT });
});
