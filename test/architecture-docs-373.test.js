// #373: the Projects screen's README fragment (docs/screens/projects.md) mentions the Architecture
// tab's City view next to its facts (the "Facts | City" switch).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = () => fs.readFileSync(path.join(__dirname, '..', 'docs', 'screens', 'projects.md'), 'utf8');

test('#373 the Projects screen doc mentions the Architecture tab\'s City view and its facts', () => {
  const text = read();
  assert.match(text, /Architecture/, 'names the Architecture tab');
  assert.match(text, /\bCity\b/, 'names the City view');
  assert.match(text, /\bFacts\b/, 'names the Facts view it sits next to');
});
