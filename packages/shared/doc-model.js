// Write doc (#647, docs/work/write-doc/spec.md R2, R3, R5, R9, R13): the pure rules of the document
// editor, promoted from the phase-0 spike (poc/doc-editor-model.js). It reads no file and no DOM: it
// gets the markdown as strings.
// - selectionPayload({ selection: { file, src, text }, source: { file, markdown },
//   translation: { file, markdown } }): { file, anchor, lines: { start, end }, passage,
//   context: { before, after }, version }, always about the English source:
//   - selection.src is the block's data-src ("41-52"), in the file the person selected in;
//   - a selection in the source: the selected text when the block holds it, else the whole block;
//   - a selection in the translation maps to the source: same section (a heading by its order, a
//     **R2.** / **D3.** paragraph by its label), the block of the same order inside it, or the
//     whole source section when the two sections do not have the same number of blocks;
//   - anchor: <doc>-r2 for a labelled section, <doc>-<slug of the English heading> for a heading
//     (a repeated heading gets -2, -3…);
//   - context: up to 200 characters of the source on each side of the passage;
//   - version: a hash of the source markdown (FNV-1a, 32 bits, hex), the same from both languages.
// - blocks(markdown): [{ start, end, heading }], the runs of non-empty lines (a heading is a block on
//   its own, a fenced code block is one block whatever its empty lines), front matter left out; 1-based.
// - sections(markdown, blocks): [{ key, title, label, name, slug, blocks }], a new one at each heading
//   and each labelled paragraph; name: the bold text after the label ("**R1. Documents.**" → Documents).
// - lintDoc({ kind: 'intent' | 'spec' | 'plan' (#633), markdown, exists? }): { ok, problems: [{ rule, message, line? }] },
//   rules front-matter, section (the playbook's sections, English source only), requirements (R1, R2…
//   in order), recommended (a decision without its **Recommended:** line), image (a missing file).
// - lintTranslation(sourceMd, translationMd): [{ rule: 'translation', message }] when the headings or
//   the labels of the pair differ.
// - frontMatter(markdown): { key: value } of the front matter.
// - setFrontMatter(markdown, fields): those keys replaced or added, every other line unchanged.
// - replaceLines(markdown, { start, end }, text): 1-based inclusive lines replaced, the rest unchanged.
// - version(markdown): the hash above.
// - itemName(title): a work item's folder name (accents dropped, lowercase, a-z0-9 runs joined by '-', 100 characters).
// - alignedLines(sourceMd, translationMd, { start }): { start, end } of the translation that match
//   the source block at that line (the alignment rule above, source to translation), null without a match.
// - ACCEPTED: { intent: 'accepted', spec: 'signed off', plan: 'accepted' }, the status past the SDLC gate.
// Browser: window.DocModel; Node: module.exports.
(function (root) {
  'use strict';

  const CONTEXT = 200;
  const HEADING = /^(#{1,6}) /;
  const LABEL = /^\*\*([RD]\d+)\./;
  // the label and its bold name, "**R1. Documents screen.**"
  const LABEL_NAME = new RegExp(`${LABEL.source}\\s*([^*]*?)\\.?\\s*\\*\\*`);
  const FENCE = /^\s*(```|~~~)/;
  const SECTIONS = {
    intent: ['Problem', 'Proposed outcome', 'Affected users and systems', 'Constraints', 'Open questions'],
    spec: ['Requirements', 'Design', 'Areas of concern', 'Open questions'],
    // #633: the plan (skills/plan-writing), the developer's brief replaced
    plan: ['Files that change', 'Order of work', 'Risks', 'Proof'],
  };
  const FRONT_MATTER_KEYS = ['item', 'stage', 'status', 'date'];
  // the status of a document past its SDLC gate (Accept intent, Sign off spec, #633 Accept plan)
  const ACCEPTED = { intent: 'accepted', spec: 'signed off', plan: 'accepted' };
  const RECOMMENDED = /\*\*(Recommended|Recomendado):\*\*/;
  const IMAGE = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

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

  // The body's lines with their 1-based number and whether they sit inside a fenced code block.
  function bodyRows(markdown) {
    const rows = lines(markdown);
    const out = [];
    let fenced = false;
    for (let i = frontMatterEnd(rows); i < rows.length; i += 1) {
      const fence = FENCE.test(rows[i].text);
      out.push({ text: rows[i].text, line: i + 1, fenced: fenced || fence });
      if (fence) fenced = !fenced;
    }
    return out;
  }

  function blocks(markdown) {
    const out = [];
    let current = null;
    for (const row of bodyRows(markdown)) {
      const { text } = row;
      if (!row.fenced && !text.trim()) { current = null; continue; }
      if (!row.fenced && HEADING.test(text)) {
        out.push({ start: row.line, end: row.line, heading: text.replace(/^#+\s*/, '').trim() });
        current = null;
        continue;
      }
      if (current) current.end = row.line;
      else { current = { start: row.line, end: row.line, heading: null }; out.push(current); }
    }
    return out;
  }

  // The key matches a section across languages: h<order> for a heading, the label for a paragraph.
  function sections(markdown, list = blocks(markdown)) {
    const rows = lines(markdown);
    const out = [];
    const seen = {};
    const slugs = {};
    let headings = 0;
    let current = null;
    for (const block of list) {
      const label = block.heading === null && (rows[block.start - 1].text.match(LABEL) || [])[1];
      if (block.heading !== null || label || !current) {
        let key = 'top';
        let headingSlug = null;
        if (block.heading !== null) {
          headings += 1;
          key = `h${headings}`;
          headingSlug = slug(block.heading);
          slugs[headingSlug] = (slugs[headingSlug] || 0) + 1;
          if (slugs[headingSlug] > 1) headingSlug = `${headingSlug}-${slugs[headingSlug]}`;
        } else if (label) key = label.toLowerCase();
        seen[key] = (seen[key] || 0) + 1;
        if (seen[key] > 1) key = `${key}-${seen[key]}`;
        const name = label ? ((rows[block.start - 1].text.match(LABEL_NAME) || [])[2] || '').trim() || null : null;
        current = { key, title: block.heading, label: label ? label.toLowerCase() : null, name, slug: headingSlug, blocks: [] };
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

  // A work item's folder name (docs/work/<item>/) from its title: the Documents' New item and Discovery's Shape card (#648)
  function itemName(title) {
    return slug(title).slice(0, 100).replace(/-+$/, '');
  }

  function docName(file) {
    return String(file).split('/').pop().replace(/\.md$/, '');
  }

  function anchor(file, section) {
    const doc = docName(file);
    if (section.label) return `${doc}-${section.key}`;
    if (section.title) return `${doc}-${section.slug}`;
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

  // The lines in the other language's section of the block found in this one: aligned by order (a
  // heading always maps to its heading, whatever follows it), else the whole section.
  function alignedBlock(found, target) {
    if (target.blocks.length === found.section.blocks.length || (found.index === 0 && found.section.title !== null)) {
      const { start, end } = target.blocks[found.index];
      return { start, end };
    }
    return { start: target.blocks[0].start, end: target.blocks[target.blocks.length - 1].end };
  }

  // The translation's lines that match these source lines (the rule above), null without a match.
  function alignedLines(sourceMd, translationMd, { start }) {
    const found = locate(sections(sourceMd), Number(start));
    const target = found && sections(translationMd).find((s) => s.key === found.section.key);
    return target ? alignedBlock(found, target) : null;
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
    } else {
      ({ start, end } = alignedBlock(found, target));
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

  function frontMatter(markdown) {
    const rows = lines(markdown);
    const end = frontMatterEnd(rows);
    const out = {};
    for (let i = 1; i < end - 1; i += 1) {
      const at = rows[i].text.indexOf(':');
      if (at > 0) out[rows[i].text.slice(0, at).trim()] = rows[i].text.slice(at + 1).trim();
    }
    return out;
  }

  // [{ level, text, line }] and [{ label, line }] of the body, fenced code left out.
  function outline(markdown) {
    const headings = [];
    const labels = [];
    for (const row of bodyRows(markdown)) {
      if (row.fenced) continue;
      const h = row.text.match(HEADING);
      if (h) headings.push({ level: h[1].length, text: row.text.replace(/^#+\s*/, '').trim(), line: row.line });
      const l = row.text.match(LABEL);
      if (l) labels.push({ label: l[1], line: row.line });
    }
    return { headings, labels };
  }

  function lintDoc({ kind, markdown, exists }) {
    const problems = [];
    const fields = frontMatter(markdown);
    const hasFrontMatter = frontMatterEnd(lines(markdown)) > 0;
    if (!hasFrontMatter) problems.push({ rule: 'front-matter', message: 'the document has no front matter', line: 1 });
    else {
      for (const key of FRONT_MATTER_KEYS) {
        if (!fields[key]) problems.push({ rule: 'front-matter', message: `the front matter has no ${key}`, line: 1 });
      }
      if (!fields.translation && !fields.source) {
        problems.push({ rule: 'front-matter', message: 'the front matter names neither its translation nor its source', line: 1 });
      }
    }

    const { headings, labels } = outline(markdown);
    // A translation's headings are checked against its source by lintTranslation.
    if (!fields.source) {
      const titles = headings.filter((h) => h.level === 2).map((h) => h.text);
      for (const name of SECTIONS[kind] || []) {
        if (!titles.includes(name)) problems.push({ rule: 'section', message: `the ${kind} has no "${name}" section` });
      }
    }

    labels.filter((l) => l.label[0] === 'R').forEach((l, i) => {
      if (l.label !== `R${i + 1}`) problems.push({ rule: 'requirements', message: `requirement ${l.label} should be R${i + 1}`, line: l.line });
    });

    const body = bodyRows(markdown);
    body.forEach((row, i) => {
      if (row.fenced || !/^\*\*D\d+\./.test(row.text)) return;
      let recommended = RECOMMENDED.test(row.text);
      for (let j = i + 1; !recommended && j < body.length; j += 1) {
        const next = body[j];
        if (!next.fenced && (HEADING.test(next.text) || LABEL.test(next.text))) break;
        recommended = RECOMMENDED.test(next.text);
      }
      if (!recommended) {
        problems.push({ rule: 'recommended', message: `decision ${row.text.match(LABEL)[1]} has no **Recommended:** line`, line: row.line });
      }
    });

    if (typeof exists === 'function') {
      for (const row of body) {
        if (row.fenced) continue;
        for (const match of row.text.matchAll(IMAGE)) {
          const target = match[1];
          if (/^[a-z]+:/i.test(target)) continue;
          if (!exists(target)) problems.push({ rule: 'image', message: `the image ${target} does not exist`, line: row.line });
        }
      }
    }
    return { ok: problems.length === 0, problems };
  }

  function lintTranslation(sourceMd, translationMd) {
    const source = outline(sourceMd);
    const translation = outline(translationMd);
    const problems = [];
    const levels = (o) => o.headings.map((h) => h.level).join(',');
    if (levels(source) !== levels(translation)) {
      problems.push({ rule: 'translation', message: `the translation has ${translation.headings.length} headings, the source ${source.headings.length} (or their levels differ)` });
    }
    const names = (o) => o.labels.map((l) => l.label).join(',');
    if (names(source) !== names(translation)) {
      problems.push({ rule: 'translation', message: `the translation's labels (${names(translation)}) differ from the source's (${names(source)})` });
    }
    return problems;
  }

  function setFrontMatter(markdown, fields) {
    const rows = markdown.split('\n');
    const end = frontMatterEnd(lines(markdown));
    const entries = Object.entries(fields);
    if (!end) return ['---', ...entries.map(([k, v]) => `${k}: ${v}`), '---', ...rows].join('\n');
    const missing = [];
    for (const [key, value] of entries) {
      const at = rows.findIndex((row, i) => i > 0 && i < end - 1 && row.replace(/\r$/, '').startsWith(`${key}:`));
      if (at > 0) rows[at] = `${key}: ${value}${rows[at].endsWith('\r') ? '\r' : ''}`;
      else missing.push(`${key}: ${value}`);
    }
    rows.splice(end - 1, 0, ...missing);
    return rows.join('\n');
  }

  function replaceLines(markdown, { start, end }, text) {
    const rows = markdown.split('\n');
    rows.splice(start - 1, end - start + 1, ...String(text).split('\n'));
    return rows.join('\n');
  }

  const api = {
    ACCEPTED,
    alignedLines,
    blocks,
    frontMatter,
    itemName,
    lintDoc,
    lintTranslation,
    replaceLines,
    sections,
    selectionPayload,
    setFrontMatter,
    version,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DocModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
