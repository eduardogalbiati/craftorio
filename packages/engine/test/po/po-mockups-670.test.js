// #670: a spec's mockups are the specification of its screens. packages/engine/domains/po/po-mockups.js
// (new) finds them and checks that the proposed issues cover every one in scope.
// Acceptance tests written before the code: the module is required inside each test, so the file loads
// before it exists.
//
// The contract these tests fix:
//   MOCKUP_EXTENSIONS: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.html'] (matched case-insensitively)
//   findMockups(projectDir, item) -> [{ file, path }]
//     every mockup under `<projectDir>/docs/work/<item>/` (subfolders included): `file` its base name,
//     `path` its repository-relative path with forward slashes (`docs/work/<item>/mock-1.jpg`),
//     sorted by `path` (plain string order, Array#sort); [] when the folder does not exist. Other files (spec.md, notes.txt) are not mockups.
//   checkMockupCoverage({ mockups, issues, outOfScope = [] })
//       -> { ok, covered: [{ mockup, issue }], missing: [file], later: [file], errors: [string] }
//     mockups: findMockups' list; issues: the proposal's issues [{ title, body }]; outOfScope: the base
//     names of the mockups of later phases. An issue covers a mockup when its title or body names the
//     mockup's base name. `covered` (mockup order): each covered mockup's base name and the `title` of
//     the first issue naming it. `missing`: in-scope mockups no issue names, each with the error
//     "<file> has no issue". `later`: the out-of-scope mockups no issue names (never an error).
//     ok: no error.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../../domains/po/po-mockups');

function project(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

const SPEC = {
  'docs/work/home-screen/spec.md': '# Home screen\n\nR1 The home screen lists the projects.\n',
  'docs/work/home-screen/notes.txt': 'not a mockup',
  'docs/work/home-screen/mock-2.png': PNG,
  'docs/work/home-screen/mock-1.jpg': JPG,
  'docs/work/home-screen/mock-3.html': '<main><h1>Settings</h1><button>Save</button></main>',
  'docs/work/other-item/mock-9.png': PNG,
};

const MOCKS = [
  { file: 'mock-1.jpg', path: 'docs/work/home-screen/mock-1.jpg' },
  { file: 'mock-2.png', path: 'docs/work/home-screen/mock-2.png' },
  { file: 'mock-3.html', path: 'docs/work/home-screen/mock-3.html' },
  { file: 'mock-4.jpg', path: 'docs/work/home-screen/mock-4.jpg' },
];

test('#670 findMockups: the images and the html mockup of the item, sorted, without spec.md, other files or another item', (t) => {
  const dir = project(t, SPEC);
  assert.deepEqual(load().findMockups(dir, 'home-screen'), [
    { file: 'mock-1.jpg', path: 'docs/work/home-screen/mock-1.jpg' },
    { file: 'mock-2.png', path: 'docs/work/home-screen/mock-2.png' },
    { file: 'mock-3.html', path: 'docs/work/home-screen/mock-3.html' },
  ]);
});

test('#670 findMockups: every image kind counts (jpeg, gif, webp, svg, upper-case extension), in subfolders too', (t) => {
  const dir = project(t, {
    'docs/work/item/a.jpeg': JPG,
    'docs/work/item/b.gif': 'GIF89a',
    'docs/work/item/c.webp': 'RIFF',
    'docs/work/item/d.svg': '<svg/>',
    'docs/work/item/E.PNG': PNG,
    'docs/work/item/screens/f.png': PNG,
  });
  assert.deepEqual(load().findMockups(dir, 'item').map((m) => m.path), [
    'docs/work/item/E.PNG',
    'docs/work/item/a.jpeg',
    'docs/work/item/b.gif',
    'docs/work/item/c.webp',
    'docs/work/item/d.svg',
    'docs/work/item/screens/f.png',
  ].sort());
});

test('#670 findMockups: an item without a folder, or a spec without mockups, has none', (t) => {
  const dir = project(t, { 'docs/work/plain/spec.md': '# Plain\n' });
  assert.deepEqual(load().findMockups(dir, 'plain'), []);
  assert.deepEqual(load().findMockups(dir, 'missing-item'), []);
});

test('#670 checkMockupCoverage: every mockup named by an issue: ok, each mockup listed with the issue that covers it', () => {
  const issues = [
    { title: 'Home screen', body: '- [ ] The home screen matches `mock-1.jpg`: layout, icons, texts, controls, order\n- [ ] The list matches mock-2.png' },
    { title: 'Settings screen', body: '- [ ] The settings screen matches `mock-3.html`: layout, icons, texts, controls, order' },
  ];
  const out = load().checkMockupCoverage({ mockups: MOCKS.slice(0, 3), issues });
  assert.equal(out.ok, true);
  assert.deepEqual(out.covered, [
    { mockup: 'mock-1.jpg', issue: 'Home screen' },
    { mockup: 'mock-2.png', issue: 'Home screen' },
    { mockup: 'mock-3.html', issue: 'Settings screen' },
  ]);
  assert.deepEqual(out.missing, []);
  assert.deepEqual(out.errors, []);
});

test('#670 checkMockupCoverage: a mockup in scope that no issue names blocks the proposal: "mock-4.jpg has no issue"', () => {
  const issues = [{ title: 'Home screen', body: 'Matches mock-1.jpg, mock-2.png and mock-3.html.' }];
  const out = load().checkMockupCoverage({ mockups: MOCKS, issues });
  assert.equal(out.ok, false);
  assert.deepEqual(out.missing, ['mock-4.jpg']);
  assert.deepEqual(out.errors, ['mock-4.jpg has no issue']);
});

test('#670 checkMockupCoverage: a mockup out of scope is listed as a later phase, not an error', () => {
  const issues = [{ title: 'Home screen', body: 'Matches mock-1.jpg, mock-2.png and mock-3.html.' }];
  const out = load().checkMockupCoverage({ mockups: MOCKS, issues, outOfScope: ['mock-4.jpg'] });
  assert.equal(out.ok, true);
  assert.deepEqual(out.later, ['mock-4.jpg']);
  assert.deepEqual(out.missing, []);
  assert.deepEqual(out.errors, []);
});

test('#670 checkMockupCoverage: an issue naming a mockup in its title covers it', () => {
  const out = load().checkMockupCoverage({ mockups: MOCKS.slice(0, 1), issues: [{ title: 'Home screen as in mock-1.jpg', body: 'No task names it.' }] });
  assert.deepEqual(out.covered, [{ mockup: 'mock-1.jpg', issue: 'Home screen as in mock-1.jpg' }]);
  assert.equal(out.ok, true);
});
