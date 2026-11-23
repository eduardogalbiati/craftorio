// #36 acceptance, written before the code: the Discovery board (fronts/plan/views/discovery/discovery.js) in pt-BR
// still named its columns in English in two texts, while the columns themselves read TRIAGEM / MODELAGEM / DEFINIÇÃO /
// PRONTO: the page's description ("… Triage → Shape → Define → Ready …") and the fast lane's note ("bugs e hotfixes ·
// podem pular Shape"). Harness of discovery-ptbr-28.test.js (./discovery-board-harness.js: the whole page in a vm,
// window.api faked, the page's own I18n switched to pt-BR and the board shown again). The description is checked in
// the text the page draws in its language (the view's markup, built through t()).
const test = require('node:test');
const assert = require('node:assert/strict');
const I18n = require('@craftorio/shared/i18n');
const { card, openBoard, settle } = require('./discovery-board-harness');

test.afterEach(() => I18n.setLanguage('en'));

async function boardInPortuguese(cards) {
  const page = await openBoard({ cards });
  page.run("I18n.setLanguage('pt-BR'); if (typeof I18n.notify === 'function') I18n.notify(); showView('discovery')");
  await settle(20);
  return page;
}

const laneNote = (page) => {
  const title = page.$('[data-testid="discovery-fast-lane"] .dsc-lane-title');
  return title ? page.text(title) : null;
};

test('#36 pt-BR Discovery: the fast lane\'s note does not name the Shape column in English', async () => {
  const page = await boardInPortuguese([card({ title: 'Uma ideia' })]);
  const note = laneNote(page);
  assert.ok(note, 'the fast lane has its title');
  assert.equal(/\bShape\b/.test(note), false, note);
});

test('#36 English unchanged: the fast lane\'s note says bugs and hotfixes may skip Shape', async () => {
  const page = await openBoard({ cards: [card({ title: 'An idea' })] });
  assert.match(laneNote(page), /Shape/);
});

// the page's description as the view draws it in pt-BR (its markup's first paragraph, from the catalog)
// (the page head is drawn once, when the page loads, so the harness's later language switch does not redraw it:
// the text checked is the catalog entry the view's markup draws, t('discovery.the_cards_accepted_in_the_inbox'))
test('#36 pt-BR Discovery: the page\'s description names the columns Triagem → Modelagem → Definição → Pronto', () => {
  const described = I18n.t('discovery.the_cards_accepted_in_the_inbox', {}, 'pt-BR');
  assert.equal(described.includes('Triage → Shape → Define → Ready'), false, described);
  assert.equal(described.includes('Triagem → Modelagem → Definição → Pronto'), true, described);
});
