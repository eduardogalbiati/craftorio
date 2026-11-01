// Documents screen (#647/#671, views/docs/docs.js): the document's sections and the reader's page.
// outline(md, doc) → the headings and requirements with their anchors (the rule of DocModel's selection
// anchors: <doc>-<label key> for a requirement, <doc>-<heading slug> for a heading), a requirement with
// its label and its name ("R1 · Documents screen"), for the contents (living-doc.jpg) and the review
// notes. html(md, opts) → the reader's page: the body's blocks as siblings, each with data-src="<start>-<end>"
// (its lines in the source), headings without their #; no script runs in it (sandbox without
// allow-scripts). #671: the stage and file kicker on top, each heading and requirement with its anchor
// id, a requirement's #anchor shown beside it (not selectable); Preview leaves the kicker and the anchors out.
// Browser: window.DocsPage (app.js globals esc, markdownHtml; DocModel).
(function () {
  'use strict';

  function outline(md, doc) {
    if (!window.DocModel || !md) return [];
    const rows = md.split('\n');
    return window.DocModel.sections(md).filter((s) => s.title !== null || s.label).map((s) => {
      const first = s.blocks[0];
      const level = s.title !== null ? Math.min(6, (rows[first.start - 1].match(/^#+/) || ['##'])[0].length) : 7;
      return { ...s, id: s.label ? `${doc}-${s.key}` : `${doc}-${s.slug}`, level, text: s.label ? [s.label.toUpperCase(), s.name].filter(Boolean).join(' · ') : s.title, first }; // i18n-ignore
    });
  }

  function html(md, { doc = 'doc', kicker = '', preview = false, source = false } = {}) {
    const rows = String(md || '').split('\n');
    const ids = new Map(outline(md || '', doc).map((s) => [s.first.start, s]));
    const body = source ? `<pre class="src">${esc(md || '')}</pre>` : (window.DocModel ? window.DocModel.blocks(md || '') : []).map((b) => {
      const src = `${b.start}-${b.end}`;
      const sec = ids.get(b.start);
      const id = sec ? ` id="${esc(sec.id)}"` : '';
      if (b.heading !== null) {
        const level = Math.min(6, (rows[b.start - 1].match(/^#+/) || ['##'])[0].length);
        return `<h${level}${id} data-src="${src}">${esc(b.heading)}</h${level}>`;
      }
      const text = rows.slice(b.start - 1, b.end).join('\n');
      const anchor = sec?.label && !preview ? `<span class="anc" aria-hidden="true">#${esc(sec.id)}</span>` : '';
      return `${anchor}<div class="blk${sec?.label ? ' req' : ''}"${id} data-src="${src}">${typeof markdownHtml === 'function' ? markdownHtml(text) : esc(text)}</div>`;
    }).join('\n');
    let css = '';
    try {
      const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      css = `body{background:${v('--panel')};color:${v('--text')};font:13px/1.55 system-ui,sans-serif;margin:16px 20px;max-width:760px}h1,h2,h3{margin:18px 0 6px}.blk>*{margin:0 0 8px}code{font-family:${v('--mono')}}::selection{background:${v('--accent')};color:${v('--bg')}}.kicker{font:11px ${v('--mono')};letter-spacing:.08em;text-transform:uppercase;color:${v('--accent')};margin:0 0 8px}.anc{float:right;font:11px ${v('--mono')};color:${v('--muted')};user-select:none;margin-left:8px}.req{border-left:2px solid ${v('--border')};padding-left:10px}.src{white-space:pre-wrap;font:12px/1.5 ${v('--mono')}}`; // i18n-ignore
    } catch { /* the default look */ }
    const top = kicker && !preview ? `<p class="kicker" aria-hidden="true">${esc(kicker)}</p>` : '';
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>${css}</style></head><body>${top}${body}</body></html>`; // i18n-ignore
  }

  window.DocsPage = {
    html,
    outline,
  };
})();
