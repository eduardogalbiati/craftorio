// #28 acceptance, written before the code: the Discovery board (fronts/plan/views/discovery/discovery.js)
// and the Inbox (fronts/plan/views/inbox/inbox.js) in pt-BR, as a first issue's owner sees them.
// The board is loaded through ./discovery-board-harness.js (the whole page in a vm, window.api faked), then
// the page's own I18n is switched to pt-BR and the board shown again.
//
// The contract assumed here:
// - the tag / author filters' first option goes through t(): discovery.all_tags ("Todas as tags") and
//   discovery.all_authors ("Todos os autores"), both already in pt-BR.json;
// - a card's kind badge (discovery-card-type) shows a translated label, never the raw id ("idea");
// - the automation mode "Ask me" and the relative age "now" go through t() (checked in the source: the
//   board's fixed clock and its column automations are not seeded by the harness);
// - the Inbox's kind badge shows a translated label, never `${esc(c.type)}` raw.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { card, openBoard, settle } = require('./discovery-board-harness');

const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);

async function boardInPortuguese(cards) {
  const page = await openBoard({ cards });
  page.run("I18n.setLanguage('pt-BR'); if (typeof I18n.notify === 'function') I18n.notify(); showView('discovery')");
  await settle(20);
  return page;
}

const firstOptionText = (page, testid) => {
  const sel = page.$(`[data-testid="${testid}"]`);
  const opt = sel && sel.querySelector('option');
  return opt ? page.text(opt) : null;
};

test('#28 pt-BR Discovery: the tag filter\'s first option is "Todas as tags", not "All tags"', async () => {
  const page = await boardInPortuguese([card({ title: 'Uma ideia', tags: ['ux'] })]);
  assert.equal(firstOptionText(page, 'discovery-filter-tag'), 'Todas as tags');
});

test('#28 pt-BR Discovery: the author filter\'s first option is "Todos os autores", not "All authors"', async () => {
  const page = await boardInPortuguese([card({ title: 'Uma ideia', author: 'owner' })]);
  assert.equal(firstOptionText(page, 'discovery-filter-author'), 'Todos os autores');
});

test('#28 pt-BR Discovery: an idea card\'s kind badge is translated, not the raw id "idea"', async () => {
  const c = card({ title: 'Uma ideia', type: 'idea' });
  const page = await boardInPortuguese([c]);
  const badge = page.cardEl(c.id)?.querySelector('[data-testid="discovery-card-type"]');
  const shown = badge ? page.text(badge) : null;
  assert.notEqual(shown, null, 'the card shows a [data-testid="discovery-card-type"] badge');
  assert.notEqual(shown.toLowerCase(), 'idea');
  assert.equal(shown.length > 0, true);
});

test('#28 discovery.js: the automation mode "Ask me" is not a hard-coded label', () => {
  const src = fs.readFileSync(pageFileOf('views/discovery/discovery.js'), 'utf8');
  assert.equal(/ask:\s*'Ask me'/.test(src), false);
});

test('#28 discovery.js: the relative age "now" is not a hard-coded return value', () => {
  const src = fs.readFileSync(pageFileOf('views/discovery/discovery.js'), 'utf8');
  assert.equal(/return\s+'now'/.test(src), false);
});

test('#28 inbox.js: the kind badge does not show the raw type id', () => {
  const src = fs.readFileSync(pageFileOf('views/inbox/inbox.js'), 'utf8');
  assert.equal(/<span class="badge">\$\{esc\(c\.type\)\}<\/span>/.test(src), false);
});

// ---- #41: the first issue's screens in pt-BR (the move dialogs, the clarity refusal, the forecast, the commit hint) ----

const { boardApi } = require('./discovery-board-harness');
const I18n = require('@craftorio/shared/i18n');
const tid = (id) => `[data-testid="${id}"]`;
const REFUSAL = 'Below the clarity bar: its clarity is 0%, the bar is 85%. Close its gaps (Grill me), or move it anyway with a reason.';
const CLARITY = { bar: 85, byKind: {}, night: { start: '23:00', end: '08:00' } };

// the board in `lang` (the page's own I18n switched, the board shown again); `api` overrides the fake store's methods
async function boardIn(lang, cards, api = {}) {
  const page = await openBoard({ cards, api });
  page.run(`I18n.setLanguage('${lang}'); if (typeof I18n.notify === 'function') I18n.notify(); showView('discovery')`);
  await settle(20);
  return page;
}
// "Move to…" on a card, then the menu item of column `id` (its title is the language's)
async function moveToColumn(page, cardId, id) {
  page.cardEl(cardId).querySelector(tid('card-move')).click();
  await settle();
  const items = page.all(`[role="menuitem"][data-move-to="${id}"]`).filter((el) => page.visible(el));
  assert.ok(items.length, `a visible menu item for ${id}`);
  items.at(-1).click();
  await settle(20);
}
async function refused(lang) {
  const c = card({ title: 'Exportar as notas', column: 'define', clarity: 0 });
  const page = await boardIn(lang, [c], { moveDiscoveryCard: async () => { throw new Error(REFUSAL); } });
  await moveToColumn(page, c.id, 'ready');
  const box = page.$(tid('clarity-refused'));
  assert.ok(box, 'the board says why the card stayed');
  return { text: page.text(box), grill: page.text(page.cardEl(c.id).querySelector(tid('grill-me'))) };
}

test.afterEach(() => I18n.setLanguage('en'));

test('#41 pt-BR Discovery: a card that skips Shape asks without "This card skips Shape: only bugs and hotfixes take the fast lane."', async () => {
  const c = card({ title: 'Rápido demais', type: 'idea', column: 'triage' });
  const page = await boardIn('pt-BR', [c]);
  await moveToColumn(page, c.id, 'define');
  assert.equal(page.confirmOpen(), true, 'the confirm dialog is open');
  const message = page.text(page.$('#confirm-message'));
  assert.doesNotMatch(message, /skips Shape|only bugs and hotfixes|fast lane/);
  page.$('#btn-confirm-no').click();
  await settle(20);
});

test('#41 English unchanged: a move refused below the clarity bar reads "stays in Define. Below the clarity bar: …" with "Grill me"', async () => {
  const { text, grill } = await refused('en');
  assert.match(text, /"Exportar as notas" stays in Define\. Below the clarity bar: its clarity is 0%, the bar is 85%\. Close its gaps \(Grill me\), or move it anyway with a reason\./);
  assert.equal(grill, 'Grill me');
});

test('#41 pt-BR Discovery: a move refused below the clarity bar and its "Grill me" button are not in English, with 0% and 85%', async () => {
  const { text, grill } = await refused('pt-BR');
  assert.doesNotMatch(text, /stays in|Below the clarity bar|its clarity is|the bar is|Close its gaps|Grill me|move it anyway/);
  assert.match(text, /0%/);
  assert.match(text, /85%/);
  assert.notEqual(grill, 'Grill me');
});

test('#41 pt-BR Discovery: the ready forecast\'s "(an estimate from the cards in Ready …)" names the column Pronto, not Ready', async () => {
  const cards = [card({ title: 'Uma ideia' })];
  const { methods } = boardApi({ cards });
  const page = await boardIn('pt-BR', cards, { discoveryBoard: async () => ({ ...(await methods.discoveryBoard()), clarity: CLARITY, forecast: { count: 0, hours: 0, nights: 0, nightHours: 9 } }) });
  const el = page.$(tid('ready-forecast'));
  assert.ok(el, 'the board shows its ready forecast');
  const shown = `${page.text(el)} ${el.getAttribute('title') || ''}`;
  assert.doesNotMatch(shown, /\bReady\b|an estimate from the cards/);
});

test('#41 pt-BR Discovery: a Ready card under the bar does not say "A card is committed from …% clarity" nor "Grill me"', async () => {
  const c = card({ title: 'Exportar as notas', column: 'ready', clarity: 0 });
  const page = await boardIn('pt-BR', [c]);
  const detail = await page.openCard(c.id);
  const hint = detail.querySelector(tid('discovery-commit-hint'));
  assert.ok(hint, 'the panel has its commit hint');
  assert.doesNotMatch(page.text(hint), /A card is committed from|Grill me/);
});
