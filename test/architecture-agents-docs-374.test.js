// #374: the Projects screen's README fragment (docs/screens/projects.md) mentions the agents at work
// on the project city, "Replay on the map" for a finished run, and the collision risk of a building
// two runs in progress change.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = () => fs.readFileSync(path.join(__dirname, '..', 'docs', 'screens', 'projects.md'), 'utf8');

test('#374 the Projects screen doc mentions the agents on the city', () => {
  const text = read();
  assert.match(text, /\bCity\b/, 'names the City view');
  assert.match(text, /\bagents?\b/i, 'names the agents at work on it');
});

test('#374 the Projects screen doc mentions "Replay on the map"', () => {
  assert.match(read(), /Replay on the map/);
});

test('#374 the Projects screen doc mentions the collision risk', () => {
  assert.match(read(), /collision risk/i);
});
