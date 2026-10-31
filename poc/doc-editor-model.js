// Write doc, phase 0 (#646, docs/work/write-doc/spec.md R4, R8, R9): the payload a selection in the
// document reader hands the chat. A spike: phase 1 moves it to packages/shared/doc-model.js. Pure:
// it reads no file and no DOM, it gets the markdown as strings.
// - selectionPayload({ selection: { file, src, text }, source: { file, markdown },
//   translation: { file, markdown } }): { file, anchor, lines: { start, end }, passage,
//   context: { before, after }, version }, always about the English source:
//   - selection.src is the block's data-src ("41-52"), in the file the person selected in;
//   - a selection in the source: the selected text when the block holds it, else the whole block;
//   - a selection in the translation maps to the source: same section (a heading by its order, a
//     **R2.** / **D3.** paragraph by its label), the block of the same order inside it, or the
//     whole source section when the two sections do not have the same number of blocks;
//   - anchor: <doc>-r2 for a labelled section, <doc>-<slug of the English heading> for a heading;
//   - context: up to 200 characters of the source on each side of the passage;
//   - version: a hash of the source markdown (FNV-1a, 32 bits, hex), the same from both languages.
// - blocks(markdown): [{ start, end, heading }], the runs of non-empty lines (a heading is a block
//   on its own), front matter left out; lines are 1-based.
// - sections(markdown, blocks): [{ key, title, label, blocks }], a new one at each heading and each
//   labelled paragraph.
// - version(markdown): the hash above.
// Browser: window.DocEditorModel; Node: module.exports (the tests).
(function (root) {
  'use strict';

  const CONTEXT = 200;
  const HEADING = /^#{1,6} /;
  const LABEL = /^\*\*([RD]\d+)\./;

  // [{ text, offset }] per line, offsets into the raw markdown (a trailing \r stays out of text).
  function lines(markdown) {
    const out = [];
    let offset = 0;
    for (const raw of markdown.split('\n')) {
      out.push({ text: raw.replace(/\r$/, ''), offset });
      offset += raw.length + 1;
    }
    return out;
  }

  function frontMatterEnd(rows) {
    if (!rows.length || rows[0].text !== '---') return 0;
    for (let i = 1; i < rows.length; i += 1) if (rows[i].text === '---') return i + 1;
    return 0;
  }

  function blocks(markdown) {
    const rows = lines(markdown);
    const out = [];
    let current = null;
    for (let i = frontMatterEnd(rows); i < rows.length; i += 1) {
      const text = rows[i].text;
      if (!text.trim()) { current = null; continue; }
      if (HEADING.test(text)) {
        out.push({ start: i + 1, end: i + 1, heading: text.replace(/^#+\s*/, '').trim() });
        current = null;
        continue;
      }
      if (current) current.end = i + 1;
      else { current = { start: i + 1, end: i + 1, heading: null }; out.push(current); }
    }
    return out;
  }

  // The key matches a section across languages: h<order> for a heading, the label for a paragraph.
  function sections(markdown, list = blocks(markdown)) {
    const rows = lines(markdown);
    const out = [];
    const seen = {};
    let headings = 0;
    let current = null;
    for (const block of list) {
      const label = block.heading === null && (rows[block.start - 1].text.match(LABEL) || [])[1];
      if (block.heading !== null || label || !current) {
        let key = 'top';
        if (block.heading !== null) { headings += 1; key = `h${headings}`; } else if (label) key = label.toLowerCase();
        seen[key] = (seen[key] || 0) + 1;
        if (seen[key] > 1) key = `${key}-${seen[key]}`;
        current = { key, title: block.heading, label: label ? label.toLowerCase() : null, blocks: [] };
        out.push(current);
      }
      current.blocks.push(block);
    }
    return out;
  }

  function version(markdown) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < markdown.length; i += 1) {
      hash ^= markdown.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  function slug(text) {
    return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function docName(file) {
    return String(file).split('/').pop().replace(/\.md$/, '');
  }

  function anchor(file, section) {
    const doc = docName(file);
    if (section.label) return `${doc}-${section.key}`;
    if (section.title) return `${doc}-${slug(section.title)}`;
    return doc;
  }

  // { section, index } of the block that holds the line.
  function locate(list, line) {
    for (const section of list) {
      const index = section.blocks.findIndex((b) => b.start <= line && line <= b.end);
      if (index >= 0) return { section, index };
    }
    return null;
  }

  function span(rows, start, end) {
    const from = rows[start - 1].offset;
    const to = rows[end - 1].offset + rows[end - 1].text.length;
    return { offset: from, length: to - from };
  }

  function selectionPayload({ selection, source, translation }) {
    const inTranslation = translation && selection.file === translation.file;
    const selected = inTranslation ? translation.markdown : source.markdown;
    const line = Number(String(selection.src).split('-')[0]);
    const selectedSections = sections(selected);
    const found = locate(selectedSections, line);
    if (!found) throw new Error(`no block at line ${line} of ${selection.file}`);

    const md = source.markdown;
    const rows = lines(md);
    const sourceSections = sections(md);
    const target = inTranslation
      ? sourceSections.find((s) => s.key === found.section.key) || sourceSections[selectedSections.indexOf(found.section)]
      : found.section;
    if (!target) throw new Error(`no source section for ${found.section.key} in ${source.file}`);

    let start;
    let end;
    let at;
    if (!inTranslation) {
      const block = found.section.blocks[found.index];
      ({ start, end } = block);
      at = span(rows, start, end);
      const inside = selection.text ? md.slice(at.offset, at.offset + at.length).indexOf(selection.text) : -1;
      if (inside >= 0) at = { offset: at.offset + inside, length: selection.text.length };
    } else if (target.blocks.length === found.section.blocks.length || (found.index === 0 && found.section.title !== null)) {
      // Aligned by order; a heading always maps to its heading, whatever follows it.
      ({ start, end } = target.blocks[found.index]);
      at = span(rows, start, end);
    } else {
      start = target.blocks[0].start;
      end = target.blocks[target.blocks.length - 1].end;
      at = span(rows, start, end);
    }

    return {
      file: source.file,
      anchor: anchor(source.file, target),
      lines: { start, end },
      passage: md.slice(at.offset, at.offset + at.length),
      context: {
        before: md.slice(Math.max(0, at.offset - CONTEXT), at.offset),
        after: md.slice(at.offset + at.length, at.offset + at.length + CONTEXT),
      },
      version: version(md),
    };
  }

  const api = {
    blocks,
    sections,
    selectionPayload,
    version,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DocEditorModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
