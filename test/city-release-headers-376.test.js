// #376 review: the district/zone counting rule lives once (CityImpact.countByDistrict), so the
// impact header (#375) and the release header (#376) count the same drawn buildings the same way,
// and the impact header's Danger Zone share keeps its meaning (the share of the distinct drawn
// paths whose quadrant is the Danger Zone; a path the layout does not draw is not counted).
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildModel } = require('../src/shared/architecture-model');
const { buildCity } = require('../src/shared/city-model');
const { layoutCity } = require('../src/shared/city-layout');
const { impactHeader } = require('../src/shared/city-impact');
const { releaseHeader } = require('../src/shared/city-release');

const hash = '76'.repeat(20);
const FILES = [
  { path: 'src/engine/run.js', lines: 100 }, { path: 'src/engine/queue.js', lines: 40 },
  { path: 'src/engine/gates.js', lines: 30 }, { path: 'docs/a.md', lines: 5 },
];
const layout = () => layoutCity(buildCity({
  plan: null,
  facts: buildModel({
    head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
    files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
    ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
  }),
}).model);
const plain = (x) => JSON.parse(JSON.stringify(x));
const sum = (list) => list.reduce((s, x) => s + x.count, 0);

test('#376 the impact and the release headers count the same drawn buildings the same way, by district and zone', () => {
  const l = layout();
  const changes = [
    { status: 'changed', path: 'src/engine/run.js', lines: 10 },
    { status: 'renamed', from: 'src/engine/queue.js', path: 'lib/queue.js', lines: 0 },
    { status: 'removed', path: 'docs/a.md', lines: 5 },
  ];
  const release = releaseHeader(l, changes);
  const impact = impactHeader(l, ['src/engine/run.js', 'src/engine/queue.js', 'docs/a.md']);
  assert.equal(impact.total, 3);
  assert.equal(sum(impact.districts), 3);
  assert.deepEqual(plain(release.districts), plain(impact.districts));
  assert.deepEqual(plain(release.zones), plain(impact.zones));
});

test('#376 an added file not drawn yet counts in the release header\'s status counts only, as a path outside the layout in the impact header', () => {
  const l = layout();
  const release = releaseHeader(l, [{ status: 'added', path: 'src/engine/new.js', lines: 5 }, { status: 'changed', path: 'src/engine/gates.js', lines: 1 }]);
  assert.deepEqual(plain(release.counts), { added: 1, changed: 1, removed: 0, renamed: 0 });
  assert.equal(sum(release.districts), 1);
  assert.deepEqual(plain(release.districts), plain(impactHeader(l, ['src/engine/new.js', 'src/engine/gates.js']).districts));
});

test('#376 impactHeader after the shared counting: a duplicate path counts once and dangerShare is over the distinct drawn paths', () => {
  const quadrants = { 'src/engine/run.js': 'Danger Zone', 'not/drawn.js': 'Danger Zone', 'src/engine/queue.js': 'Quick Wins' };
  const h = impactHeader(layout(), ['src/engine/run.js', 'src/engine/queue.js', 'src/engine/run.js', 'not/drawn.js'], { quadrants });
  assert.equal(h.total, 2);
  assert.equal(sum(h.districts), 2);
  assert.equal(h.dangerShare, 0.5);
});

test('#376 impactHeader with no drawn path: zero total and a zero Danger Zone share', () => {
  const h = impactHeader(layout(), ['not/drawn.js'], { quadrants: { 'not/drawn.js': 'Danger Zone' } });
  assert.equal(h.total, 0);
  assert.equal(h.dangerShare, 0);
  assert.deepEqual(plain(h.districts), []);
});
