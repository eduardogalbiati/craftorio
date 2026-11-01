'use strict';
// Write doc, phase 0 (#646): the editor on the document reader, a spike in poc/.
//
// CONTRACT (acceptance tests written before the code):
// - poc/doc-editor.html opens the onboarding example (docs/work/first-project-onboarding/)
//   in the reader (an iframe), with a fake chat beside it, and makes no model call.
// - poc/doc-editor-model.js (dual-load: module.exports in Node, a global in the page)
//   exports selectionPayload({ selection, source, translation }):
//     selection:   { file, src, text } as the reader reports it: the file the person selected
//                  in (source or translation path), the block's data-src ("41-52") and the
//                  selected text;
//     source:      { file, markdown } the English source;
//     translation: { file, markdown } its .pt-BR.md translation.
//   It returns { file, anchor, lines: { start, end }, passage, context: { before, after },
//   version }, always about the English source: a selection in the translation maps to the
//   source (same anchors, blocks aligned by order inside the section, the whole section
//   when the alignment fails).
// The selections below are recorded: the data-src the reader gives each block and a text a
// person selects in it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIR = 'docs/work/first-project-onboarding';
const DOCS = ['intent', 'spec', 'plan', 'test', 'deploy', 'maintain'];
// The recorded selections below name lines of the spec as it was when they were recorded
// (7e373d5c): its text comes from a frozen copy, so editing the real spec never moves them (#672).
// The payload still names the real files.
const FROZEN = { spec: 'test/fixtures/doc-editor' };

const loadModel = () => require('../poc/doc-editor-model.js');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readDoc = (name, suffix) => read(`${FROZEN[name] || DIR}/${name}${suffix}`);

function pair(name, translationMarkdown) {
  const source = { file: `${DIR}/${name}.md`, markdown: readDoc(name, '.md') };
  const translation = {
    file: `${DIR}/${name}.pt-BR.md`,
    markdown: translationMarkdown === undefined ? readDoc(name, '.pt-BR.md') : translationMarkdown,
  };
  return { source, translation };
}

function select(name, lang, src, text, translationMarkdown) {
  const { selectionPayload } = loadModel();
  const docs = pair(name, translationMarkdown);
  const file = lang === 'en' ? docs.source.file : docs.translation.file;
  return selectionPayload({ selection: { file, src, text }, ...docs });
}

function headings(markdown) {
  return markdown.split(/\r?\n/)
    .map((line, i) => ({ line: i + 1, text: line }))
    .filter((h) => /^#{1,6} /.test(h.text))
    .map((h) => ({ line: h.line, title: h.text.replace(/^#+\s*/, '').trim() }));
}

// Recorded selections in the spec, each in both languages: [section, src, English text, pt-BR text, anchor].
const RECORDED = [
  ['R1', '16-16', 'A four-step wizard', 'Um assistente de quatro etapas', 'spec-r1'],
  ['R2', '18-18', 'Two cards: "Create new project" and "Import a repository".', 'Dois cards', 'spec-r2'],
  ['R2 image', '20-20', 'Step 1', 'Etapa 1', 'spec-r2'],
  ['R7 table', '53-58', 'local: merge into the local base', 'local', 'spec-r7'],
  ['R8', '60-60', 'From 15 to 11', 'De 15 para 11', 'spec-r8'],
  ['R10 image', '82-82', 'Review', 'Revisão', 'spec-r10'],
];

for (const [section, src, enText, ptText, anchor] of RECORDED) {
  const [start, end] = src.split('-').map(Number);

  test(`a selection in the English spec (${section}) gives the source file, anchor and lines`, () => {
    const p = select('spec', 'en', src, enText);
    assert.equal(p.file, `${DIR}/spec.md`);
    assert.equal(p.anchor, anchor);
    assert.deepEqual({ start: p.lines.start, end: p.lines.end }, { start, end });
    assert.equal(p.passage, enText);
  });

  test(`a selection in the pt-BR spec (${section}) maps to the English source`, () => {
    const p = select('spec', 'pt-BR', src, ptText);
    assert.equal(p.file, `${DIR}/spec.md`);
    assert.equal(p.anchor, anchor);
    assert.deepEqual({ start: p.lines.start, end: p.lines.end }, { start, end });
  });
}

test('a pt-BR selection hands the aligned English block as the passage', () => {
  const p = select('spec', 'pt-BR', '18-18', 'Dois cards');
  assert.equal(p.passage.includes('Two cards'), true, p.passage);
  assert.equal(p.passage.includes('Dois cards'), false, p.passage);
});

test('the context is the source text around the passage, at most 200 characters each side', () => {
  const p = select('spec', 'en', '18-18', 'Two cards: "Create new project" and "Import a repository".');
  const md = readDoc('spec', '.md');
  assert.equal(typeof p.context.before, 'string');
  assert.equal(typeof p.context.after, 'string');
  assert.equal(p.context.before.length > 0 && p.context.before.length <= 200, true, `before: ${p.context.before.length}`);
  assert.equal(p.context.after.length > 0 && p.context.after.length <= 200, true, `after: ${p.context.after.length}`);
  assert.equal(md.includes(p.context.before + p.passage + p.context.after), true);
  assert.equal(p.context.before.endsWith('**R2. Source.** '), true, JSON.stringify(p.context.before.slice(-30)));
});

test('the version identifies the source text: the same in both languages, new when the source changes', () => {
  const en = select('spec', 'en', '16-16', 'A four-step wizard');
  const pt = select('spec', 'pt-BR', '16-16', 'Um assistente de quatro etapas');
  assert.equal(typeof en.version, 'string');
  assert.equal(en.version.length > 0, true);
  assert.equal(pt.version, en.version);

  const { selectionPayload } = loadModel();
  const docs = pair('spec');
  docs.source = { ...docs.source, markdown: docs.source.markdown.replace('Two cards', 'Three cards') };
  const changed = selectionPayload({ selection: { file: docs.source.file, src: '16-16', text: 'A four-step wizard' }, ...docs });
  assert.notEqual(changed.version, en.version);
});

test('blocks of the translation align by order inside the section, not by line number', () => {
  // Two more front matter lines in the translation shift every block by two lines.
  const shifted = readDoc('spec', '.pt-BR.md').replace('source: spec.md (English)', 'source: spec.md (English)\nreviewer: someone\nnote: shifted');
  const paragraph = select('spec', 'pt-BR', '20-20', 'Dois cards', shifted);
  assert.equal(paragraph.anchor, 'spec-r2');
  assert.deepEqual({ start: paragraph.lines.start, end: paragraph.lines.end }, { start: 18, end: 18 });
  const image = select('spec', 'pt-BR', '22-22', 'Etapa 1', shifted);
  assert.equal(image.anchor, 'spec-r2');
  assert.deepEqual({ start: image.lines.start, end: image.lines.end }, { start: 20, end: 20 });
});

test('when the blocks of a section do not align, the whole source section is sent', () => {
  // The translation's R2 section gets a block the source does not have.
  const extra = readDoc('spec', '.pt-BR.md').replace('![Etapa 1](images/mock-1.jpg)', 'Um parágrafo a mais, só na tradução.\n\n![Etapa 1](images/mock-1.jpg)');
  const p = select('spec', 'pt-BR', '18-18', 'Dois cards', extra);
  assert.equal(p.file, `${DIR}/spec.md`);
  assert.equal(p.anchor, 'spec-r2');
  assert.equal(p.lines.start, 18);
  assert.equal(p.lines.end === 20 || p.lines.end === 21, true, `end: ${p.lines.end}`);
  assert.equal(p.passage.includes('Two cards'), true, p.passage);
  assert.equal(p.passage.includes('images/mock-1.jpg'), true, p.passage);
  assert.equal(p.passage.includes('R3. Import'), false, p.passage);
});

test('a block under a heading takes the heading anchor, the same in both languages', () => {
  const designHeading = select('spec', 'en', '98-98', 'Design');
  const en = select('spec', 'en', '100-105', 'testable with no DOM');
  const pt = select('spec', 'pt-BR', '100-105', 'testáveis sem DOM');
  assert.equal(en.anchor, designHeading.anchor);
  assert.equal(pt.anchor, designHeading.anchor);
  assert.equal(en.anchor.startsWith('spec-'), true, en.anchor);
  assert.notEqual(en.anchor, 'spec-r12');
  assert.deepEqual({ start: pt.lines.start, end: pt.lines.end }, { start: 100, end: 105 });
  assert.equal(pt.passage.includes('Wizard'), true, pt.passage);

  const questions = select('spec', 'pt-BR', '120-124', 'Por quanto tempo os aliases valem?');
  assert.equal(questions.anchor, select('spec', 'en', '118-118', 'Open questions').anchor);
  assert.notEqual(questions.anchor, en.anchor);
});

for (const name of DOCS) {
  test(`every section of ${name}.md gives the same payload from either language`, () => {
    const enMd = readDoc(name, '.md');
    const ptMd = readDoc(name, '.pt-BR.md');
    const enHeads = headings(enMd);
    const ptHeads = headings(ptMd);
    assert.equal(enHeads.length > 0, true);
    assert.equal(ptHeads.length, enHeads.length);
    const anchors = new Set();
    enHeads.forEach((h, i) => {
      const pt = ptHeads[i];
      const fromEn = select(name, 'en', `${h.line}-${h.line}`, h.title);
      const fromPt = select(name, 'pt-BR', `${pt.line}-${pt.line}`, pt.title);
      for (const p of [fromEn, fromPt]) {
        assert.equal(p.file, `${DIR}/${name}.md`, h.title);
        assert.deepEqual({ start: p.lines.start, end: p.lines.end }, { start: h.line, end: h.line }, h.title);
        assert.equal(p.anchor.startsWith(`${name}-`), true, `${h.title}: ${p.anchor}`);
        assert.equal(p.passage.includes(h.title), true, `${h.title}: ${p.passage}`);
        assert.equal(typeof p.version === 'string' && p.version.length > 0, true);
      }
      assert.equal(fromPt.anchor, fromEn.anchor, h.title);
      anchors.add(fromEn.anchor);
    });
    assert.equal(anchors.size, enHeads.length, `${name}: anchors are not unique`);
  });
}

test('poc/doc-editor.html opens the onboarding example in the reader iframe, beside a fake chat', () => {
  const html = read('poc/doc-editor.html');
  assert.equal(/<iframe\b/i.test(html), true, 'no reader iframe');
  assert.equal(html.includes('first-project-onboarding'), true, 'does not open the onboarding example');
  assert.equal(/chat/i.test(html), true, 'no chat');
  assert.equal(html.includes('doc-editor-model.js'), true, 'does not load the payload model');
  assert.equal(/addEventListener\(\s*['"]message['"]|onmessage/.test(html), true, 'does not listen to the reader messages');
});

test('the editor spike makes no model call', () => {
  for (const rel of ['poc/doc-editor.html', 'poc/doc-editor-model.js']) {
    const text = read(rel);
    assert.equal(/anthropic|openai|\/v1\/(messages|chat)|generativelanguage/i.test(text), false, rel);
  }
});
