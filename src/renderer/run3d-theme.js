// The themes of the run's 3D view (run3d.js, the overlay; run3d/ draws with them), as plain data
// (test/run3d-theme.test.js): which one is on, and the colours of the 3D scene in each.
// - dark (the default): the app's own dark tokens (style.css :root: --bg, --panel, --panel-2,
//   --border, --text, --muted, --accent, --green, --yellow, --red), so the overlay looks like the
//   rest of the app. A test compares `app` below with style.css.
// - light: the palette of the proof of concept the owner approved (poc/run-3d.html), unchanged.
// The HUD's colours are CSS variables (run3d.css: `.r3d`, `.r3d[data-theme="light"]`); a three.js
// material needs its colour as a value, so the scene's are here: the floor, the lane, the walls and
// props, the lights, the consoles, and the state colours (`status`), which keep their meaning in
// both: queued grey, running the accent, done green, waiting and changes amber, failed red. The
// robots keep their role colours in both themes.
// - pick(name): a theme's palette (dark for anything unknown);
// - load() / save(name): the owner's choice, remembered in localStorage (KEY). Storage that is
//   missing or refuses (a private window, a full disk) is not an error: load gives dark, save false;
// - contrast(a, b): the WCAG contrast ratio of two #RRGGBB colours (the tests' check that a state
//   colour reads on the cards and on the floor).
// Browser: window.Run3DTheme; Node: module.exports.
(function (root) {
  const KEY = 'multiagent.run3d.theme';
  const DEFAULT = 'dark';

  const THEMES = {
    dark: {
      name: 'dark',
      // the app's tokens (style.css :root), by their name there
      app: { bg: '#0e1014', panel: '#151820', 'panel-2': '#1b1f29', border: '#262b37', text: '#e6e8ee', muted: '#8a91a3', accent: '#7c9cff', green: '#4ade80', yellow: '#facc15', red: '#f87171' },
      status: { pending: '#6f788c', running: '#7c9cff', done: '#4ade80', changes: '#facc15', failed: '#f87171', waiting: '#facc15' },
      accent: '#7c9cff', onAccent: '#0b0d12', card: '#151820', ink: '#e6e8ee', muted: '#8a91a3',
      machineTone: '#8C96A8', gate: '#E0A93B', supervisor: '#9b82ff',
      sky: '#0e1014', shadow: { color: '#000000', opacity: 0.38 },
      floor: '#181c26', wall: '#1f2533', wallCap: '#343c52', window: '#263560', windowGlow: 0.4,
      board: '#151820', boardInk: '#7c9cff', boardSub: '#8a91a3',
      pad: '#242a39', lane: '#2c3345', laneDone: '#7c9cff',
      wood: '#A47C58', chair: '#4d5775', laptop: '#C9CED8', laptopLid: '#9AA1AE', paper: '#F4F1EA',
      machine: { base: '#2b3247', body: '#3d4766', screen: '#090c14', title: '#7F8DB0', ink: '#FFFFFF', note: '#9FB0D0', keys: '#8089a0', mast: '#596079' },
      person: { skin: '#F1C9A5', shirt: '#4F7CC9', pants: '#56648a', hair: '#6b4a38' },
      podium: '#2e3549',
      cart: { base: '#56617f', wheel: '#0a0c11', box: '#7c9cff', lid: '#e6e8ee', paper: '#F4F1EA', lamp: '#FFE9A8' },
      inbox: '#3b435a', rack: '#3d4766', led: '#4ade80',
      tree: { trunk: '#5d4f43', leaf: '#2f6f57', leaf2: '#3b8468' },
      light: { sky: '#FFFFFF', ground: '#8f9ab8', hemi: 1.85, sun: 1.4 },
    },
    light: {
      name: 'light',
      status: { pending: '#A7B0C2', running: '#4C6FFF', done: '#1FAE6E', changes: '#E39A12', failed: '#EA4E4B', waiting: '#E39A12' },
      accent: '#4C6FFF', onAccent: '#FFFFFF', card: '#FFFFFF', ink: '#1B2233', muted: '#7A859C',
      machineTone: '#8C96A8', gate: '#E0A93B', supervisor: '#7C5CFF',
      sky: '#E8EDF7', shadow: { color: '#3A4A7A', opacity: 0.13 },
      floor: '#EDF0F8', wall: '#DCE3F1', wallCap: '#FFFFFF', window: '#C7D8FF', windowGlow: 0,
      board: '#FFFFFF', boardInk: '#4C6FFF', boardSub: '#7A859C',
      pad: '#FFFFFF', lane: '#DDE3F0', laneDone: '#4C6FFF',
      wood: '#B58A63', chair: '#394055', laptop: '#C9CED8', laptopLid: '#9AA1AE', paper: '#F4F1EA',
      machine: { base: '#1E2438', body: '#2B3350', screen: '#0E1424', title: '#7F8DB0', ink: '#FFFFFF', note: '#9FB0D0', keys: '#C9CED8', mast: '#12141A' },
      person: { skin: '#F1C9A5', shirt: '#4F7CC9', pants: '#2E3A55', hair: '#3A2A22' },
      podium: '#FFFFFF',
      cart: { base: '#2B3350', wheel: '#12141A', box: '#4C6FFF', lid: '#FFFFFF', paper: '#F4F1EA', lamp: '#FFE9A8' },
      inbox: '#C9D2E4', rack: '#2B3350', led: '#3DDC97',
      tree: { trunk: '#B7A08A', leaf: '#86D2AC', leaf2: '#9ADDBB' },
      light: { sky: '#FFFFFF', ground: '#CBD5EC', hemi: 1.95, sun: 1.45 },
    },
  };
  const NAMES = Object.keys(THEMES);

  /** The palette of a theme; the default one for a name that is not a theme. */
  const pick = (name) => THEMES[name] || THEMES[DEFAULT];
  /** The theme the toggle switches to. */
  const other = (name) => (pick(name).name === 'dark' ? 'light' : 'dark');

  // localStorage, when this window has one (reading the property itself can throw)
  function storageOf(storage) {
    if (storage !== undefined) return storage;
    try { return root.localStorage || null; } catch { return null; }
  }

  /** The remembered theme's name ('dark' when nothing, or nothing valid, is stored or storage fails). */
  function load(storage) {
    try {
      const name = storageOf(storage)?.getItem(KEY);
      return NAMES.includes(name) ? name : DEFAULT;
    } catch {
      return DEFAULT;
    }
  }

  /** Remembers the theme; false when it could not (the view goes on with the theme, for this opening). */
  function save(name, storage) {
    if (!NAMES.includes(name)) return false;
    try {
      const store = storageOf(storage);
      if (!store) return false;
      store.setItem(KEY, name);
      return true;
    } catch {
      return false;
    }
  }

  const luminance = (hex) => {
    const n = parseInt(String(hex).slice(1), 16);
    const lin = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  };
  /** The WCAG contrast ratio (1..21) of two #RRGGBB colours. */
  function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  const api = {
    contrast,
    DEFAULT,
    KEY,
    load,
    NAMES,
    other,
    pick,
    save,
    THEMES,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Run3DTheme = api;
})(typeof window !== 'undefined' ? window : globalThis);
