'use strict';
// Write doc, phase 0 (#646): edge cases of the selection payload (poc/doc-editor-model.js) that the
// onboarding example does not exercise. The acceptance tests on the real example are in
// test/doc-editor-646.test.js. Cases marked todo are known gaps of the spike, left for phase 1
// (packages/shared/doc-model.js): node:test reports them without failing the suite.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { selectionPayload } = require('../poc/doc-editor-model.js');

const ROOT = path.join(__dirname, '..');
const SOURCE = 'docs/demo/notes.md';
const TRANSLATION = 'docs/demo/notes.pt-BR.md';

function pick(sourceMd, translationMd, lang, src, text) {
  return selectionPayload({
    selection: { file: lang === 'en' ? SOURCE : TRANSLATION, src, text },
    source: { file: SOURCE, markdown: sourceMd },
    translation: { file: TRANSLATION, markdown: translationMd },
  });
}

const lines = (p) => ({ start: p.lines.start, end: p.lines.end });

test('a markdown with CRLF line ends gives the same lines, anchor and a passage without carriage returns', () => {
  const lf = fs.readFileSync(path.join(ROOT, 'docs/work/first-project-onboarding/spec.md'), 'utf8');
  const crlf = lf.replace(/\r?\n/g, '\r\n');
  const text = 'Two cards: "Create new project" and "Import a repository".';
  const p = selectionPayload({
    selection: { file: 'spec.md', src: '18-18', text },
    source: { file: 'spec.md', markdown: crlf },
    translation: { file: 'spec.pt-BR.md', markdown: crlf },
  });
  assert.equal(p.anchor, 'spec-r2');
  assert.deepEqual(lines(p), { start: 18, end: 18 });
  assert.equal(p.passage, text);
  assert.equal(crlf.includes(p.context.before + p.passage + p.context.after), true);

  const whole = selectionPayload({
    selection: { file: 'spec.md', src: '16-16', text: 'not in the block' },
    source: { file: 'spec.md', markdown: crlf },
    translation: { file: 'spec.pt-BR.md', markdown: crlf },
  });
  assert.equal(whole.passage.includes('\r'), false, JSON.stringify(whole.passage.slice(-20)));
});

test('a block before the first heading takes the document name as anchor', () => {
  const md = 'An opening line.\n\n## Notes\n\nBody.\n';
  const p = pick(md, md, 'en', '1-1', 'opening');
  assert.equal(p.anchor, 'notes');
  assert.deepEqual(lines(p), { start: 1, end: 1 });
});

test('a label repeated in a document gives two distinct anchors', () => {
  const md = '## Notes\n\n**R2. First.** One.\n\n**R2. Again.** Two.\n';
  const first = pick(md, md, 'en', '3-3', 'One.');
  const second = pick(md, md, 'en', '5-5', 'Two.');
  assert.equal(first.anchor, 'notes-r2');
  assert.notEqual(second.anchor, first.anchor);
  assert.deepEqual(lines(second), { start: 5, end: 5 });
});

test('a translated section with another label falls back to the source section of the same order', () => {
  const en = '## Notes\n\n**R1. One.** First.\n\n**R2. Two.** Second.\n';
  const pt = '## Notas\n\n**R1. Um.** Primeiro.\n\n**R9. Dois.** Segundo.\n';
  const p = pick(en, pt, 'pt-BR', '5-5', 'Segundo');
  assert.equal(p.anchor, 'notes-r2');
  assert.deepEqual(lines(p), { start: 5, end: 5 });
  assert.equal(p.passage.includes('Second'), true, p.passage);
});

test('a heading of the translation maps to the source heading even when its section does not align', () => {
  const en = '## Notes\n\nOne.\n\n## Next\n\nTwo.\n';
  const pt = '## Notas\n\nUm.\n\nUm bloco a mais.\n\n## Próximo\n\nDois.\n';
  const p = pick(en, pt, 'pt-BR', '1-1', 'Notas');
  assert.deepEqual(lines(p), { start: 1, end: 1 });
  assert.equal(p.passage, '## Notes');
  assert.equal(p.anchor, 'notes-notes');
});

test('a heading with accents gets an ASCII anchor from the English heading', () => {
  const en = '## Café & Résumé\n\nBody.\n';
  const pt = '## Café e currículo\n\nCorpo.\n';
  assert.equal(pick(en, pt, 'pt-BR', '1-1', 'Café').anchor, 'notes-cafe-resume');
});

test('a selected text that is not in the markdown as written (rendered, without the ** marks) sends the whole block', () => {
  const md = fs.readFileSync(path.join(ROOT, 'docs/work/first-project-onboarding/spec.md'), 'utf8');
  const p = selectionPayload({
    selection: { file: 'spec.md', src: '18-18', text: 'R2. Source. Two cards' },
    source: { file: 'spec.md', markdown: md },
    translation: { file: 'spec.pt-BR.md', markdown: md },
  });
  assert.equal(p.anchor, 'spec-r2');
  assert.deepEqual(lines(p), { start: 18, end: 18 });
  assert.equal(p.passage.startsWith('**R2. Source.** Two cards'), true, p.passage);
});

test('a selection on a line with no block is refused', () => {
  const md = '## Notes\n\nBody.\n';
  assert.throws(() => pick(md, md, 'en', '2-2', ''), /no block/);
});

test('two headings with the same text get distinct anchors', { todo: 'phase 1: the anchor is the heading slug only' }, () => {
  const md = '## Notes\n\nOne.\n\n## Notes\n\nTwo.\n';
  const first = pick(md, md, 'en', '1-1', 'Notes');
  const second = pick(md, md, 'en', '5-5', 'Notes');
  assert.notEqual(second.anchor, first.anchor);
});

test('a fenced code block with empty lines is one block, as the reader renders it', { todo: 'phase 1: blocks split at every empty line' }, () => {
  const md = '## Code\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter.\n';
  const p = pick(md, md, 'en', '3-7', 'const b = 2;');
  assert.deepEqual(lines(p), { start: 3, end: 7 });
  assert.equal(p.passage, 'const b = 2;');
});
