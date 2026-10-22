// How the documents and files runs produce are drawn on every screen (the Artifacts screen and
// panel, the run lists, the chats, the supervisor): the kind badge (artKindIcon), sizes, sanitized
// markdown (markdownHtml: marked + DOMPurify, escaped text without them), highlighted JSON and
// TSV / CSV tables.

// Artifacts: documents and files produced by runs, as the Artifacts screen (views/artifacts/), the
// run lists and the Artifacts panel show them
const ART_KIND = { markdown: ['MD', 'k-md'], json: ['{ }', 'k-json'], table: ['TSV', 'k-table'], text: ['TXT', 'k-text'], image: ['IMG', 'k-image'], other: ['FILE', 'k-other'] };
const artKindIcon = (kind) => { const [l, c] = ART_KIND[kind] || ART_KIND.other; return `<span class="art-kind ${c}">${l}</span>`; };
function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ---- markdown ----
let mdHooked = false;
// #466: untrusted HTML keeps no form or form control (a click would navigate the window to a local page)
const PURIFY = {
  FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'style'],
  FORBID_ATTR: ['action', 'formaction'],
};
function sanitizeHtml(html) {
  if (!mdHooked) {
    mdHooked = true;
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A' && node.getAttribute('href') && !node.getAttribute('href').startsWith('#')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }
  return DOMPurify.sanitize(html, PURIFY);
}

const slugify = (s) => String(s).toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');

// Sanitized markdown -> HTML string (escaped text when the libraries are missing).
function markdownHtml(text) {
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') return `<pre class="art-code">${esc(text)}</pre>`;
  const tmp = document.createElement('div');
  tmp.innerHTML = sanitizeHtml(marked.parse(String(text || ''), { gfm: true }));
  // wide tables scroll on their own
  tmp.querySelectorAll('table').forEach((t) => { const w = document.createElement('div'); w.className = 'md-table'; t.replaceWith(w); w.appendChild(t); });
  return tmp.innerHTML;
}

// ---- JSON ----
function highlightJson(src) {
  const re = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index));
    if (m[1]) out += m[2] ? `<span class="j-key">${esc(m[1])}</span>${esc(m[2])}` : `<span class="j-str">${esc(m[1])}</span>`;
    else if (m[3]) out += `<span class="j-${m[3] === 'null' ? 'null' : 'bool'}">${m[3]}</span>`;
    else out += `<span class="j-num">${m[4]}</span>`;
    last = re.lastIndex;
  }
  return out + esc(src.slice(last));
}

function renderJsonText(text, lines) {
  if (lines) {
    return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
      try { return highlightJson(JSON.stringify(JSON.parse(l), null, 2)); } catch { return esc(l); }
    }).join('\n<span class="j-sep"></span>\n');
  }
  try { return highlightJson(JSON.stringify(JSON.parse(text), null, 2)); } catch { return esc(text); }
}

// ---- TSV / CSV ----
function parseDelimited(text, sep) {
  const rows = [];
  if (sep === '\t') return text.split(/\r?\n/).filter((l) => l.length).map((l) => l.split('\t'));
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function renderDelimited(text, sep) {
  const rows = parseDelimited(text, sep);
  if (!rows.length) return `<div class="art-empty muted">${t('artifact_render.empty_file')}</div>`;
  const MAX = 2000;
  const [head, ...rest] = rows;
  return `<div class="md-table art-table"><table>
    <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rest.slice(0, MAX).map((r) => `<tr>${head.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>${rest.length > MAX ? `<p class="muted small art-pad">${t('artifact_render.showing_the_first_max_of_length', { MAX, length: rest.length })}</p>` : ''}`;
}
