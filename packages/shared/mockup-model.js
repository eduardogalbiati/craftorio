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
// chatCostUsd(entries) (Q-8: a screen's designer chat total).
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

  const api = {
    ACTIONS: Object.keys(COSTS),
    DEFAULT_FRAME,
    FRAMES,
    addMids,
    buildChatMessage,
    chatCostUsd,
    draftScreen,
    estimateCost,
    extractTokens,
    lintMockup,
    parseDesignerReply,
    slugify,
    tokensCss,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MockupModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
