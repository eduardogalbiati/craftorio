// The run's 3D view (bundled by scripts/build-3d.js into generated/run3d-scene.js): what the scene
// (scene.jsx) and the HUD (hud.jsx) share while the overlay is open. One view at a time: `begin`
// sets it up when the overlay mounts, `end` frees what it made (geometries, textures, the tags'
// elements) when it closes, so nothing of a closed view stays in memory.
// - the player (src/renderer/run3d-replay.js, a Run3DPlayer the overlay feeds) and the model it shows
//   (`view.model`: the run as it is now, or the replayed moment), with useModel, its hook; nowMs and
//   robotStateOf read the shown moment, so a replay is drawn like a live run;
// - the theme (src/renderer/run3d-theme.js): `view.theme` is its palette, useTheme its hook, setTheme
//   switches (the run's state and the camera stay; the textures drawn for the theme left are freed);
// - the agents' looks: their colour (AgentColors) and robot variant (Robots, by provider and model);
// - the floor in three.js terms (geo: the lane as vectors) and entityPos (where a thing stands);
// - the camera rig's goals (rig) and the floating tags' elements (tagEls);
// - cached geometries and textures (rbox, svgTexture, canvasTexture, textTexture).
import { useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// a state is never told by its colour alone: its label is always written (the colours: the theme's `status`)
export const STATUS = {
  pending: { label: 'Queued' },
  running: { label: 'Running' },
  done: { label: 'Done' },
  changes: { label: 'Changes requested' },
  failed: { label: 'Failed' },
  waiting: { label: 'Waiting for you' },
};
export const PROVIDER = { claude: 'Claude Code', 'claude-code': 'Claude Code', codex: 'Codex CLI', 'codex-cli': 'Codex CLI', grok: 'Grok Build', 'grok-cli': 'Grok Build', mock: 'Simulated' };
export const TAG_LIFT = { item: 1.55, supervisor: 3.0, start: 1.7, end: 3.1, agent: 3.05, machine: 2.45, gate: 3.3 };
export const VIEW_DIR = new THREE.Vector3(1, 0.86, 1).normalize();

export const view = {
  player: null, workflows: [], root: null, subscribe: null, clock: 0, off: null, theme: window.Run3DTheme.pick(), onTheme: null,
  /** The model to draw: the run as it is now, or the moment a replay shows. */
  get model() { return this.player ? this.player.model : null; },
};
export const rig = {};
export const tagEls = new Map();
const geoCache = new Map();
const texCache = new Map(); // key → { tex, theme: the theme it was drawn for (null: any) }
const looks = new Map();

/** Sets the view up for one overlay: { player, workflows, root (the overlay's element), theme (its name), onTheme }. */
export function begin({ player, workflows = [], root, theme, onTheme = null }) {
  // one subscribe function for every hook (a new one per render would resubscribe each time), and a
  // clock that moves only when the player notifies: a value read twice between two notifications is the same
  Object.assign(view, { player, workflows, root, subscribe: (fn) => player.subscribe(fn), clock: Date.now(), theme: window.Run3DTheme.pick(theme), onTheme });
  view.off = player.subscribe(() => { view.clock = Date.now(); });
  Object.assign(rig, { targetFn: null, distGoal: 36, free: false, angleGoal: false, onUserMove: null, zoomBy: 0 });
}

/** Frees what the view made: geometries, textures, the agents' looks, the tags. */
export function end() {
  for (const g of geoCache.values()) g.dispose();
  for (const t of texCache.values()) t.tex.dispose();
  geoCache.clear();
  texCache.clear();
  looks.clear();
  tagEls.clear();
  geoOf.cache = null;
  view.off?.();
  Object.assign(view, { player: null, workflows: [], root: null, subscribe: null, off: null, onTheme: null });
  for (const k of Object.keys(rig)) delete rig[k];
}

/** A value read from the shown model, kept up to date (a primitive or a stable object). */
export const useModel = (select) => useSyncExternalStore(view.subscribe, () => select(view.model));
/** A value read from the player (its mode, its speed...). */
export const usePlayer = (select) => useSyncExternalStore(view.subscribe, () => select(view.player));
/** Re-renders on every change of what is shown and on the clock's ticks. */
export const useTick = () => usePlayer((p) => p.version);
/** The theme's palette; a component that paints with it is drawn again when the theme changes. */
export const useTheme = () => useSyncExternalStore(view.subscribe, () => view.theme);

/** The wall clock at the player's last notification (the overlay's clock ticks it). */
export const wallMs = () => view.clock || Date.now();
/** Now, as the views see it: the wall clock, or the replayed moment's time while a replay is shown. */
export const nowMs = () => view.player.now(wallMs());
/** The robot state of "<station>:<agent>" or "supervisor" at the shown moment. */
export const robotStateOf = (key) => view.player.robotState(key, wallMs());
/** A state's colour in the theme. */
export const statusColor = (status) => view.theme.status[status] || view.theme.status.pending;

/**
 * Switches the theme ('dark' | 'light'): the scene and the HUD are painted again, nothing else moves
 * (the run's state, the selection and the camera stay). The textures drawn for the theme left (signs,
 * screens) are freed once the scene no longer uses them; materials keep their object and get new colours.
 */
export function setTheme(name) {
  const next = window.Run3DTheme.pick(name);
  if (!view.player || next === view.theme) return;
  const old = [];
  for (const [key, entry] of texCache) if (entry.theme && entry.theme !== next.name) { old.push(entry.tex); texCache.delete(key); }
  view.theme = next;
  view.onTheme?.(next.name);
  view.player.notify();
  requestAnimationFrame(() => { for (const tex of old) tex.dispose(); });
}

// ---- agents: colour and robot ----
function providerType(provider, model) {
  const fn = window.RunChatModel?.providerType;
  if (fn) return fn(provider, model);
  return { claude: 'claude-code', codex: 'codex-cli', grok: 'grok-cli' }[provider] || provider || '';
}
/** An agent of the run: { name, label, model, provider, color (#RRGGBB), variant (Robots) }. */
export function agentDef(name) {
  if (looks.has(name)) return looks.get(name);
  const m = view.model, a = m.agents[name] || { name, label: String(name).replace(/_/g, ' '), provider: '', model: '' };
  const colors = window.AgentColors;
  const def = colors?.defIn(view.workflows, m.run.file || m.run.workflow, name) || colors?.defIn(view.workflows, m.run.workflow, name);
  const look = {
    ...a,
    color: colors ? colors.hexFor(name, def) : '#7C5CFF', // the role's colour, the same in both themes
    variant: window.Robots.variantFor(providerType(a.provider, a.model), a.model || ''),
  };
  // a robot seen before its session opened gets its model later: cache only a complete look
  if (a.model) looks.set(name, look);
  return look;
}
export const stationColor = (st) => (st.kind === 'gate' ? view.theme.gate : st.kind === 'machine' ? view.theme.machineTone : agentDef(st.agents[0]).color);

// ---- the floor in three.js terms ----
/** The layout's lane and points as vectors (cached per layout). */
export function geoOf(layout) {
  if (geoOf.cache?.layout === layout) return geoOf.cache;
  const v = (p) => new THREE.Vector3(p.x, 0, p.z);
  geoOf.cache = { layout, path: layout.path.map(v), center: v(layout.center), sup: v(layout.sup) };
  return geoOf.cache;
}

/** The cart's point at `d` along the lane. */
export function lanePoint(layout, d, out) {
  const { path, cum, total } = layout;
  d = Math.max(0, Math.min(total, d));
  let i = 0;
  while (i < path.length - 2 && d > cum[i + 1]) i++;
  const g = geoOf(layout).path;
  return out.lerpVectors(g[i], g[i + 1], (d - cum[i]) / ((cum[i + 1] - cum[i]) || 1));
}

/** Where a selectable thing stands: a station, 'supervisor', 'item' (the cart), 'start' or 'end'. */
export function entityPos(id, out, lift = 0) {
  const layout = view.model.layout(), g = geoOf(layout), st = layout.byId[id];
  if (id === 'item') lanePoint(layout, rig.cartD ?? 0, out);
  else if (id === 'supervisor') out.copy(g.sup);
  else if (id === 'start') out.copy(g.path[0]);
  else if (id === 'end') out.copy(g.path[g.path.length - 1]).setX(g.path[g.path.length - 1].x + layout.endDir * 1.4);
  else if (st) out.set(st.x, 0, st.z + (st.kind === 'gate' ? 0.6 : 0));
  else out.copy(g.center);
  out.y += lift;
  return out;
}

// ---- cached geometries and textures (freed by end(); a themed texture also when its theme is left) ----
export function rbox(w, h, d, r = 0.04) {
  const rr = Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  const key = [w, h, d, rr].map((n) => n.toFixed(3)).join();
  if (!geoCache.has(key)) geoCache.set(key, new RoundedBoxGeometry(w, h, d, 3, rr));
  return geoCache.get(key);
}

const finish = (tex) => { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return tex; };
/** An SVG drawn into a texture (img-src data: is allowed by the renderer's CSP). */
export function svgTexture(svg, w, h) {
  if (texCache.has(svg)) return texCache.get(svg).tex;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const tex = finish(new THREE.CanvasTexture(canvas));
  const img = new Image();
  img.onload = () => { canvas.getContext('2d').drawImage(img, 0, 0, w, h); tex.needsUpdate = true; };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  texCache.set(svg, { tex, theme: null });
  return tex;
}
/** A drawn texture, cached by `key`; `themed`: drawn with the theme's colours (one per theme, freed with it). */
export function canvasTexture(key, w, h, draw, themed = false) {
  if (themed) key = `${view.theme.name}:${key}`;
  if (texCache.has(key)) return texCache.get(key).tex;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const tex = finish(new THREE.CanvasTexture(canvas));
  texCache.set(key, { tex, theme: themed ? view.theme.name : null });
  return tex;
}
export function fitText(g, text, max) {
  let out = String(text);
  while (g.measureText(out).width > max && out.length > 4) out = out.slice(0, -2);
  return out === String(text) ? out : `${out.trimEnd()}…`;
}
export function textTexture(lines, w, h, themed = false) {
  return canvasTexture('text:' + JSON.stringify(lines) + w + h, w, h, (g) => {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const l of lines) {
      g.font = `${l.weight || 800} ${l.size}px Arial, Helvetica, sans-serif`;
      g.fillStyle = l.color;
      g.fillText(fitText(g, l.text, w - 30), w / 2, l.y);
    }
  }, themed);
}

// ---- text helpers of the HUD ----
export const clockOf = (ms) => window.Run3DModel.clockOf(ms);
export const tokOf = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));
export const usd = (n) => `$${n.toFixed(2)}`;
export const issueText = (run) => (run.issues.length ? `issue${run.issues.length > 1 ? 's' : ''} ${run.issues.map((i) => `#${i.number}`).join(' ')}` : 'no issue');
export const itemName = (run) => run.issues.map((i) => `#${i.number}`).join(' ') || 'Task';
