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
