// Project mockups (#625, Plan & Design › Mockups): the pure rules of a project's mockups, no fs and no
// Electron. FRAMES (Q-5: desktop 1440, tablet 768, phone 390) and DEFAULT_FRAME; slugify(title) (a
// screen's folder, DocModel's slug, never empty); addMids(html) (data-mid="m<n>" on every element of the
// body, the existing ones kept, idempotent: what the inspector returns on a click); buildChatMessage(...)
// (what goes with each designer chat message: mockup, version, frame, selection, area, refs, message);
// lintMockup({ html, css, tokens }) (the free kit lint of every turn, D11: raw-color, unknown-token,
// large-script); estimateCost(action) (D15, shown before every real action, USD); extractTokens(files)
// and tokensCss(tokens) (the deterministic machine step of the kit, D2); draftScreen({ title, prompt })
// (the simulated designer's first version of a screen, static HTML importing the kit, D4); ACTIONS (COSTS'
// keys); parseDesignerReply(text) → { reply, html } (a designer turn's prose and its last ```html block, D8);
// chatCostUsd(entries) (Q-8: a screen's designer chat total). #835: diffMids(before, after) (the data-mids
// whose element changed, was added or removed, sorted: Compare); normalizeFlow({ name, links }, screens?)
// (flows/<name>.json: [{ from: { screen, mid }, to }], a slug-like name, known screens) and
// flowTarget(flow, screen, mid) (Interact mode: the target screen or null); esc (HTML escape); COLOR;
// SLUG (a screen's, variant's or flow's name) and COMMIT (a version's sha), the one copy of each rule;
// attachmentName / parseAttachmentName ('<slug>@<sha7>.mockup.json', a Discovery card's frozen version),
// frozenThumbnail(name, text) (the thumbnail stored in that attachment: what discovery:attachment shows)
// and attachmentThumbnail({ title, commit }) (its SVG data URL).
// Browser: window.MockupModel; Node: module.exports. The domain is fronts/plan/engine/domains/mockups.js.
(function (root) {
  'use strict';

  const FRAMES = [
    { id: 'desktop-1440', label: 'Desktop', width: 1440 },
    { id: 'tablet-768', label: 'Tablet', width: 768 },
    { id: 'phone-390', label: 'Phone', width: 390 },
  ];
  const DEFAULT_FRAME = 'desktop-1440';
  // D15: the order of magnitude of each action's cost (not measured yet), its default model (Q-3)
  const COSTS = {
    'build-kit': { model: 'opus', min: 1.5, max: 4 },
    'generate-screen': { model: 'opus', min: 0.4, max: 1.2 },
    'chat-edit': { model: 'sonnet', min: 0.03, max: 0.3 },
    'review-screen': { model: 'sonnet', min: 0.1, max: 0.4 },
    // #836 a screen of the running app recreated with the project's kit (a capture and a generate turn)
    'recreate-screen': { model: 'opus', min: 0.5, max: 1.5 },
    lint: { model: null, min: 0, max: 0 },
  };
  const SELECTION_KEYS = ['mid', 'selector', 'kit', 'text', 'box', 'html', 'crop'];
  const LARGE_SCRIPT = 2000;
  const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'emoji', 'math', 'fangsong', 'inherit', 'initial', 'unset']);

  const docModel = () => (typeof module === 'object' && module.exports ? require('./doc-model') : root.DocModel);

  function slugify(title) {
    return docModel().slug(String(title ?? '')).slice(0, 60).replace(/-+$/, '') || 'screen';
  }

  // ---- data-mid --------------------------------------------------------------------------------

  // the part of the markup whose elements get a data-mid: the body's inside, or all of a fragment
  function bodyRange(html) {
    const open = /<body\b[^>]*>/i.exec(html);
    if (!open) return [0, html.length];
    const start = open.index + open[0].length;
    const close = html.toLowerCase().lastIndexOf('</body>');
    return [start, close >= start ? close : html.length];
  }

  // comments and the inside of script/style are skipped; an element that has a data-mid keeps it
  const TOKEN = /<!--[\s\S]*?-->|<(script|style|template)\b([^>]*)>[\s\S]*?<\/\1\s*>|<([a-zA-Z][\w-]*)\b([^>]*)>/g;

  function addMids(html) {
    const text = String(html ?? '');
    const [start, end] = bodyRange(text);
    const part = text.slice(start, end);
    const used = new Set([...part.matchAll(/\bdata-mid\s*=\s*["']m(\d+)["']/g)].map((m) => Number(m[1])));
    let n = 0;
    const next = () => { do n += 1; while (used.has(n)); return `m${n}`; };
    const marked = part.replace(TOKEN, (whole, raw, rawAttrs, tag, attrs) => {
      if (whole.startsWith('<!--') || raw) return whole;
      if (/\bdata-mid\s*=/.test(attrs)) return whole;
      return `<${tag} data-mid="${next()}"${attrs}>`;
    });
    return text.slice(0, start) + marked + text.slice(end);
  }

  // ---- chat --------------------------------------------------------------------------------------

  function buildChatMessage({ mockup, version, frame, selection, area, refs, message } = {}) {
    const text = String(message ?? '').trim();
    if (!text) throw new Error('Write what the designer should change.');
    const pick = (s) => Object.fromEntries(SELECTION_KEYS.filter((k) => s && s[k] !== undefined).map((k) => [k, s[k]]));
    return {
      mockup,
      version,
      frame: frame || DEFAULT_FRAME,
      selection: Array.isArray(selection) ? selection.map(pick) : [],
      area: area || null,
      refs: Array.isArray(refs) ? refs : [],
      message: text,
    };
  }

  // ---- kit lint ----------------------------------------------------------------------------------

  const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/g;
  const DECLARED = /(--[\w-]+)\s*:\s*([^;}]+)/g;
  const norm = (v) => String(v).toLowerCase().replace(/\s+/g, '');

  // the declarations of a stylesheet (the insides of its blocks), of the inline style attributes and
  // of the <style> elements of the markup
  function styleText(html, css) {
    const blocks = [...String(css || '').matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
    const inline = [...String(html || '').matchAll(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)].map((m) => m[2] ?? m[3]);
    const sheets = [...String(html || '').matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)]
      .flatMap((m) => [...m[1].matchAll(/\{([^{}]*)\}/g)].map((b) => b[1]));
    return [...blocks, ...inline, ...sheets].join('\n');
  }

  function lintMockup({ html = '', css = '', tokens = '' } = {}) {
    const declared = new Map([...String(tokens || '').matchAll(DECLARED)].map((m) => [m[1], m[2].trim()]));
    const values = new Set([...declared.values()].map(norm));
    const styles = styleText(html, css);
    const local = new Set([...styles.matchAll(DECLARED)].map((m) => m[1]));
    const problems = [];
    const seen = new Set();
    const add = (rule, value) => {
      const key = `${rule}\u0000${value}`;
      if (!seen.has(key)) { seen.add(key); problems.push({ rule, value }); }
    };
    for (const m of styles.matchAll(COLOR)) if (!values.has(norm(m[0]))) add('raw-color', m[0]);
    for (const m of `${styles}\n${html}`.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!declared.has(m[1]) && !local.has(m[1])) add('unknown-token', m[1]);
    }
    for (const m of String(html || '').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
      if (m[1].length > LARGE_SCRIPT) add('large-script', `${m[1].length} characters`);
    }
    return problems;
  }

  // ---- cost ---------------------------------------------------------------------------------------

  function estimateCost(action) {
    const c = COSTS[action];
    if (!c) throw new Error(`No cost estimate for the mockup action: ${action}`);
    return { ...c };
  }

  // ---- kit tokens (the deterministic machine step) -----------------------------------------------

  function primaryFont(list) {
    for (const part of String(list).split(',')) {
      const name = part.trim().replace(/^["']|["']$/g, '').trim();
      if (name && !GENERIC_FONTS.has(name.toLowerCase()) && !/^(ui-|var\()/i.test(name)) return name;
    }
    return null;
  }

  function extractTokens(files) {
    const tokens = [];
    const fonts = [];
    for (const { file, text } of Array.isArray(files) ? files : []) {
      String(text || '').split(/\r?\n/).forEach((line, i) => {
        for (const m of line.matchAll(/(?:^|[^\w-])(--[\w-]+)\s*:\s*([^;}]+)/g)) {
          tokens.push({ name: m[1], value: m[2].trim(), file, line: i + 1 });
        }
        for (const m of line.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
          const font = primaryFont(m[1]);
          if (font && !fonts.includes(font)) fonts.push(font);
        }
      });
    }
    return { tokens, fonts };
  }

  function tokensCss(tokens) {
    const rows = (Array.isArray(tokens) ? tokens : [])
      .map((t) => `  --${String(t.name).replace(/^-+/, '')}: ${String(t.value).trim()};`);
    return `:root {\n${rows.join('\n')}\n}\n`;
  }

  // ---- the simulated designer's first version --------------------------------------------------

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function draftScreen({ title, prompt } = {}) {
    const name = esc(String(title || '').trim() || 'Screen');
    const body = `<main class="page"><header class="page-head"><h1>${name}</h1><button class="btn btn-primary" data-kit="button-primary">Export</button></header>`
      + `<section class="card"><p>${esc(String(prompt || '').trim())}</p></section></main>`;
    return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
      + `<title>${name}</title><link rel="stylesheet" href="../../kit/tokens.css"><link rel="stylesheet" href="../../kit/components.css">`
      + `</head><body>${body}</body></html>\n`;
  }

  // ---- the designer's chat turn (D8) -----------------------------------------------------------

  // a designer answer: its prose (the reply) and the new screen, the last ```html block (null: no change)
  function parseDesignerReply(text) {
    const all = String(text ?? '');
    const blocks = [...all.matchAll(/```html[^\n]*\n([\s\S]*?)```/gi)];
    const last = blocks.at(-1);
    if (!last) return { reply: all.trim(), html: null };
    return { reply: (all.slice(0, last.index) + all.slice(last.index + last[0].length)).trim(), html: last[1].trim() ? last[1] : null };
  }

  // Q-8: what a screen's designer chat has cost so far (USD), from its entries' costUsd
  function chatCostUsd(entries) {
    const sum = (Array.isArray(entries) ? entries : []).reduce((n, m) => n + (Number(m?.costUsd) || 0), 0);
    return +sum.toFixed(6);
  }

  // ---- compare (#835) ----------------------------------------------------------------------------

  // data-mid → its opening tag and its own text (up to the next tag): what a change of the element shows in
  function midSignatures(html) {
    const text = String(html ?? '');
    const [start, end] = bodyRange(text);
    const part = text.slice(start, end);
    const map = new Map();
    for (const m of part.matchAll(TOKEN)) {
      if (m[0].startsWith('<!--') || m[1]) continue;
      const mid = /\bdata-mid\s*=\s*["']([^"']+)["']/.exec(m[4]);
      if (!mid) continue;
      const after = part.slice(m.index + m[0].length);
      const lt = after.indexOf('<');
      map.set(mid[1], `${m[0]}\u0000${lt < 0 ? after : after.slice(0, lt)}`);
    }
    return map;
  }

  // the data-mids whose element changed (text or attributes), was removed or was added, sorted (m2 before m10)
  function diffMids(before, after) {
    const a = midSignatures(before);
    const b = midSignatures(after);
    const changed = new Set();
    for (const [mid, sig] of a) if (b.get(mid) !== sig) changed.add(mid);
    for (const mid of b.keys()) if (!a.has(mid)) changed.add(mid);
    return [...changed].sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
  }

  // ---- flows (#835) ------------------------------------------------------------------------------

  // a screen's, a variant's or a flow's name (no '..', '/' or space), and a version (a commit sha)
  const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
  const COMMIT = /^[0-9a-f]{7,40}$/i;
  const unanchored = (re) => re.source.replace(/^\^|\$$/g, '');

  // { name, links: [{ from: { screen, mid }, to }] }; with `screens`, every screen of a link must be in it
  function normalizeFlow({ name, links } = {}, screens) {
    const flowName = String(name ?? '').trim();
    if (!SLUG.test(flowName)) throw new Error(`Not a flow name (lowercase letters, digits and dashes): ${flowName}`);
    const known = Array.isArray(screens) ? new Set(screens) : null;
    const out = (Array.isArray(links) ? links : []).map((l, i) => {
      const screen = String(l?.from?.screen ?? '').trim();
      const mid = String(l?.from?.mid ?? '').trim();
      const to = String(l?.to ?? '').trim();
      if (!screen || !mid || !to) throw new Error(`Link ${i + 1} of the flow ${flowName} needs a screen, an element and a target screen.`);
      for (const s of [screen, to]) if (known && !known.has(s)) throw new Error(`The flow ${flowName} links an unknown screen: ${s}`);
      return { from: { screen, mid }, to };
    });
    return { name: flowName, links: out };
  }

  // the screen a click on (screen, mid) goes to in the flow, null without a link
  function flowTarget(flow, screen, mid) {
    const link = (Array.isArray(flow?.links) ? flow.links : []).find((l) => l?.from?.screen === screen && l?.from?.mid === mid);
    return link ? link.to : null;
  }

  // ---- a Discovery card's mockup attachment (#835): a frozen version -----------------------------

  const ATTACHMENT = new RegExp(`^(${unanchored(SLUG)})@(${unanchored(COMMIT)})\\.mockup\\.json$`);
  const attachmentName = ({ slug, commit }) => `${slug}@${String(commit ?? '').slice(0, 7)}.mockup.json`;
  // '<slug>@<sha7>.mockup.json' → { slug, commit }, null for another file
  function parseAttachmentName(name) {
    const m = ATTACHMENT.exec(String(name ?? ''));
    return m ? { slug: m[1], commit: m[2] } : null;
  }
  // the thumbnail a '*.mockup.json' attachment froze with its version (an SVG data URL), null for another file
  function frozenThumbnail(name, text) {
    if (!/\.mockup\.json$/i.test(String(name ?? ''))) return null;
    try {
      const thumb = JSON.parse(String(text))?.thumbnail;
      return typeof thumb === 'string' && thumb.startsWith('data:image/svg+xml') ? thumb : null;
    } catch { return null; }
  }
  // a small SVG of the version (the screen's title and its short sha) as a data URL, Node and browser alike
  function attachmentThumbnail({ title, commit } = {}) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="150" viewBox="0 0 240 150">'
      + '<rect width="240" height="150" rx="8" fill="#1d2230"/><rect x="12" y="12" width="216" height="18" rx="3" fill="#2c3346"/>'
      + '<rect x="12" y="40" width="140" height="10" rx="3" fill="#3a4258"/><rect x="12" y="58" width="190" height="52" rx="4" fill="#262c3c"/>'
      + `<text x="12" y="132" font-family="sans-serif" font-size="13" fill="#e6e8ee">${esc(String(title ?? '').slice(0, 28))}</text>`
      + `<text x="228" y="132" font-family="monospace" font-size="11" fill="#8a91a3" text-anchor="end">${esc(String(commit ?? '').slice(0, 7))}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  const api = {
    ACTIONS: Object.keys(COSTS),
    COLOR,
    COMMIT,
    DEFAULT_FRAME,
    FRAMES,
    SLUG,
    addMids,
    attachmentName,
    attachmentThumbnail,
    buildChatMessage,
    chatCostUsd,
    diffMids,
    draftScreen,
    esc,
    estimateCost,
    extractTokens,
    flowTarget,
    frozenThumbnail,
    lintMockup,
    normalizeFlow,
    parseAttachmentName,
    parseDesignerReply,
    slugify,
    tokensCss,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MockupModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
