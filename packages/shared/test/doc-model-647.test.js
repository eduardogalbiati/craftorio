'use strict';
// #647 Write doc phase 1 (docs/work/write-doc/spec.md R2, R3, R5, R9, R13): packages/shared/doc-model.js,
// the pure rules of the document editor (the promotion of poc/doc-editor-model.js). Written before the
// code: the module is loaded inside each test so every test fails on its own. The contract:
// - selectionPayload({ selection: { file, src, text }, source: { file, markdown }, translation: { file, markdown } })
//   → { file, anchor, lines: { start, end }, passage, context: { before, after }, version }, always about the
//   English source (same shape as the phase-0 prototype);
// - lintDoc({ kind: 'intent' | 'spec', markdown, exists?: (relPath) => boolean }) → { ok, problems: [{ rule, message, line? }] },
//   rules: front-matter, section, requirements, recommended (a **D<n>. Title.** decision with no
//   **Recommended:** line before the next decision or heading), image;
// - lintTranslation(sourceMd, translationMd) → problems with rule 'translation' when the headings or the
//   R-labels of the pair differ, [] for an aligned pair;
// - setFrontMatter(markdown, fields) → those front-matter keys replaced or added, every other line unchanged;
// - replaceLines(markdown, { start, end }, text) → 1-based inclusive lines replaced, the rest unchanged;
// - in a browser (no module): window.DocModel.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MODULE = path.join(__dirname, '..', 'doc-model.js');
const load = () => require('../doc-model');

const SOURCE = 'docs/work/demo/spec.md';
const TRANSLATION = 'docs/work/demo/spec.pt-BR.md';

// line numbers on the left are the 1-based lines the reader tags (data-src)
const EN = [
  '## Requirements', //                                   1
  '', //                                                  2
  '**R1. List.** The screen lists the items.', //         3
  '', //                                                  4
  '**R2. Edit.** The person edits a section.', //         5
  'It keeps the rest of the document.', //                6
  '', //                                                  7
  'A second paragraph of R2.', //                         8
  '', //                                                  9
  '## Design', //                                         10
  '', //                                                  11
  'Plain text.', //                                       12
  '',
].join('\n');

const PT = [
  '## Requisitos',
  '',
  '**R1. Lista.** A tela lista os itens.',
  '',
  '**R2. Editar.** A pessoa edita uma seção.',
  'Mantém o resto do documento.',
  '',
  'Um segundo parágrafo de R2.', //                       8
  '',
  '## Design',
  '',
  'Texto simples.',
  '',
].join('\n');

// the translation splits R2's first paragraph: 3 blocks against the source's 2
const PT_SPLIT = [
  '## Requisitos',
  '',
  '**R1. Lista.** A tela lista os itens.',
  '',
  '**R2. Editar.** A pessoa edita uma seção.',
  '',
  'Mantém o resto do documento.',
  '',
  'Um segundo parágrafo de R2.', //                       9
  '',
  '## Design',
  '',
  'Texto simples.',
  '',
].join('\n');

function pick(sourceMd, translationMd, lang, src, text) {
  return load().selectionPayload({
    selection: { file: lang === 'en' ? SOURCE : TRANSLATION, src, text },
    source: { file: SOURCE, markdown: sourceMd },
    translation: { file: TRANSLATION, markdown: translationMd },
  });
}

const VALID_INTENT = `---
item: demo
issue: "#1"
stage: intent
status: draft
date: 2026-10-31
translation: intent.pt-BR.md
---

# Intent: demo

## Problem

People lose track of their documents.

## Proposed outcome

One list of the items and their stage.

## Affected users and systems

The owner.

## Constraints

Markdown only.

## Open questions

1. Which colour? *Proposed: blue.*
`;

const VALID_SPEC = `---
item: demo
issue: "#1"
stage: design
status: draft
date: 2026-10-31
intent: intent.md (accepted)
translation: spec.pt-BR.md
---

# Spec: demo

## Requirements

**R1. List.** The screen lists the items.

![The list](images/list.png)

**R2. Edit.** The person edits a section.

## Design

**D1. Where the items live.** Options: the repository or the workspace.
**Recommended:** the repository.

## Areas of concern

- Anchor stability.

## Open questions

1. None yet.
`;

const VALID_SPEC_PT = `---
item: demo
issue: "#1"
stage: design
status: draft
date: 2026-10-31
intent: intent.md (accepted)
source: spec.md
---

# Spec: demo

## Requisitos

**R1. Lista.** A tela lista os itens.

![A lista](images/list.png)

**R2. Editar.** A pessoa edita uma seção.

## Design

**D1. Onde os itens ficam.** Opções: o repositório ou o workspace.
**Recomendado:** o repositório.

## Áreas de atenção

- Estabilidade das âncoras.

## Perguntas em aberto

1. Nenhuma ainda.
`;

const imageExists = (rel) => rel === 'images/list.png';
const rules = (result) => result.problems.map((p) => p.rule);

// ---- selectionPayload --------------------------------------------------------------------------

test('#647 a selection in the English source gives that block\'s lines and its requirement\'s anchor', () => {
  const p = pick(EN, PT, 'en', '5-6', 'edits a section');
  assert.equal(p.file, SOURCE);
  assert.equal(p.anchor, 'spec-r2');
  assert.deepEqual({ start: p.lines.start, end: p.lines.end }, { start: 5, end: 6 });
  assert.equal(p.passage, 'edits a section');
});

test('#647 a selection in the pt-BR translation is sent as the matching block of the English source', () => {
  const p = pick(EN, PT, 'pt-BR', '8-8', 'segundo parágrafo');
  assert.equal(p.file, SOURCE);
  assert.equal(p.anchor, 'spec-r2');
  assert.deepEqual({ start: p.lines.start, end: p.lines.end }, { start: 8, end: 8 });
  assert.equal(p.passage, 'A second paragraph of R2.');
});

test('#647 a selection in a translated section whose blocks do not align sends the whole source section', () => {
  const p = pick(EN, PT_SPLIT, 'pt-BR', '9-9', 'segundo parágrafo');
  assert.equal(p.file, SOURCE);
  assert.equal(p.anchor, 'spec-r2');
  assert.deepEqual({ start: p.lines.start, end: p.lines.end }, { start: 5, end: 8 });
});

test('#647 two headings with the same text get distinct anchors', () => {
  const md = '## Notes\n\nOne.\n\n## Notes\n\nTwo.\n';
  const first = pick(md, md, 'en', '1-1', 'Notes');
  const second = pick(md, md, 'en', '5-5', 'Notes');
  assert.notEqual(second.anchor, first.anchor);
});

test('#647 a fenced code block with an empty line inside is one block', () => {
  const md = '## Code\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter.\n';
  const p = pick(md, md, 'en', '3-7', 'const b = 2;');
  assert.deepEqual({ start: p.lines.start, end: p.lines.end }, { start: 3, end: 7 });
  assert.equal(p.passage, 'const b = 2;');
});

// ---- lintDoc ------------------------------------------------------------------------------------

test('#647 a complete intent passes the lint with no problem', () => {
  const r = load().lintDoc({ kind: 'intent', markdown: VALID_INTENT, exists: imageExists });
  assert.deepEqual(rules(r), []);
  assert.equal(r.ok, true);
});

test('#647 a complete spec passes the lint with no problem', () => {
  const r = load().lintDoc({ kind: 'spec', markdown: VALID_SPEC, exists: imageExists });
  assert.deepEqual(rules(r), []);
  assert.equal(r.ok, true);
});

test('#647 the lint reports a front matter without a status', () => {
  const r = load().lintDoc({ kind: 'intent', markdown: VALID_INTENT.replace('status: draft\n', ''), exists: imageExists });
  assert.equal(rules(r).includes('front-matter'), true, JSON.stringify(r.problems));
  assert.equal(r.ok, false);
});

test('#647 the lint reports a front matter with neither translation nor source', () => {
  const r = load().lintDoc({ kind: 'intent', markdown: VALID_INTENT.replace('translation: intent.pt-BR.md\n', ''), exists: imageExists });
  assert.equal(rules(r).includes('front-matter'), true, JSON.stringify(r.problems));
});

test('#647 the lint reports an intent missing one of the playbook\'s sections', () => {
  const r = load().lintDoc({ kind: 'intent', markdown: VALID_INTENT.replace('## Constraints\n\nMarkdown only.\n\n', ''), exists: imageExists });
  assert.equal(rules(r).includes('section'), true, JSON.stringify(r.problems));
});

test('#647 the lint reports a spec missing its Areas of concern section', () => {
  const r = load().lintDoc({ kind: 'spec', markdown: VALID_SPEC.replace('## Areas of concern\n\n- Anchor stability.\n\n', ''), exists: imageExists });
  assert.equal(rules(r).includes('section'), true, JSON.stringify(r.problems));
});

test('#647 the lint reports spec requirements that are not numbered R1, R2… in order', () => {
  const r = load().lintDoc({ kind: 'spec', markdown: VALID_SPEC.replace('**R2. Edit.**', '**R3. Edit.**'), exists: imageExists });
  assert.equal(rules(r).includes('requirements'), true, JSON.stringify(r.problems));
});

test('#647 the lint reports a decision with no Recommended line', () => {
  const r = load().lintDoc({ kind: 'spec', markdown: VALID_SPEC.replace('**Recommended:** the repository.\n', ''), exists: imageExists });
  assert.equal(rules(r).includes('recommended'), true, JSON.stringify(r.problems));
});

test('#647 the lint reports an image link whose file does not exist', () => {
  const r = load().lintDoc({ kind: 'spec', markdown: VALID_SPEC, exists: () => false });
  assert.equal(rules(r).includes('image'), true, JSON.stringify(r.problems));
});

// ---- lintTranslation ----------------------------------------------------------------------------

test('#647 an aligned source and translation have no translation problem', () => {
  assert.deepEqual(load().lintTranslation(VALID_SPEC, VALID_SPEC_PT), []);
});

test('#647 a translation missing a heading of the source is reported', () => {
  const pt = VALID_SPEC_PT.replace('## Áreas de atenção\n\n- Estabilidade das âncoras.\n\n', '');
  const problems = load().lintTranslation(VALID_SPEC, pt);
  assert.equal(problems.map((p) => p.rule).includes('translation'), true, JSON.stringify(problems));
});

test('#647 a translation whose requirement labels differ from the source is reported', () => {
  const pt = VALID_SPEC_PT.replace('**R2. Editar.**', '**R9. Editar.**');
  const problems = load().lintTranslation(VALID_SPEC, pt);
  assert.equal(problems.map((p) => p.rule).includes('translation'), true, JSON.stringify(problems));
});

// ---- setFrontMatter / replaceLines --------------------------------------------------------------

const FM_DOC = '---\nitem: demo\nstatus: draft\ndate: 2026-10-01\ntranslation: intent.pt-BR.md\n---\n\n# Intent\n\nstatus: draft is body text.\n';

test('#647 setFrontMatter replaces existing front-matter keys and leaves every other line as it was', () => {
  const out = load().setFrontMatter(FM_DOC, { status: 'accepted', date: '2026-10-31' });
  assert.equal(out, '---\nitem: demo\nstatus: accepted\ndate: 2026-10-31\ntranslation: intent.pt-BR.md\n---\n\n# Intent\n\nstatus: draft is body text.\n');
});

test('#647 setFrontMatter adds a missing key inside the front matter without touching the rest', () => {
  const out = load().setFrontMatter(FM_DOC, { approver: 'Eduardo Galbiati' });
  const lines = out.split('\n');
  const at = lines.indexOf('approver: Eduardo Galbiati');
  assert.equal(at > 0 && at < lines.indexOf('---', 1), true, out);
  assert.equal(lines.filter((l) => l !== 'approver: Eduardo Galbiati').join('\n'), FM_DOC);
});

test('#647 replaceLines swaps the given 1-based lines and keeps the others byte for byte', () => {
  const out = load().replaceLines('one\ntwo\nthree\nfour\n', { start: 2, end: 3 }, 'TWO\nTHREE\nEXTRA');
  assert.equal(out, 'one\nTWO\nTHREE\nEXTRA\nfour\n');
});

// ---- browser load -------------------------------------------------------------------------------

test('#647 in a page the module sets window.DocModel with its functions', () => {
  const sandbox = { console: { error() {}, log() {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(MODULE, 'utf8'), sandbox);
  const names = ['selectionPayload', 'lintDoc', 'lintTranslation', 'setFrontMatter', 'replaceLines'];
  assert.deepEqual(names.map((n) => typeof sandbox.DocModel?.[n]), ['function', 'function', 'function', 'function', 'function']);
});
