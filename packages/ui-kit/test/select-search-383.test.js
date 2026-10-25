// #383: a select with more than 10 options gets a search box; typing filters the options by a
// trimmed, case- and accent-insensitive substring of their label.
// Seam: packages/ui-kit/select-search.js, UMD like status-pill.js (window.SelectSearch /
// module.exports): { needsSearch(optionCount), matchOption(label, query) }.
// The module is created by the change: it is loaded inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../select-search.js');

test('#383 a search box only above 10 options', () => {
  const { needsSearch } = load();
  assert.equal(needsSearch(0), false);
  assert.equal(needsSearch(10), false);
  assert.equal(needsSearch(11), true);
});

test('#383 an empty or blank query matches every label', () => {
  const { matchOption } = load();
  assert.equal(matchOption('Asia/Tokyo', ''), true);
  assert.equal(matchOption('Asia/Tokyo', '   '), true);
});

test('#383 the match is case-insensitive', () => {
  const { matchOption } = load();
  assert.equal(matchOption('Asia/Tokyo', 'tokyo'), true);
  assert.equal(matchOption('asia/tokyo', 'TOKYO'), true);
});

test('#383 the match is accent-insensitive both ways', () => {
  const { matchOption } = load();
  assert.equal(matchOption('America/São_Paulo', 'sao'), true);
  assert.equal(matchOption('Sao Paulo', 'são'), true);
});

test('#383 the query matches a substring anywhere in the label', () => {
  const { matchOption } = load();
  assert.equal(matchOption('America/Sao_Paulo', 'paul'), true);
  assert.equal(matchOption('America/Sao_Paulo', 'rica/s'), true);
});

test('#383 a query not in the label does not match', () => {
  const { matchOption } = load();
  assert.equal(matchOption('Asia/Tokyo', 'paris'), false);
});

test('#383 the query is trimmed', () => {
  const { matchOption } = load();
  assert.equal(matchOption('Asia/Tokyo', '  tokyo  '), true);
});
