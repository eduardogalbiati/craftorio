// #670 internals: the one rule of "which mockups an issue's text names" (ui-review-checks.js
// issueMockups), shared by the run and the split (po-split.js childBody).
const test = require('node:test');
const assert = require('node:assert/strict');
const { issueMockups } = require('../../engine/ui-review-checks');
const { childBody } = require('../../domains/po/po-split');

test('issueMockups: embedded images, links and the spec\'s repository paths, each once', () => {
  const text = '![mock-1.jpg](https://x/a.png)\n[mock-2.jpg](https://x/b)\nSee docs/work/item/images/mock-3.jpg and ![](docs/work/item/mock-1.jpg)';
  assert.deepEqual(issueMockups(text).map((m) => m.file), ['mock-1.jpg', 'mock-2.jpg', 'mock-3.jpg']);
});

test('issueMockups: an HTML mockup only from the repository, never an outside page', () => {
  assert.deepEqual(issueMockups('[guide](https://site/page.html)'), []);
  assert.deepEqual(issueMockups('[wizard](docs/work/item/wizard.html)').map((m) => m.file), ['wizard.html']);
  assert.deepEqual(issueMockups('![shot](https://site/mock-1.png)').map((m) => m.file), ['mock-1.png']);
});

test('childBody: a sibling\'s mockup listed by repository path stays out of the child', () => {
  const parent = {
    number: 9,
    title: 'Wizard',
    body: [
      '## Tasks', '',
      '- [ ] Home matches `mock-1.jpg`',
      '- [ ] Settings matches `mock-2.jpg`', '',
      '## Mockups', '',
      '- docs/work/item/mock-1.jpg',
      '- docs/work/item/mock-2.jpg',
    ].join('\n'),
  };
  const body = childBody({ parent, child: { tasks: [1] }, index: 0, total: 2 });
  assert.match(body, /docs\/work\/item\/mock-1\.jpg/);
  assert.doesNotMatch(body, /docs\/work\/item\/mock-2\.jpg/);
});
