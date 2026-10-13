// #371: the project city is documented. The doc that covers the Architecture tab's facts (the
// docs/features/*.md that names #356) gets the city model, and the owner's decisions record #371
// (the project city on the roadmap, built from the POC; groma.md not used).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

function factsDoc() {
  const dir = path.join(root, 'docs', 'features');
  const name = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().find((f) => read('docs', 'features', f).includes('356'));
  return name ? { name, text: read('docs', 'features', name) } : null;
}

test('#371 the Architecture facts doc describes the city model', () => {
  const doc = factsDoc();
  assert.ok(doc, 'some docs/features/*.md mentions 356');
  assert.equal(doc.text.includes('#371'), true, `${doc.name} names #371`);
  assert.equal(/city plan/i.test(doc.text), true, `${doc.name} mentions the city plan`);
  assert.equal(/district/i.test(doc.text), true, `${doc.name} mentions districts`);
});

test('#371 the owner\'s decisions record the project city and that groma.md is not used', () => {
  const text = read('docs', 'agents', 'decisions.md');
  assert.equal(text.includes('#371'), true, 'decisions.md names #371');
  assert.equal(/groma/i.test(text), true, 'decisions.md mentions groma.md');
});
