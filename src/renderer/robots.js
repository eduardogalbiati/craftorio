// Robot avatars ("Visor" model): isometric robots drawn as SVG, one brand variant per provider and
// one animated state per phase of a turn (thinking, writing, done...). Ported from the owner's
// avatar generators. Animations are CSS classes prefixed with `rb-` (see chat.css), so the SVGs can
// be inlined in the page without clashing with the app's own class names.
// Exposes window.Robots = { svg(variant, state, opts), look(variant, state, opts), variantFor(provider, model),
// plaqueFor(model), fromAppearance(appearance, label), define(name, appearance), emblem(name),
// lighten / darken(hex, t), VARIANTS, STATES, ... }.
(() => {
  const C = Math.cos(Math.PI / 6), S = 0.5;
  const f = (n) => +(+n).toFixed(2);
  let BB;
  const resetBB = () => (BB = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
  // offset of everything drawn (a robot seated on a chair is the same robot, moved)
  let OFF = { x: 0, y: 0, z: 0 };
  function P(x, y, z) {
    x += OFF.x; y += OFF.y; z += OFF.z;
    const X = (x - y) * C, Y = (x + y) * S - z;
    BB.x0 = Math.min(BB.x0, X); BB.x1 = Math.max(BB.x1, X);
    BB.y0 = Math.min(BB.y0, Y); BB.y1 = Math.max(BB.y1, Y);
    return [X, Y];
  }
  const pts = (a) => a.map((p) => f(p[0]) + ',' + f(p[1])).join(' ');
  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const c = (s) => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t);
    return '#' + ((1 << 24) + (c(16) << 16) + (c(8) << 8) + c(0)).toString(16).slice(1);
  }
  const lighten = (h, t) => mix(h, '#ffffff', t);
  const darken = (h, t) => mix(h, '#000000', t);

  // Isometric box: top, left and right faces, plus the transforms that map 2D art onto each face.
  function box(x, y, z, W, D, H, col, o = {}) {
    const top = [P(x, y, z + H), P(x + W, y, z + H), P(x + W, y + D, z + H), P(x, y + D, z + H)];
    const left = [P(x, y + D, z + H), P(x + W, y + D, z + H), P(x + W, y + D, z), P(x, y + D, z)];
    const right = [P(x + W, y + D, z + H), P(x + W, y, z + H), P(x + W, y, z), P(x + W, y + D, z)];
    const L = `matrix(${f(C)},0.5,0,1,${f(left[0][0])},${f(left[0][1])})`;
    const R = `matrix(${f(C)},-0.5,0,1,${f(right[0][0])},${f(right[0][1])})`;
    const T = `matrix(${f(C)},0.5,${f(-C)},0.5,${f(top[0][0])},${f(top[0][1])})`;
    const sh = o.shade ?? 0.2;
    let s = `<g stroke="${o.outline}" stroke-width="4" stroke-linejoin="round">` +
      `<polygon points="${pts(top)}" fill="${lighten(col, sh + 0.02)}"/>` +
      `<polygon points="${pts(left)}" fill="${col}"/>` +
      `<polygon points="${pts(right)}" fill="${darken(col, sh)}"/></g>`;
    if (o.gloss)
      s += `<g fill="#fff" opacity="${o.glossOp ?? .35}"><rect transform="${L}" x="8" y="7" width="${f(W * 0.45)}" height="5" rx="2.5"/>` +
        `<rect transform="${L}" x="${f(W * 0.45 + 14)}" y="7" width="8" height="5" rx="2.5"/>` +
        `<rect transform="${T}" x="${f(W * 0.12)}" y="${f(D * 0.12)}" width="${f(W * 0.3)}" height="${f(D * 0.08)}" rx="4" opacity=".7"/></g>`;
    return { svg: s, L, R, T };
  }
  const at = (tf, x, y, inner) => `<g transform="${tf} translate(${f(x)},${f(y)})">${inner}</g>`;

  // ---------- emblems (stylized references) ----------
  const LOGOS = {
    spark(r, fill) {
      const lens = [1, .8, .94, .76, 1, .84, .92, .78, .98, .82, .9, .77];
      let s = '';
      lens.forEach((l, i) => {
        const a = i * 30 + (i % 2 ? 5 : -3), len = r * l, w = r * 0.14;
        s += `<path transform="rotate(${a})" d="M0 ${f(-w)} L${f(len * .8)} ${f(-w * .55)} Q${f(len)} 0 ${f(len * .8)} ${f(w * .55)} L0 ${f(w)}Z"/>`;
      });
      return `<g fill="${fill}">${s}<circle r="${f(r * 0.24)}"/></g>`;
    },
    knot(r, col) {
      let s = '';
      for (let i = 0; i < 6; i++)
        s += `<rect transform="rotate(${i * 60})" x="${f(r * 0.2)}" y="${f(-r * 0.9)}" width="${f(r * 0.44)}" height="${f(r * 1.2)}" rx="${f(r * 0.22)}"/>`;
      return `<g fill="none" stroke="${col}" stroke-width="${f(r * 0.14)}" stroke-linejoin="round">${s}</g>`;
    },
    star(r, col) {
      const k = f(r * 0.95);
      return `<path fill="${col}" d="M0 ${-k} Q${f(r * .1)} ${f(-r * .1)} ${k} 0 Q${f(r * .1)} ${f(r * .1)} 0 ${k} Q${f(-r * .1)} ${f(r * .1)} ${-k} 0 Q${f(-r * .1)} ${f(-r * .1)} 0 ${-k}Z"/>`;
    },
    slash(r, col) {
      const k = r * 0.68, a = (d) => [f(k * Math.cos(d * Math.PI / 180)), f(k * Math.sin(d * Math.PI / 180))];
      const [x1, y1] = a(-28), [x2, y2] = a(-62);
      return `<g fill="none" stroke="${col}" stroke-width="${f(r * 0.2)}" stroke-linecap="round">` +
        `<path d="M${x1} ${y1} A${f(k)} ${f(k)} 0 1 1 ${x2} ${y2}"/>` +
        `<line x1="${f(-r * .5)}" y1="${f(r * .5)}" x2="${f(r * .9)}" y2="${f(-r * .9)}"/></g>`;
    },
  };

  // Generic emblems for the user's own agents (no brand), drawn in a 20x20 box centered on 0.
  // Keep the names in sync with EMBLEMS in packages/engine/domains/agents/agents.js.
  const line = (d, w = 2.4) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const ICONS = {
    bolt: '<path d="M2 -10 L-6 2 H-1 L-2 10 L6 -2 H1 Z"/>',
    // the Product Owner's badge (#105): a clipboard with a checklist
    clipboard: '<path fill-rule="evenodd" d="M-7 -7 H-3.5 V-9.5 H3.5 V-7 H7 Q8 -7 8 -6 V9 Q8 10 7 10 H-7 Q-8 10 -8 9 V-6 Q-8 -7 -7 -7Z M-4.5 -2 H4.5 V0 H-4.5Z M-4.5 3 H4.5 V5 H-4.5Z"/>',
    heart: '<path d="M0 8 C-9 2 -10 -4 -6 -7 C-3 -9 0 -7 0 -4 C0 -7 3 -9 6 -7 C10 -4 9 2 0 8Z"/>',
    shield: '<path d="M0 -9 L8 -6 V0 C8 5 4 8 0 10 C-4 8 -8 5 -8 0 V-6Z"/>',
    leaf: '<path d="M-7 8 C-10 -3 -3 -9 9 -9 C9 3 3 9 -7 8Z"/>',
    gear: '<circle r="5" fill="none" stroke="currentColor" stroke-width="3.6"/>' +
      [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<rect transform="rotate(${a})" x="-1.8" y="-9.5" width="3.6" height="4.5" rx="1"/>`).join(''),
    code: line('M-4 -6 L-9 0 L-4 6 M4 -6 L9 0 L4 6 M1.8 -8 L-1.8 8'),
    rocket: '<path d="M0 -10 C5 -6 5 2 3 6 H-3 C-5 2 -5 -6 0 -10Z M-3 1 L-7 7 L-3 6Z M3 1 L7 7 L3 6Z M-2 7.5 L0 10.5 L2 7.5Z"/>',
    eye: line('M-10 0 Q0 -9 10 0 Q0 9 -10 0Z', 2.2) + '<circle r="3.4"/>',
    crown: '<path d="M-9 6 L-9 -5 L-4 0 L0 -8 L4 0 L9 -5 L9 6Z"/>',
    flask: '<path d="M-2.5 -9 H2.5 V-3 L8 7 Q9 9 6.5 9 H-6.5 Q-9 9 -8 7 L-2.5 -3Z"/>',
    star5: '<path d="M0 -10 L2.9 -4 L9.5 -3.1 L4.7 1.5 L5.9 8.1 L0 5 L-5.9 8.1 L-4.7 1.5 L-9.5 -3.1 L-2.9 -4Z"/>',
  };
  for (const [name, art] of Object.entries(ICONS)) {
    LOGOS[name] = (r, col) => `<g transform="scale(${f(r / 10)})" fill="${col}" color="${col}">${art}</g>`;
  }

  // ---------- eyes on the visor (front face coordinates, 120x110) ----------
  const EYES = {
    dots: (a) => `<g fill="${a}"><ellipse cx="40" cy="47" rx="9" ry="11"/><ellipse cx="80" cy="47" rx="9" ry="11"/></g>`,
    bars: (a) => `<g fill="${a}"><rect x="34" y="34" width="13" height="26" rx="3"/><rect x="73" y="34" width="13" height="26" rx="3"/></g>`,
    arcs: (a) => `<path d="M30 56 Q41 34 52 56 M68 56 Q79 34 90 56" fill="none" stroke="${a}" stroke-width="7" stroke-linecap="round"/>`,
    slits: (a) => `<g fill="${a}"><rect x="28" y="42" width="26" height="8" rx="4"/><rect x="66" y="42" width="26" height="8" rx="4"/></g>`,
  };

  // Name plate: a small 3D desk prism leaning at 45° in front of the robot, on top of the base,
  // showing the model (e.g. "Opus 5.5"). Falls back to the brand name; '' removes it.
  function nameplate(v) {
    const text = String(v.plaque ?? v.name ?? v.label ?? '').trim();
    if (!text) return '';
    const ol = v.outline, x0 = 8, x1 = 142, yb = 184, h = 28, z0 = 16, L = h * Math.SQRT2;
    const bg = v.plaqueBg || lighten(v.base, .88);
    const front = [P(x0, yb - h, z0 + h), P(x1, yb - h, z0 + h), P(x1, yb, z0), P(x0, yb, z0)];
    const side = [P(x1, yb - h, z0 + h), P(x1, yb, z0), P(x1, yb - h, z0)];
    const o = front[0];
    const tf = `matrix(${f(C)},0.5,${f(-Math.SQRT1_2 * C)},${f(Math.SQRT1_2 * 1.5)},${f(o[0])},${f(o[1])})`;
    const W = x1 - x0, esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fit = text.length * 12.8 > W - 22 ? ` textLength="${W - 22}" lengthAdjust="spacingAndGlyphs"` : '';
    return `<g stroke="${ol}" stroke-width="3.5" stroke-linejoin="round"><polygon points="${pts(side)}" fill="${darken(bg, .28)}"/><polygon points="${pts(front)}" fill="${bg}"/></g>` +
      `<g transform="${tf}"><rect x="5" y="4" width="${W - 10}" height="${f(L - 8)}" rx="6" fill="none" stroke="${darken(bg, .18)}" stroke-width="1.5"/>` +
      `<rect x="10" y="6.5" width="${f(W * .4)}" height="2.5" rx="1.25" fill="#fff" opacity=".6"/>` +
      `<text${v.mirror ? ` transform="translate(${W},0) scale(-1,1)"` : ''} x="${W / 2}" y="${f(L / 2 + 8)}" font-family="Arial,Helvetica,sans-serif" font-weight="800" font-size="22" fill="${darken(v.base, .1)}" text-anchor="middle"${fit}>${esc}</text></g>`;
  }

  function visorBot(v, id) {
    const ol = v.outline;
    let s = '';
    const base = box(0, 0, 0, 150, 190, 16, v.base, { outline: ol });
    // a robot seated at a desk has no base (v.noBase)
    if (!v.noBase) s += base.svg;
    // A mirrored robot counter-flips its text and emblems so they still read the right way.
    const unflip = v.mirror ? 'scale(-1,1)' : '';
    if (v.name && !v.noBase)
      s += `<text transform="${base.L}${v.mirror ? t('robots.translate_150_0_scale_1_1') : ''}" x="75" y="12" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="10" fill="${lighten(v.base, .55)}" text-anchor="middle" letter-spacing="2">${v.name.toUpperCase()}</text>`;
    const o = { outline: ol, shade: v.shade };
    s += box(48, 78, 16, 22, 22, 28, v.limb, o).svg;
    s += box(80, 78, 16, 22, 22, 28, v.limb, o).svg;
    s += box(20, 76, 48, 20, 24, 40, v.limb, o).svg;
    const body = box(40, 40, 44, 70, 70, 60, v.body, { ...o, gloss: true, glossOp: v.glossOp });
    s += body.svg;
    // emblems drawn at the picker's size (emblem()) and scaled: the same artwork everywhere
    if (v.logo) s += at(body.L, 35, 30, `<g transform="${unflip} scale(1.9)">${LOGOS[v.logo](10, v.chestLogo || '#fff')}</g>`);
    else s += at(body.L, 35, 30, `<rect x="-16" y="-10" width="32" height="20" rx="6" fill="${darken(v.body, .12)}" stroke="${ol}" stroke-width="2.5"/><circle cx="-6" r="3.5" fill="${v.accent}"/><circle cx="6" r="3.5" fill="${lighten(v.body, .5)}"/>`);
    s += box(110, 76, 48, 20, 24, 40, v.limb, o).svg;
    const head = box(15, 15, 104, 120, 120, 110, v.head, { ...o, gloss: true, glossOp: v.glossOp });
    s += head.svg;
    s += at(head.L, 0, 0,
      `<rect x="10" y="20" width="100" height="66" rx="18" fill="${v.screen}" stroke="${ol}" stroke-width="3"/>` +
      `<g filter="url(#glow-${id})">${v.face ? v.face(v, id) : EYES[v.eyes](v.accent) + `<path d="M48 72 Q60 80 72 72" fill="none" stroke="${v.accent}" stroke-width="4" stroke-linecap="round"/>`}</g>` +
      `<rect x="18" y="26" width="30" height="5" rx="2.5" fill="#fff" opacity=".18"/>`);
    const plate = v.logo
      ? `<circle r="32" fill="${v.plate}" stroke="${ol}" stroke-width="4"/><g transform="${unflip} scale(2)">${LOGOS[v.logo](10, v.plateLogo || '#fff')}</g>`
      : `<circle r="32" fill="${v.plate}" stroke="${ol}" stroke-width="4"/><circle r="22" fill="none" stroke="${darken(v.plate, .25)}" stroke-width="3"/>` +
        `<g fill="${darken(v.plate, .3)}">${[-8, 0, 8].flatMap((x) => [-8, 0, 8].map((y) => `<circle cx="${x}" cy="${y}" r="2.6"/>`)).join('')}</g>`;
    s += at(head.R, 60, 55, plate + (v.plateExtra || ''));
    for (const [x, y] of [[45, 75], [105, 75]]) {
      const a0 = P(x, y, 214), a1 = P(x, y, 238);
      s += `<line x1="${f(a0[0])}" y1="${f(a0[1])}" x2="${f(a1[0])}" y2="${f(a1[1])}" stroke="${ol}" stroke-width="5" stroke-linecap="round"/>`;
      s += `<circle cx="${f(a1[0])}" cy="${f(a1[1])}" r="9" fill="${v.antenna || v.accent}" stroke="${ol}" stroke-width="3" filter="url(#glow-${id})" class="${v.antennaClass || ''}" style="animation-delay:${x > 50 ? '.7s' : '0s'}"/>`;
    }
    s += nameplate(v);
    return s;
  }

  // Just the robot on a transparent canvas: no background card, no floor shadow. `v.mirror` flips
  // it horizontally (across the vertical axis) so a robot on the left of a chat faces right.
  function render(v, id) {
    resetBB();
    const inner = visorBot(v, id);
    const w = BB.x1 - BB.x0, h = BB.y1 - BB.y0;
    const sc = Math.min(450 / w, 450 / h);
    const tx = 256 - sc * (BB.x0 + BB.x1) / 2, ty = 262 - sc * (BB.y0 + BB.y1) / 2;
    const robot = `<g class="${v.motion || ''}"><g transform="translate(${f(tx)},${f(ty)}) scale(${f(sc)})">${inner}</g></g>`;
    const flip = (x) => (v.mirror ? `<g transform="translate(512,0) scale(-1,1)">${x}</g>` : x);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
<defs>
<filter id="glow-${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
${flip(robot)}
${flip(v.overlay || '')}
</svg>`;
  }

  const VARIANTS = {
    vanilla: {
      label: 'Vanilla',
      head: '#E6E6E9', body: '#D4D4D8', limb: '#E6E6E9', plate: '#D4D4D8', base: '#8E8E95',
      screen: '#1D1E22', accent: '#F2F2F2', eyes: 'dots', outline: '#3B3B40',
      bg1: '#F7F7F8', bg2: '#DEDEE2',
    },
    claude: {
      label: 'Claude', name: 'Claude', logo: 'spark',
      head: '#F0EEE6', body: '#D97757', limb: '#F0EEE6', plate: '#D97757', base: '#2B2A27',
      screen: '#2B2A27', accent: '#FFB38A', eyes: 'bars', outline: '#3A2A22', markColor: '#D97757',
      bg1: '#FBF3EC', bg2: '#F1D3C0',
    },
    gpt: {
      label: 'ChatGPT', name: 'ChatGPT', logo: 'knot',
      head: '#EAF1FF', body: '#3D7BF7', limb: '#EAF1FF', plate: '#3D7BF7', base: '#0F1E45',
      screen: '#0F1E45', accent: '#6EE7FF', eyes: 'arcs', outline: '#16244D', markColor: '#3D7BF7',
      bg1: '#EEF4FF', bg2: '#BCD3FF',
    },
    grok: {
      label: 'Grok', name: 'Grok', logo: 'slash',
      head: '#F4F4F6', body: '#18181B', limb: '#F4F4F6', plate: '#18181B', base: '#111113',
      screen: '#000000', accent: '#FFFFFF', eyes: 'slits', outline: '#0A0A0B',
      chestLogo: '#FFFFFF', plateLogo: '#FFFFFF', markColor: '#18181B',
      bg1: '#EDEDEF', bg2: '#B9B9BF',
    },
    gemini: {
      label: 'Gemini', name: 'Gemini', logo: 'star',
      head: '#F4F6FB', body: '#6A5CF0', limb: '#F4F6FB', plate: '#4A86F0', base: '#1E1B4B',
      screen: '#14123A', accent: '#A9C8FF', eyes: 'dots', outline: '#1E1B4B', markColor: '#6A5CF0',
      bg1: '#EEF2FF', bg2: '#D5CCFF',
    },
    // The platform's own supervisor: no brand, the app's purple.
    supervisor: {
      label: 'Supervisor',
      head: '#F4F4F6', body: '#7C5CFF', limb: '#F4F4F6', plate: '#7C5CFF', base: darken('#7C5CFF', .55),
      screen: '#15161A', accent: '#C9B8FF', eyes: 'dots', outline: darken('#7C5CFF', .65),
      bg1: lighten('#7C5CFF', .88), bg2: lighten('#7C5CFF', .6),
    },
    // The Backlog's Product Owner (#105): teal, a clipboard on the chest.
    'product-owner': {
      label: 'Product Owner', logo: 'clipboard',
      head: '#F4F4F6', body: '#0F9F8F', limb: '#F4F4F6', plate: '#0F9F8F', base: darken('#0F9F8F', .55),
      screen: '#15161A', accent: '#9FF5E6', eyes: 'arcs', outline: darken('#0F9F8F', .65),
      chestLogo: '#FFFFFF', plateLogo: '#FFFFFF',
      bg1: lighten('#0F9F8F', .88), bg2: lighten('#0F9F8F', .6),
    },
    // The app-wide Oracle (#122): deep blue and gold, an eye on the chest, slit eyes.
    oracle: {
      label: 'Oracle', logo: 'eye',
      head: '#F4F4F6', body: '#1E3A8A', limb: '#F4F4F6', plate: '#1E3A8A', base: darken('#1E3A8A', .55),
      screen: '#15161A', accent: '#FCD34D', eyes: 'slits', outline: darken('#1E3A8A', .65),
      chestLogo: '#FCD34D', plateLogo: '#FCD34D',
      bg1: lighten('#1E3A8A', .88), bg2: lighten('#1E3A8A', .6),
    },
  };

  // ---------- states of a turn ----------
  const INK = '#3B3B40', AMBER = '#FFC24B', GREEN = '#4ADE80', RED = '#FF6B6B', DIM = '#8A8A90';
  const d = (s) => `style="animation-delay:${s}s"`;
  const mouth = {
    smile: (a) => `<path d="M48 72 Q60 80 72 72" fill="none" stroke="${a}" stroke-width="4" stroke-linecap="round"/>`,
    big: (a) => `<path d="M44 68 Q60 84 76 68" fill="none" stroke="${a}" stroke-width="4.5" stroke-linecap="round"/>`,
    flat: (a) => `<path d="M52 74 L68 74" stroke="${a}" stroke-width="4" stroke-linecap="round"/>`,
    side: (a) => `<path d="M54 74 L70 71" stroke="${a}" stroke-width="4" stroke-linecap="round"/>`,
    wavy: (a) => `<path d="M44 75 q4 -5 8 0 t8 0 t8 0 t8 0" fill="none" stroke="${a}" stroke-width="3.5" stroke-linecap="round"/>`,
  };
  const dots = (a, dx = 0, dy = 0, rx = 9, ry = 11) =>
    `<g fill="${a}"><ellipse cx="${40 + dx}" cy="${47 + dy}" rx="${rx}" ry="${ry}"/><ellipse cx="${80 + dx}" cy="${47 + dy}" rx="${rx}" ry="${ry}"/></g>`;

  // Speech or thought balloon in the 512 frame.
  function bubble(content, kind = 'speech') {
    const tail = kind === 'thought'
      ? `<circle cx="184" cy="154" r="10" fill="#fff" stroke="${INK}" stroke-width="3.5"/><circle cx="201" cy="173" r="6" fill="#fff" stroke="${INK}" stroke-width="3"/>`
      : `<path d="M152 126 L194 166 L124 134Z" fill="#fff" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`;
    return `<g>${tail}<rect x="38" y="38" width="152" height="102" rx="30" fill="#fff" stroke="${INK}" stroke-width="3.5"/>` +
      `<g transform="translate(114,89) scale(1.25)__UNFLIP__">${content}</g></g>`;
  }
  const docLines = () => [-14, 0, 14].map((y, i) =>
    `<rect x="-38" y="${y - 3.5}" width="${[64, 52, 36][i]}" height="7" rx="3.5" fill="${INK}" class="rb-type" ${d(i * 0.6)}/>`).join('');

  const STATES = {
    sleeping: {
      accent: DIM, antenna: '#5A5A60', motion: 'rb-breathe', screen: '#141417',
      face: (v) => `<path d="M31 48 Q40 55 49 48 M71 48 Q80 55 89 48" fill="none" stroke="${v.accent}" stroke-width="4.5" stroke-linecap="round"/>${mouth.flat(v.accent)}`,
    },
    idle: { motion: 'rb-bob', face: (v) => `<g class="rb-blink">${EYES[v.eyes](v.accent)}</g>${mouth.smile(v.accent)}` },
    thinking: {
      antennaClass: 'rb-pulse',
      face: (v) => `${dots(v.accent, 7, -7, 8, 10)}${mouth.side(v.accent)}`,
      overlay: bubble([-22, 0, 22].map((x, i) => `<circle class="rb-dot" ${d(i * 0.18)} cx="${x}" cy="4" r="8" fill="${INK}"/>`).join(''), 'thought'),
    },
    writing: {
      face: (v) => `<g fill="${v.accent}"><rect x="29" y="47" width="22" height="7" rx="3.5"/><rect x="69" y="47" width="22" height="7" rx="3.5"/></g>${mouth.flat(v.accent)}`,
      overlay: bubble(docLines() + `<rect class="rb-caret" x="0" y="10" width="4" height="12" rx="1" fill="${INK}"/>`),
    },
    reading: {
      antennaClass: 'rb-pulse',
      face: (v) => `<g class="rb-look">${dots(v.accent, 0, 0, 8, 10)}</g>${mouth.flat(v.accent)}`,
      overlay: bubble(`<g fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"><circle cx="-4" cy="-4" r="14"/><path d="M7 7 L18 18"/></g>`),
    },
    done: {
      antenna: GREEN, motion: 'rb-bob',
      face: (v) => `<path d="M30 52 Q40 36 50 52 M70 52 Q80 36 90 52" fill="none" stroke="${v.accent}" stroke-width="6" stroke-linecap="round"/>${mouth.big(v.accent)}`,
      overlay: bubble(`<g class="rb-pop"><circle r="24" fill="${GREEN}" stroke="${INK}" stroke-width="3"/><path d="M-11 1 L-3 9 L12 -8" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></g>`),
    },
    waiting: {
      antenna: AMBER, antennaClass: 'rb-pulse',
      face: (v) => `<g class="rb-blink">${dots(v.accent, 0, 0, 9, 11)}</g><path d="M30 30 L48 33" stroke="${v.accent}" stroke-width="3.5" stroke-linecap="round"/>${mouth.side(v.accent)}`,
      overlay: bubble(`<text class="rb-pulse" y="16" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="48" fill="${AMBER}" stroke="${INK}" stroke-width="2.5" paint-order="stroke">?</text>`),
    },
    error: {
      accent: RED, antenna: RED, antennaClass: 'rb-fast', motion: 'rb-shake',
      face: (v) => `<g stroke="${v.accent}" stroke-width="6" stroke-linecap="round"><path d="M33 40 L47 54 M47 40 L33 54 M73 40 L87 54 M87 40 L73 54"/></g>${mouth.wavy(v.accent)}`,
      overlay: bubble(`<path d="M0 -24 L26 20 L-26 20Z" fill="${RED}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
        `<rect x="-3" y="-10" width="6" height="16" rx="3" fill="#fff"/><circle cy="13" r="3.5" fill="#fff"/>`),
    },
  };

  // ---------- user-defined looks (Agents screen, packages/engine/domains/agents/agents.js) ----------
  // An appearance is { body, shell, visor, glow, eyes, emblem }: the main color (body, shoulder plate),
  // the shell (head and limbs), the visor (screen), the glow (eyes and antennas), the eye style and
  // an emblem ('none' = the plain panel). Base and outline are derived from the main color.
  const EYE_STYLES = Object.keys(EYES);
  const EMBLEMS = ['none', ...Object.keys(ICONS)];
  const luma = (h) => { const n = parseInt(h.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
  const hex = (h, d) => (/^#[0-9a-f]{6}$/i.test(h || '') ? h : d);
  function fromAppearance(a = {}, label = '') {
    const body = hex(a.body, '#7C5CFF'), shell = hex(a.shell, '#F4F4F6');
    // an emblem on a light body would vanish in white
    const mark = luma(body) > 0.7 ? darken(body, .6) : '#FFFFFF';
    return {
      label,
      head: shell, limb: shell, body, plate: body, base: darken(body, .55),
      screen: hex(a.visor, '#15161A'), accent: hex(a.glow, '#C9B8FF'),
      eyes: EYE_STYLES.includes(a.eyes) ? a.eyes : 'dots', outline: darken(body, .65),
      logo: ICONS[a.emblem] ? a.emblem : undefined, chestLogo: mark, plateLogo: mark,
      bg1: lighten(body, .88), bg2: lighten(body, .6),
    };
  }
  // Replaces (or adds) a named variant, e.g. the supervisor with the look saved in Agents. Screens
  // that already drew it listen for 'robots:changed'.
  function define(name, appearance, label) {
    VARIANTS[name] = fromAppearance(appearance, label ?? VARIANTS[name]?.label ?? name);
    document.dispatchEvent(new CustomEvent('robots:changed', { detail: { name } }));
  }
  // An emblem alone, for pickers: an <svg> with a 20x20 viewBox in `color` (a brand's logo too).
  const emblem = (name, color = 'currentColor') =>
    `<svg viewBox="-11 -11 22 22" aria-hidden="true" focusable="false">${Object.hasOwn(LOGOS, name) ? LOGOS[name](10, color) : ''}</svg>`;

  let uid = 0;
  // `variant` is a name from VARIANTS or a variant object (see fromAppearance).
  // `bubble: false` drops the balloon overlay (small avatars, where it would be unreadable);
  // `plaque` is the name plate text (the model), `mirror` faces the robot right.
  // `color` (#RRGGBB, the agent's role colour, #227) paints the body and the shoulder plate, the shell
  // (head, limbs) in a light tint of it, with the base and outline derived from it and a lighter tint
  // for the visor glow (unless the state has its own, e.g. error red); the emblem and the plaque stay
  // the provider's.
  function svg(variant, state = 'idle', opts = {}) {
    const v = look(variant, state, opts);
    v.mirror = !!opts.mirror;
    if (opts.plaque !== undefined) v.plaque = opts.plaque;
    if (opts.bubble === false) delete v.overlay;
    else if (v.overlay) v.overlay = v.overlay.replace('__UNFLIP__', v.mirror ? ' scale(-1,1)' : '');
    return render(v, `rb${++uid}`);
  }

  // The look svg() draws, before it is drawn: the variant in the state, painted in `color` and with
  // `accent` as above. The run's 3D view (run3d/) builds its robots from it: the same boxes and colours,
  // the state's `face`, `overlay` (the balloon, with its __UNFLIP__ placeholder) and antenna.
  function look(variant, state = 'idle', opts = {}) {
    const st = STATES[state] || STATES.idle;
    const v = { ...(typeof variant === 'object' && variant ? variant : VARIANTS[variant] || VARIANTS.vanilla), ...st };
    if (hex(opts.color)) {
      const c = opts.color;
      // an emblem on a light body would vanish in white (as in fromAppearance)
      const mark = luma(c) > 0.7 ? darken(c, .6) : '#FFFFFF';
      Object.assign(v, { body: c, plate: c, head: lighten(c, .7), limb: lighten(c, .7), base: darken(c, .55), outline: darken(c, .65), chestLogo: mark, plateLogo: mark });
      if (!st.accent) v.accent = lighten(c, .45);
    }
    if (opts.accent) v.accent = opts.accent; // the glow in the agent's colour (#224, agent-colors.js)
    return v;
  }

  // The robot of a provider type: its adapter's (window.Providers, packages/shared/providers/); a provider
  // without one (simulated, unknown, or no registry loaded) gets the robot of its model's maker.
  const MAKERS = [[/^claude-/i, 'claude'], [/^(gpt-|o\d)/i, 'gpt'], [/^grok-/i, 'grok']];
  function variantFor(provider, model = '') {
    if (/gemini/i.test(model)) return 'gemini';
    return (provider && window.Providers?.resolve(provider)?.robot) || MAKERS.find(([re]) => re.test(model || ''))?.[1] || 'vanilla';
  }

  // Name plate text for a model id: "claude-opus-5-5" → "Opus 5.5", "gpt-6-luna" → "GPT-6 Luna".
  function plaqueFor(model = '') {
    const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(model);
    if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
    return model.split('-').map((w, i) => (i === 0 && /^(gpt|glm)$/i.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
      .join(' ').replace(/^GPT (\d)/, 'GPT-$1');
  }

  // ---------- workflow builder: a desk with a chair, and an approval gate ----------
  const escText = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Text on a box face (its L transform), centered, shrunk to fit.
  function faceText(tf, W, y, text, size, fill, weight = 800) {
    const t = String(text || '').trim();
    if (!t) return '';
    const fit = t.length * size * 0.6 > W - 24 ? ` textLength="${W - 24}" lengthAdjust="spacingAndGlyphs"` : '';
    return `<text transform="${tf}" x="${W / 2}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-weight="${weight}" font-size="${size}" fill="${fill}" text-anchor="middle"${fit}>${escText(t)}</text>`;
  }
  function scene(inner, id, extraDefs = '') {
    const pad = 12, w = BB.x1 - BB.x0 + pad * 2, h = BB.y1 - BB.y0 + pad * 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(BB.x0 - pad)} ${f(BB.y0 - pad)} ${f(w)} ${f(h)}" aria-hidden="true" focusable="false">` +
      `<defs><filter id="glow-${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>${extraDefs}</defs>${inner}</svg>`;
  }

  // A step of the visual builder: the agent (a variant, or null for an empty desk) seated on a chair
  // behind a desk, in the robots' isometric style. `label` and `sub` are written on the desk's
  // front panel (e.g. the step id and the model).
  function desk(variant, opts = {}) {
    const id = `dk${++uid}`;
    resetBB();
    const wood = opts.desk || '#8B6A4E', chair = opts.chair || '#2E3340', ol = '#1A1410', cOl = '#12141A';
    const o = { outline: ol, shade: 0.22 }, co = { outline: cOl, shade: 0.25 };
    let s = '';
    // chair: back (behind the robot), post and seat
    s += box(10, -26, 44, 130, 16, 150, chair, co).svg;
    s += box(62, 70, 0, 26, 26, 40, darken(chair, .2), co).svg;
    s += box(0, 10, 40, 150, 170, 14, chair, co).svg;
    if (variant) {
      const v = { ...(typeof variant === 'object' ? variant : VARIANTS[variant] || VARIANTS.vanilla), ...STATES.idle, motion: '', plaque: '', noBase: true };
      delete v.name; // the brand name on the base is hidden by the desk anyway
      OFF = { x: 0, y: 0, z: 40 };
      s += visorBot(v, id);
      OFF = { x: 0, y: 0, z: 0 };
    }
    // desk: back legs, top and front panel (it hides the robot's lower body)
    const x0 = -60, x1 = 210, y0 = 150, D = 110, top = 150;
    s += box(x0 + 8, y0 + 6, 0, 16, 16, top - 12, darken(wood, .15), o).svg;
    s += box(x1 - 24, y0 + 6, 0, 16, 16, top - 12, darken(wood, .15), o).svg;
    s += box(x1 - 24, y0 + D - 22, 0, 16, 16, top - 12, darken(wood, .15), o).svg;
    const panel = box(x0 + 6, y0 + D - 20, 18, x1 - x0 - 12, 12, top - 30, darken(wood, .05), o);
    s += panel.svg;
    const slab = box(x0, y0, top - 12, x1 - x0, D, 14, wood, { ...o, gloss: true, glossOp: .18 });
    s += slab.svg;
    // a laptop on the desk, its screen towards the agent: we see the keyboard and the back of the lid
    s += box(x0 + 110, y0 + 24, top + 2, 84, 56, 5, '#C9CED8', { outline: cOl }).svg;
    const lid = box(x0 + 110, y0 + 80, top + 2, 84, 5, 46, '#9AA1AE', { outline: cOl });
    s += lid.svg;
    s += `<circle transform="${lid.L}" cx="42" cy="20" r="6" fill="#C9CED8" opacity=".8"/>`;
    // papers
    s += box(x0 + 22, y0 + 40, top + 2, 56, 44, 6, '#F4F1EA', { outline: '#6B6358', shade: .1 }).svg;
    const PW = x1 - x0 - 12, PH = top - 30;
    s += faceText(panel.L, PW, PH * 0.45, opts.label, 30, lighten(wood, .82));
    s += faceText(panel.L, PW, PH * 0.45 + 32, opts.sub, 20, lighten(wood, .55), 700);
    return scene(s, id);
  }

  // A person standing, facing the viewer, holding a clipboard with a check mark (the human approver).
  function person(x0, y0, z0) {
    const skin = '#F1C9A5', shirt = '#4F7CC9', pants = '#2E3A55', hair = '#3A2A22', ol = '#1A1A22';
    const o = { outline: ol, shade: .22 };
    let s = '';
    s += box(x0 + 8, y0 + 8, z0, 18, 18, 80, pants, o).svg;
    s += box(x0 + 34, y0 + 8, z0, 18, 18, 80, pants, o).svg;
    s += box(x0 - 14, y0 + 8, z0 + 92, 14, 18, 64, shirt, o).svg;
    s += box(x0, y0, z0 + 80, 60, 34, 78, shirt, { ...o, gloss: true, glossOp: .15 }).svg;
    s += box(x0 + 60, y0 + 8, z0 + 92, 14, 18, 64, shirt, o).svg;
    const head = box(x0 + 10, y0 + 2, z0 + 158, 40, 34, 40, skin, o);
    s += head.svg;
    s += box(x0 + 8, y0, z0 + 192, 44, 38, 12, hair, o).svg;
    s += `<g transform="${head.L}"><circle cx="13" cy="18" r="2.8" fill="${ol}"/><circle cx="27" cy="18" r="2.8" fill="${ol}"/>` +
      `<path d="M13 27 Q20 32 27 27" fill="none" stroke="${ol}" stroke-width="2.2" stroke-linecap="round"/></g>`;
    // the clipboard, held in front of the chest
    const board = box(x0 + 12, y0 + 34, z0 + 96, 36, 4, 46, '#F4F1EA', { outline: '#6B6358', shade: .1 });
    s += board.svg;
    s += `<path transform="${board.L}" d="M9 24 L16 32 L28 13" fill="none" stroke="#2F9E5B" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
    return s;
  }

  // An approval gate, same style as the desks. `reviewer: 'human'` (default): an amber arch with a
  // barrier and a person holding a clipboard; `reviewer: 'ai'`: a violet arch with a scanner beam
  // and the reviewing agent's robot (`robot`: a variant, see fromAppearance).
  function gate(opts = {}) {
    const id = `gt${++uid}`;
    resetBB();
    const ai = opts.reviewer === 'ai';
    const col = ai ? '#8B7CF6' : '#E0A93B', ol = ai ? '#1E1640' : '#2A1E08', o = { outline: ol, shade: .22 };
    let s = '';
    s += box(-230, 60, 0, 490, 170, 12, '#3A3F4D', { outline: '#12141A', shade: .25 }).svg;
    if (ai) {
      const v = { ...(typeof opts.robot === 'object' && opts.robot ? opts.robot : VARIANTS[opts.robot] || VARIANTS.vanilla), ...STATES.idle, motion: '', plaque: '', noBase: true };
      delete v.name;
      OFF = { x: -215, y: 70, z: 12 };
      s += visorBot(v, id);
      OFF = { x: 0, y: 0, z: 0 };
    } else {
      s += person(-170, 150, 12);
    }
    s += box(-10, 100, 12, 30, 30, 230, col, o).svg;
    if (ai) {
      // the scanner: a faint light curtain between the posts and a glowing beam across
      const plane = [P(20, 115, 22), P(190, 115, 22), P(190, 115, 232), P(20, 115, 232)];
      s += `<polygon points="${pts(plane)}" fill="#6EE7FF" opacity=".13"/>`;
    }
    s += box(190, 100, 12, 30, 30, 230, col, o).svg;
    const beam = box(-24, 94, 242, 258, 42, 40, darken(col, .05), { ...o, gloss: true, glossOp: .2 });
    s += beam.svg;
    if (ai) {
      const a = P(20, 115, 128), b = P(190, 115, 128);
      s += `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="#6EE7FF" stroke-width="7" stroke-linecap="round" filter="url(#glow-${id})"/>`;
      s += `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="#E8FCFF" stroke-width="2.5" stroke-linecap="round"/>`;
    } else {
      // the barrier across, striped
      const bar = box(20, 108, 90, 170, 14, 20, '#F4F1EA', { outline: ol, shade: .15 });
      s += bar.svg;
      s += `<g fill="#D9483B">${[0, 1, 2, 3].map((i) => `<rect transform="${bar.L}" x="${12 + i * 42}" y="2" width="20" height="16"/>`).join('')}</g>`;
    }
    s += faceText(beam.L, 258, 29, opts.label || (ai ? 'AI CHECK' : 'HUMAN'), 24, ai ? '#F4F1FF' : '#2A1E08');
    return scene(s, id);
  }

  window.Robots = { svg, look, lighten, darken, variantFor, plaqueFor, fromAppearance, define, emblem, desk, gate, VARIANTS, STATES, EYE_STYLES, EMBLEMS };
})();
