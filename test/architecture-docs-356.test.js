// #356: the Architecture tab is documented. A feature doc in docs/features/ names the issue and the
// limits of the numbers (among them migrations and fix commits), the Oracle's skill knows how to write
// an architecture report, and the owner's decisions record #356.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

// the doc of the tab itself: other docs may cite #356 (analyze-project.md cites its report, #631)
function featureDoc() {
  const dir = path.join(root, 'docs', 'features');
  const docs = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().filter((f) => read('docs', 'features', f).includes('356'));
  const name = docs.find((f) => /^#+ .*Architecture tab/m.test(read('docs', 'features', f))) || docs[0];
  return name ? { name, text: read('docs', 'features', name) } : null;
}

test('#356 a feature doc in docs/features/ names the issue and the Architecture tab', () => {
  const doc = featureDoc();
  assert.ok(doc, 'some docs/features/*.md mentions 356');
  assert.equal(/Architecture/.test(doc.text), true, `${doc.name} mentions Architecture`);
});

test('#356 the feature doc lists what the numbers cannot tell (migrations, fix commits)', () => {
  const doc = featureDoc();
  assert.ok(doc, 'some docs/features/*.md mentions 356');
  assert.equal(/migration/i.test(doc.text), true, `${doc.name} mentions migrations`);
  assert.equal(/fix commits/i.test(doc.text), true, `${doc.name} mentions fix commits`);
});

test('#356 the Oracle skill explains the architecture report', () => {
  assert.equal(/architecture report/i.test(read('skills', 'oracle', 'SKILL.md')), true, 'skills/oracle/SKILL.md mentions the architecture report');
});

test('#356 the owner\'s decisions record #356', () => {
  assert.equal(read('docs', 'agents', 'decisions.md').includes('#356'), true);
});
