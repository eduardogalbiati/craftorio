// Documents screen (#671, views/docs/docs.js): the Diff tab's page of one change by request (mock-3,
// spec R11 "only in the sections it touched"). compare(before, after) pairs the sections of the source
// before the change and at it (DocModel.sections, by key) and diffs each touched one word by word;
// cards(...) draws the list of changes by request (one versioned card each, mock-3's left column);
// panel(...) draws the change's head (v<n-1> → v<n>, the file, the request, Undo this change, Mark
// reviewed), the touched sections highlighted with their insertions and deletions, their neighbours
// greyed out ("Unchanged in this request") and the footnote. The clicks are docs.js's (data-docs-*).
// Browser: window.DocsDiff (markup with app.js globals esc, t); Node: module.exports (compare, words).
(function (root) {
  'use strict';

  // past this many token pairs a section is shown as removed then added (no word diff)
  const MAX_PAIRS = 250000;

  // [{ op: '=' | '+' | '-', text }]: the words (and the spaces between them) of a and b, longest
  // common subsequence, neighbouring parts of the same op joined
  function words(a, b) {
    const x = String(a || '').split(/(\s+)/).filter(Boolean);
    const y = String(b || '').split(/(\s+)/).filter(Boolean);
    const out = [];
    const push = (op, text) => {
      const last = out[out.length - 1];
      if (last && last.op === op) last.text += text;
      else out.push({ op, text });
    };
    if (x.length * y.length > MAX_PAIRS) {
      if (x.length) push('-', x.join(''));
      if (y.length) push('+', y.join(''));
      return out;
    }
    const n = x.length;
    const m = y.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { push('=', x[i]); i += 1; j += 1; } else if (lcs[i + 1][j] >= lcs[i][j + 1]) { push('-', x[i]); i += 1; } else { push('+', y[j]); j += 1; }
    }
    while (i < n) { push('-', x[i]); i += 1; }
    while (j < m) { push('+', y[j]); j += 1; }
    return out;
  }

  // a section's body: its lines without its heading, and without the bold label of a requirement
  function body(md, sec) {
    const rows = md.split('\n');
    const text = sec.blocks.filter((b) => b.heading === null).map((b) => rows.slice(b.start - 1, b.end).join('\n')).join('\n\n');
    return sec.label ? text.replace(/^\*\*[^*]*\*\*\s*/, '') : text;
  }
  const whole = (md, sec) => {
    const rows = md.split('\n');
    return sec.blocks.map((b) => rows.slice(b.start - 1, b.end).join('\n')).join('\n\n');
  };

  // [{ key, title, label, name, slug, touched, removed, near, parts }] in the order of the source at the
  // change, a removed section after its predecessor; near: a neighbour of a touched one (shown greyed)
  function compare(before, after, model) {
    const M = model || root.DocModel;
    const was = M.sections(before || '');
    const now = M.sections(after || '');
    const old = new Map(was.map((s) => [s.key, s]));
    const keys = new Set(now.map((s) => s.key));
    const out = [];
    for (const s of now) {
      const prev = old.get(s.key);
      const touched = !prev || whole(before, prev) !== whole(after, s);
      out.push({ ...s, touched, removed: false, parts: touched ? words(prev ? body(before, prev) : '', body(after, s)) : null });
    }
    was.forEach((s, i) => {
      if (keys.has(s.key)) return;
      const at = out.findIndex((x) => x.key === was[i - 1]?.key);
      out.splice(at + 1, 0, { ...s, touched: true, removed: true, parts: words(body(before, s), '') });
    });
    return out.map((s, i) => ({ ...s, near: !s.touched && (!!out[i - 1]?.touched || !!out[i + 1]?.touched) }));
  }

  if (typeof module === 'object' && module.exports) { module.exports = { compare, words }; return; }

  const headOf = (s) => (s.label ? [s.label.toUpperCase(), s.name].filter(Boolean).join(' · ') : s.title || ''); // i18n-ignore
  const partHtml = (p) => {
    if (p.op === '+') return `<ins>${esc(p.text)}</ins>`;
    if (p.op === '-') return `<del>${esc(p.text)}</del>`;
    return esc(p.text);
  };

  // the sections of one change: { sections } once read, { loading } or { error } before
  function pageHtml({ doc, diff }) {
    if (!diff) return '';
    if (diff.error) return `<p class="error small">${esc(diff.error)}</p>`;
    if (diff.loading) return `<p class="muted small" role="status"><span class="spinner" aria-hidden="true"></span> ${t('docs.reading_the_change')}</p>`;
    const shown = diff.sections.filter((s) => s.touched || s.near);
    if (!shown.length) return `<p class="muted small">${t('docs.no_section_changed')}</p>`;
    return shown.map((s) => {
      const anchor = s.label ? `${doc}-${s.key}` : s.slug ? `${doc}-${s.slug}` : '';
      return `
        <section class="docs-diff-sec${s.touched ? ' touched' : ' same'}${s.removed ? ' removed' : ''}" data-testid="doc-diff-section">
          ${anchor ? `<span class="docs-diff-anc">#${esc(anchor)}</span>` : ''}
          ${headOf(s) ? `<h4>${esc(headOf(s))}</h4>` : ''}
          ${s.touched ? `<p class="docs-diff-body">${s.parts.map(partHtml).join('')}</p>` : `<p class="muted small">${t('docs.unchanged_in_this_request')}</p>`}
        </section>`;
    }).join('');
  }

  // the changes by request, newest first: one card per change with its version, its quoted request and
  // its review state (the open one marked), the unreviewed count, the lint problems after the last one
  function cards({ list, open, unreviewed, problems }) {
    const pending = list.filter((c) => unreviewed.includes(c.commit)).length;
    const card = (c, i) => {
      const todo = unreviewed.includes(c.commit);
      return `
        <li class="docs-change${todo ? ' unreviewed' : ''}${c === open ? ' open' : ''}" data-testid="doc-change" data-docs-change="${esc(c.commit)}">
          <div class="docs-change-top">
            <b>v${i + 2}</b>
            <span class="docs-pill${todo ? ' editing' : ' done'}" data-testid="doc-change-state">${todo ? t('docs.change_unreviewed') : t('docs.change_reviewed')}</span>
          </div>
          <span class="docs-change-text" title="${esc(c.subject)}">“${esc(c.subject)}”</span>
          <span class="mono muted small" title="${esc(c.commit)}">${esc(String(c.commit).slice(0, 8))}</span>
        </li>`; // i18n-ignore
    };
    return `
      <div class="docs-section-head">
        <h3>${t('docs.changes_by_request')}</h3>
        <span class="badge${pending ? ' warn' : ''}" data-testid="doc-unreviewed-count">${t('docs.unreviewed_count', { count: pending })}</span>
      </div>
      ${list.length ? `<ol class="docs-change-list">${list.map(card).reverse().join('')}</ol>` : `<p class="muted small">${t('docs.no_change_yet')}</p>`}
      ${problems.length ? `<p class="small muted" title="${esc(problems.join('\n'))}">${t('docs.lint_problems_count', { count: problems.length })}</p>` : ''}`;
  }

  // the change's head and actions, its page and the footnote
  function panel({ doc, from, to, file, subject, commit, canUndo, unreviewed, diff }) {
    return `
      <div class="docs-change-detail" data-testid="doc-change-detail">
        <div class="docs-diff-head">
          <b class="docs-diff-title" title="${esc(subject)}">v${from} → v${to} · <span class="mono">${esc(file)}</span> · “${esc(subject)}”</b>
          <span class="spacer"></span>
          ${canUndo ? `<button type="button" class="btn sm ghost" data-testid="doc-undo-change" data-docs-undo="${esc(commit)}">${t('docs.undo_this_change')}</button>` : ''}
          ${unreviewed && canUndo ? `<button type="button" class="btn sm primary" data-testid="doc-mark-reviewed" data-docs-reviewed="${esc(commit)}">${t('docs.mark_reviewed')}</button>` : ''}
        </div>
        <div class="docs-diff-page">${pageHtml({ doc, diff })}</div>
        <p class="muted small">${t('docs.only_the_sections_this_request_touched')}</p>
      </div>`; // i18n-ignore
  }

  root.DocsDiff = {
    cards,
    compare,
    panel,
    words,
  };
})(typeof window !== 'undefined' ? window : globalThis);
