// What a command's output is read with (#50, split from packages/engine/engine/suite-step.js):
// clean(text) without the terminal's colour codes, fileOf(loc, cwd) the file a location names. Used by the
// suite step (suite-step.js) and the check step's comparison with the base (check-findings.js).

'use strict';

const path = require('path');

// the text without ANSI colour codes
const clean = (s) => String(s || '').replace(/\x1b\[[0-9;]*m/g, '');

// 'C:\\x\\test\\a.test.js:12:3' / 'file:///x/a.test.js:12:3' → the file, relative to cwd when inside it
function fileOf(loc, cwd) {
  let f = String(loc || '').trim().replace(/^'|'$/g, '').replace(/\\\\/g, '\\').replace(/^file:\/\/\/?/, '').replace(/:\d+(?::\d+)?$/, '');
  if (cwd && path.isAbsolute(f)) {
    const rel = path.relative(cwd, f);
    if (!rel.startsWith('..')) f = rel;
  }
  return f.split(path.sep).join('/');
}

module.exports = {
  clean,
  fileOf,
};
