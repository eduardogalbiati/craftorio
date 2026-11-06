// #781: ActivityLine.paint: a second's tick moves only the line's meta, so the shine is not restarted.
const test = require('node:test');
const assert = require('node:assert/strict');
const { html, paint } = require('../activity-line');

// a box already holding a running line: writes to innerHTML are counted
function box({ state = 'running', text = 'Reading', meta = '0:01' } = {}) {
  const metaEl = { textContent: meta };
  const line = {
    getAttribute: () => state,
    querySelector: (sel) => (sel === '.activity-line-meta' ? metaEl : { textContent: text }),
  };
  const el = { writes: 0, querySelector: () => line, set innerHTML(_) { this.writes++; } };
  return { el, metaEl };
}

test('#781 the same action only moves the meta', () => {
  const { el, metaEl } = box();
  paint(el, { state: 'running', text: 'Reading', meta: '0:02' });
  assert.equal(metaEl.textContent, '0:02');
  assert.equal(el.writes, 0);
});

test('#781 another action redraws the line', () => {
  const { el } = box();
  paint(el, { state: 'running', text: 'Writing', meta: '0:02' });
  assert.equal(el.writes, 1);
});

test('#781 another state redraws the line', () => {
  const { el } = box();
  paint(el, { state: 'done', text: 'Reading', meta: '0:02' });
  assert.equal(el.writes, 1);
});

test('#781 an empty box gets the line, and no box is no error', () => {
  const el = { querySelector: () => null, innerHTML: '' };
  paint(el, { state: 'running', text: 'Reading' });
  assert.equal(el.innerHTML, html({ state: 'running', text: 'Reading' }));
  assert.doesNotThrow(() => paint(null, { state: 'running', text: 'Reading' }));
});
