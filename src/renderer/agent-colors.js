// A fixed colour per agent role (#224), instead of a hash of the name that put four development
// agents in the same blue-violet band. Grouped by what the agent does: the builders cool (developer
// blue, reviewer violet), the testers warm (test_writer orange, healer magenta), the checkers green
// and cyan (verifier, evidence), the builder yellow and the orchestrator steel grey (the machine, not
// an AI). An agent's `color: "#RRGGBB"` in its workflow YAML wins; an agent in neither (a custom
// workflow) keeps a stable colour from its name (hsl, golden-angle hash). The supervisor keeps its own.
// - colorFor(agent, def): the agent's colour (#RRGGBB, or hsl() for the fallback); `def` its workflow
//   definition (api.listWorkflows' `agents[name]`).
// - chip(agent, def, theme): { background, text } (#RRGGBB) for a coloured chip in the 'light' or
//   'dark' theme: a tint of the colour, the text a shade of the same colour with a contrast of at
//   least 4.5:1 on it (the darkest needed in light, the lightest in dark).
// - defIn(workflows, workflow, agent): an agent's definition from a workflows list, by file or name.
// Used by the run chat (--rc-agent, its robots' glow) and the runs list's progress avatars.
// Browser: window.AgentColors; Node: module.exports.
(function (root) {
  const ROLES = {
    builder: '#E6C229',
    developer: '#4C7DFF',
    evidence: '#1FC2D6',
    healer: '#F0569B',
    orchestrator: '#8C96A8',
    reviewer: '#A06BFF',
    test_writer: '#FF8A3D',
    verifier: '#2FBF71',
  };
  const BASE = { dark: '#151820', light: '#FFFFFF' };
  const MIN_CONTRAST = 4.5;
  const isHex = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ''));

  /** The name hash of the agents with no role colour: a stable hue, close names far apart. */
  function hueOf(agent) {
    let h = 0;
    for (const ch of String(agent)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return Math.round((h % 1000) * 137.508) % 360; // golden angle: close names get distant hues
  }

  function colorFor(agent, def) {
    if (isHex(def?.color)) return def.color.toUpperCase();
    return ROLES[agent] || `hsl(${hueOf(agent)} 70% 64%)`;
  }

  // ---- colour arithmetic (sRGB, WCAG contrast) ----
  const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const hexOf = (rgb) => `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  function hslRgb(css) {
    const [h, s, l] = (String(css).match(/[\d.]+/g) || [0, 0, 50]).map(Number);
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n) => { const k = (n + h / 30) % 12; return 255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
    return [f(0), f(8), f(4)];
  }
  const toRgb = (c) => (isHex(c) ? rgbOf(c) : hslRgb(c));
  const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);
  function luminance(rgb) {
    const [r, g, b] = rgb.map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a, b) {
    const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  }

  function chip(agent, def, theme = 'dark') {
    const dark = theme !== 'light';
    const color = toRgb(colorFor(agent, def));
    const background = hexOf(mix(color, rgbOf(dark ? BASE.dark : BASE.light), dark ? 0.75 : 0.84));
    // the same colour, lightened (dark theme) or darkened (light theme) just enough to read
    const toward = dark ? [255, 255, 255] : [0, 0, 0];
    let text = hexOf(color);
    for (let t = 0; t <= 1.0001; t += 0.05) {
      text = hexOf(mix(color, toward, Math.min(1, t)));
      if (contrast(rgbOf(text), rgbOf(background)) >= MIN_CONTRAST) break;
    }
    return { background, text };
  }

  /** An agent's definition in a workflows list (api.listWorkflows), by the workflow's file or name. */
  function defIn(workflows, workflow, agent) {
    const wf = (workflows || []).find((w) => w && (w.file === workflow || w.name === workflow));
    return wf?.agents?.[agent] || null;
  }

  const api = {
    chip,
    colorFor,
    defIn,
    hueOf,
    isHex,
    ROLES,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgentColors = api;
})(typeof window !== 'undefined' ? window : globalThis);
