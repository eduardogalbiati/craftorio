// Documents screen (#647/#671, views/docs/docs.js): the document's sections and the reader's page.
// outline(md, doc) → the headings and requirements with their anchors (the rule of DocModel's selection
// anchors: <doc>-<label key> for a requirement, <doc>-<heading slug> for a heading), a requirement with
// its label and its name ("R1 · Documents screen"), for the contents (living-doc.jpg) and the review
// notes. html(md, opts) → the reader's page: the body's blocks as siblings, each with data-src="<start>-<end>"
// (its lines in the source), headings without their #; no script runs in it (sandbox without
// allow-scripts). #671: the stage and file kicker on top, each heading and requirement with its anchor
// id, a requirement's #anchor shown beside it (not selectable); Preview leaves the kicker and the anchors out.
// #650 mocks(md) → the document's ```html mock blocks; mockFrame(html, { title }) → the <iframe> that runs
// one in an opaque origin (sandbox allow-scripts only, a CSP without network), drawn under the reader;
// mountMocks(box, markup) loads each one's page through docs-mock.html (its own CSP, not the app's).
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

  // #650 (spec R16) the interactive mocks: each fenced block of the document whose info string is
  // `html mock [title]` → { title, html }, drawn under the reader by mockFrame
  function mocks(md) {
    const out = [];
    const rows = String(md || '').split('\n');
    for (let i = 0; i < rows.length; i += 1) {
      const open = /^(```+|~~~+)\s*html\s+mock\b\s*(.*)$/i.exec(rows[i]);
      if (!open) continue;
      const end = rows.findIndex((l, j) => j > i && l.trim().startsWith(open[1]));
      const stop = end < 0 ? rows.length : end;
      out.push({ title: open[2].trim() || `Mock ${out.length + 1}`, html: rows.slice(i + 1, stop).join('\n') }); // i18n-ignore
      i = stop;
    }
    return out;
  }

  // #650 a mock's page in an opaque origin: its scripts run (allow-scripts) but without allow-same-origin
  // it reaches no window.api, no parent DOM and no storage of the app; the CSP allows no network. The
  // whole page goes through esc() into srcdoc, so a `</iframe>` in the mock stays text of the attribute.
  function mockFrame(markup, { title = '' } = {}) {
    const page = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"></head><body>${String(markup || '')}</body></html>`; // i18n-ignore
    return `<iframe class="docs-mock" sandbox="allow-scripts" title="${esc(title)}" srcdoc="${esc(page)}"></iframe>`; // i18n-ignore
  }

  // #650 an about:srcdoc page inherits the app's CSP (script-src 'self'): its scripts would not run. So
  // mountMocks(box, markup) puts the markup in `box` with each mock frame's page moved from srcdoc into
  // the fragment of docs-mock.html (a real document with its own CSP, next to this file), before any
  // frame loads (the frames are built in an inert <template>). The sandbox stays allow-scripts only.
  const MOCK_SHELL = (() => {
    try { return new URL('docs-mock.html', document.currentScript.src).href; } catch { return null; }
  })();
  function mountMocks(box, markup) {
    const tpl = document.createElement('template');
    tpl.innerHTML = markup;
    if (MOCK_SHELL) {
      for (const frame of tpl.content.querySelectorAll('iframe.docs-mock[srcdoc]')) {
        frame.setAttribute('src', `${MOCK_SHELL}#${encodeURIComponent(frame.getAttribute('srcdoc'))}`);
        frame.removeAttribute('srcdoc');
      }
    }
    box.replaceChildren(tpl.content);
  }

  window.DocsPage = {
    html,
    mockFrame,
    mocks,
    mountMocks,
    outline,
  };
})();
