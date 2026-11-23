// #35 review: the catalogs (packages/shared/i18n/en.json, pt-BR.json) keep one key per line, both in the same order,
// and the keys #35 added (backlog.local_issues_*) in order. (The catalogs as a whole are not sorted yet: some older
// keys are out of order in both; this test does not ask for a reorder.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const file = (lang) => path.join(__dirname, '..', 'i18n', `${lang}.json`);
const lines = (lang) => fs.readFileSync(file(lang), 'utf8').split(/\r?\n/);
const KEY = /^\s*"([^"\\]+)"\s*:/;
const keysOf = (lang) => lines(lang).map((l) => (l.match(KEY) || [])[1]).filter(Boolean);

for (const lang of ['en', 'pt-BR']) {
  test(`#35 ${lang}.json has one key per line`, () => {
    const parsed = Object.keys(JSON.parse(fs.readFileSync(file(lang), 'utf8')));
    const crowded = lines(lang).map((l, i) => [i + 1, (l.match(/"[^"\\]+"\s*:\s*["{]/g) || []).length, l])
      .filter(([, n, l]) => n > 1 && !/^\s*"[^"]+"\s*:\s*\{\s*"(zero|one|two|few|many|other)"/.test(l));
    assert.deepEqual(crowded.map(([n]) => n), [], 'lines with more than one key');
    assert.equal(keysOf(lang).length, parsed.length, 'every key starts its own line');
  });

  test(`#35 ${lang}.json lists the local backlog keys in order`, () => {
    const local = keysOf(lang).filter((k) => k.startsWith('backlog.local_issues'));
    assert.equal(local.length > 0, true, 'the #35 keys are there');
    assert.deepEqual(local, [...local].sort());
  });
}

test('#35 en.json and pt-BR.json keep their keys in the same order', () => {
  const en = keysOf('en');
  const pt = keysOf('pt-BR');
  const first = en.findIndex((k, i) => k !== pt[i]);
  assert.equal(first, -1, `first difference at key ${first}: en "${en[first]}" / pt-BR "${pt[first]}"`);
  assert.equal(en.length, pt.length);
});
