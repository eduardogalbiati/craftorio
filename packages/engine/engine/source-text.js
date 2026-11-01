// Source text helpers shared by the static analyses of the code: the layer rule (scripts/layers.js),
// the affected-test selection (affected-tests.js) and the paths a test reads (test-reads.js, #695).

// The source with comments and regex literals blanked (strings and line breaks kept, so targets
// and lines survive). A / after an operator, an opening bracket or `return` starts a regex.
function withoutComments(src) {
  let out = '';
  let i = 0;
  let prev = '';
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//' || two === '/*') {
      const close = two === '//' ? src.indexOf('\n', i) : src.indexOf('*/', i + 2);
      const end = close < 0 ? src.length : close + (two === '//' ? 0 : 2);
      out += src.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
      continue;
    }
    const c = src[i];
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      prev = '"';
      continue;
    }
    if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]|^$|return$/.test(prev)) {
      let j = i + 1;
      let cls = false;
      while (j < src.length && (cls || src[j] !== '/') && src[j] !== '\n') {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        j++;
      }
      j++;
      while (/[a-z]/.test(src[j] || '')) j++;
      out += src.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
      prev = '"';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = (/[\w$]/.test(c) && /[\w$]$/.test(prev) ? prev + c : c).slice(-6);
    i++;
  }
  return out;
}

// A text → the same text matching itself literally in a RegExp.
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = {
  escapeRegExp,
  withoutComments,
};
