// #70 acceptance, written before the code: the clarity rubric and Grill me (packages/engine/domains/
// discovery/clarity.js, discovery.js) with the interface in pt-BR. What the screen shows (the questions,
// the gaps, "Clarity rubric") is asserted where it is drawn, whichever side translates it:
// fronts/plan/test/discovery-commit-ptbr-70.test.js. Here, what must not change with the language: the
// score, the English texts, and the document, which stays in the language the person answers in.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');
const { layout } = require('../../domains/workspace/workspace');
const discovery = require('../../domains/discovery/discovery');
const clarity = require('../../domains/discovery/clarity');

const P = 'p1';
test.afterEach(() => I18n.setLanguage('en'));

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clarity-70-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return layout(root).discovery;
}
function answered(t, { language, text }) {
  const dir = tmp(t);
  I18n.setLanguage(language);
  const card = discovery.createCard(dir, P, { title: 'Exportar execuções' });
  discovery.grillCard(dir, P, card.id);
  return { dir, id: card.id, ...discovery.answerGrill(dir, P, card.id, { text }) };
}

test('#70 pt-BR: an answer in Portuguese is written as given and its point is not asked again', (t) => {
  const text = 'A tabela de execuções não pode ser exportada.\n\nQuem sente: o dono.';
  const { card, question } = answered(t, { language: 'pt-BR', text });
  assert.equal(card.document.includes(text), true, card.document);
  assert.equal(card.clarity.score, 20); // the problem: 3 of the 15 points of an idea
  assert.equal(card.clarity.gaps.length, 8);
  assert.equal(question.grill, 'goal');
});

test('#70 pt-BR: a card grilled to the end is covered in both languages', (t) => {
  const dir = tmp(t);
  I18n.setLanguage('pt-BR');
  let { id } = discovery.createCard(dir, P, { title: 'Exportar execuções' });
  discovery.setClarityBar(dir, P, { bar: 100 });
  let { question } = discovery.grillCard(dir, P, id);
  for (let n = 0; question && n < 20; n++) ({ question } = discovery.answerGrill(dir, P, id, { text: `Resposta número ${n} do dono.` }));
  const { type, document, acceptance, clarity: kept } = discovery.readCard(dir, P, id);
  assert.equal(kept.score, 100);
  for (const language of ['en', 'pt-BR']) {
    I18n.setLanguage(language);
    assert.equal(clarity.scoreClarity({ type, document, acceptance }).score, 100, language);
  }
});

test('#70 the same card has the same score and the same open points in both languages', () => {
  const card = { type: 'prd', document: '## Problem\n\nNothing exports.\n\n## Goal\n\nA CSV.\n', acceptance: '' };
  const of = (language) => {
    I18n.setLanguage(language);
    const { score, gaps } = clarity.scoreClarity(card);
    return { score, gaps: gaps.length, next: clarity.nextQuestion(card).criterion };
  };
  assert.deepEqual(of('pt-BR'), of('en'));
  assert.deepEqual(of('en').next, 'users');
});

test('#70 a card scored in English lists its gaps in Portuguese once the interface is, and back', (t) => {
  const dir = tmp(t);
  const { id } = discovery.createCard(dir, P, { title: 'Export runs' });
  discovery.grillCard(dir, P, id);
  discovery.answerGrill(dir, P, id, { text: 'Nothing exports.' }); // the score and its gaps are saved, in English
  const gaps = () => Array.from(discovery.readCard(dir, P, id).clarity.gaps);
  const english = gaps();
  assert.equal(english[0], 'Goal: what is true when this is done');
  I18n.setLanguage('pt-BR');
  const portuguese = gaps();
  assert.equal(portuguese.length, english.length);
  assert.deepEqual(portuguese.filter((g) => english.includes(g)), []);
  I18n.setLanguage('en');
  assert.deepEqual(gaps(), english);
});

// the interview's last note, when the first answer (20%) reaches a bar of 20%
function lastNote(t, language) {
  const dir = tmp(t);
  I18n.setLanguage(language);
  const { id } = discovery.createCard(dir, P, { title: 'Exportar execuções' });
  discovery.setClarityBar(dir, P, { bar: 20 });
  discovery.grillCard(dir, P, id);
  assert.equal(discovery.answerGrill(dir, P, id, { text: 'Nada exporta.' }).question, null);
  return discovery.readConversation(dir, P, id).at(-1).text;
}

test('#70 the note that ends the interview reads in the interface language, with the score and the bar', (t) => {
  assert.equal(lastNote(t, 'en'), 'Clarity 20%: at or above the bar of 20%. The interview ends here; the card can move to Ready.');
  const text = lastNote(t, 'pt-BR');
  assert.equal(/Clarity|at or above|interview|the card can|Ready/.test(text), false, text);
  assert.equal(text.split('20%').length - 1, 2, text);
});

test('#70 English unchanged: the first question, a gap and who scored the card', (t) => {
  const dir = tmp(t);
  const card = discovery.createCard(dir, P, { title: 'Export runs' });
  assert.equal(discovery.grillCard(dir, P, card.id).question.text, 'Problem: What is wrong or missing today, and who feels it?');
  assert.equal(card.clarity.by, 'Clarity rubric');
  assert.equal(card.clarity.gaps[0], 'Problem: what is wrong or missing today, and for whom');
  assert.equal(card.clarity.gaps.includes('Acceptance criteria: nothing verifiable says when it is done'), true);
});
