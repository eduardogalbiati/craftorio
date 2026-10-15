// #375: the README fragments of the Backlog (docs/screens/backlog.md) and Roadmap
// (docs/screens/roadmap.md) screens mention "Show on the map" (an issue's or a roadmap item's expected
// footprint on the project city), and the Roadmap one "Show the stage on the map".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', 'docs', 'screens', name), 'utf8');

test('#375 the Backlog screen doc mentions "Show on the map"', () => {
  assert.match(read('backlog.md'), /Show on the map/);
});

test('#375 the Roadmap screen doc mentions "Show on the map" for an item', () => {
  assert.match(read('roadmap.md'), /Show on the map/);
});

test('#375 the Roadmap screen doc mentions "Show the stage on the map"', () => {
  assert.match(read('roadmap.md'), /Show the stage on the map/);
});
