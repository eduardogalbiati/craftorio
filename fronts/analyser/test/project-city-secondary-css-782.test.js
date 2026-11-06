// #782: the city's quiet action is a framed button. Its root is .r3d, whose `.r3d button` reset (0,1,1) takes the
// border and the padding away from any rule of one class (0,1,0): every .pc-secondary rule sits under .r3d.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'views', 'project', 'project-city.css'), 'utf8');

test('every .pc-secondary rule outranks the .r3d button reset', () => {
  const selectors = css.split('\n').filter((line) => /^[^/*]*\.pc-secondary[^{]*\{/.test(line)).map((line) => line.split('{')[0].trim());
  assert.ok(selectors.length >= 4, `the base, hover, focus and disabled rules: ${selectors.join(' | ')}`);
  for (const selector of selectors) assert.match(selector, /^\.r3d \.pc-secondary/);
});
