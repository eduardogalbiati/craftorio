// #438, the release view's colours in src/shared/city-release.js (releaseOverlay):
// - the change ramp spreads over the release's own changes (quantiles or a log scale, the change's
//   choice): one huge change does not leave every other changed file in the lightest shade; every
//   colour a changed or renamed file gets is one of CHANGE_RAMP's four shades, and more lines never
//   give a lighter shade within one release;
// - a renamed file carries a sign of its own on the map, whatever its shade: releaseOverlay's output
//   for a rename differs from the one for a change of the same lines in something other than the
//   highlight colours (a list of renamed paths, markers, an outline: the property name is the
//   change's), and that sign names the rename's drawn building (its old path) or its new path;
// - unchanged: added files are ADDED_COLOUR, removed files are ghosts and never highlighted.
// The ramp's cut points (the line counts each shade stands for) are checked through the legend in
// test/project-city-release-438-439.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../src/shared/city-release.js');
const plain = (x) => JSON.parse(JSON.stringify(x));
// the overlay without its colours: what else it carries (ghosts, a rename's sign)
const withoutHighlight = (o) => { const { highlight, ...rest } = plain(o); return JSON.stringify(rest); };

// 20 changed files of 1..20 lines, and one of 100000 lines
const SPREAD = [
  ...Array.from({ length: 20 }, (_, i) => ({ status: 'changed', path: `src/f${String(i + 1).padStart(2, '0')}.js`, lines: i + 1 })),
  { status: 'changed', path: 'src/huge.js', lines: 100000 },
];

test('#438 a release with one huge change still spreads its changed files over all four shades', () => {
  const { releaseOverlay } = load();
  const colours = new Set(Object.values(plain(releaseOverlay(SPREAD)).highlight));
  assert.equal(colours.size, 4, `shades used: ${[...colours].join(', ')}`);
});

test('#438 every colour the overlay gives a changed or renamed file is one of the four ramp shades', () => {
  const { releaseOverlay, CHANGE_RAMP } = load();
  const ramp = Array.from(CHANGE_RAMP);
  assert.deepEqual(ramp, ['#f6d58e', '#f2a541', '#e8743b', '#d9480f']);
  const changes = [...SPREAD, { status: 'renamed', from: 'src/old.js', path: 'lib/new.js', lines: 7 }];
  const out = plain(releaseOverlay(changes));
  for (const [p, colour] of Object.entries(out.highlight)) assert.ok(ramp.includes(colour), `${p}: ${colour} is a ramp shade`);
});

test('#438 within one release, more lines changed never give a lighter shade', () => {
  const { releaseOverlay, CHANGE_RAMP } = load();
  const ramp = Array.from(CHANGE_RAMP);
  const out = plain(releaseOverlay(SPREAD));
  let last = -1;
  for (const c of SPREAD) {
    const i = ramp.indexOf(out.highlight[c.path]);
    assert.ok(i >= last, `${c.path} (${c.lines} lines) is not lighter than a smaller change`);
    last = i;
  }
});

test('#438 a renamed file carries a sign a changed file of the same lines does not', () => {
  const { releaseOverlay } = load();
  const changed = releaseOverlay([{ status: 'changed', path: 'src/a.js', lines: 10 }]);
  const renamed = releaseOverlay([{ status: 'renamed', from: 'src/a.js', path: 'lib/a.js', lines: 10 }]);
  assert.notEqual(withoutHighlight(renamed), withoutHighlight(changed), 'the rename differs in more than its colour');
});

test('#438 the rename sign names the renamed file, whatever its shade', () => {
  const { releaseOverlay } = load();
  for (const lines of [1, 100000]) {
    const out = releaseOverlay([
      { status: 'changed', path: 'src/mid.js', lines: 50 },
      { status: 'renamed', from: 'src/old.js', path: 'lib/new.js', lines },
    ]);
    const rest = withoutHighlight(out);
    assert.ok(rest.includes('src/old.js') || rest.includes('lib/new.js'), `a ${lines}-line rename is marked: ${rest}`);
    assert.equal(rest.includes('src/mid.js'), false, `the changed file carries no rename sign: ${rest}`);
  }
});

test('#438 unchanged: added files stay green, removed files stay ghosts and are not highlighted', () => {
  const { releaseOverlay, ADDED_COLOUR } = load();
  const out = plain(releaseOverlay([
    { status: 'added', path: 'src/fresh.js', lines: 100000 },
    { status: 'changed', path: 'src/edit.js', lines: 3 },
    { status: 'removed', path: 'src/gone.js', lines: 40 },
  ]));
  assert.equal(out.highlight['src/fresh.js'], ADDED_COLOUR);
  assert.deepEqual(out.ghosts, ['src/gone.js']);
  assert.equal('src/gone.js' in out.highlight, false);
});
