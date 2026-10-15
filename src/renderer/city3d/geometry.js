// The project city's shared geometry (#373, the proof of concept's in #382): rounded boxes drawn with
// instancing, and the textures of the ground and its names, from poc/project-city.html.
// - buildingBox(): the one geometry of every building and ledge, its base at y = 0: the POC's unit
//   RoundedBoxGeometry (2 segments, ROUND of its size) scaled per instance, so the rounding grows with
//   the building. mastBox() and capBall() are the masts' and their caps'; flatPlane() a lane dash.
// - roundedMaterial(radius, params) with unitBox(): a meshStandardMaterial for an InstancedMesh whose
//   corners keep a radius of `radius` world units whatever each instance's scale (the district
//   plates, whose rounding is the POC's fixed 1.0). The vertex shader splits each vertex of the unit
//   rounded box into its flat core (stretched to the instance's size) and its corner offset (kept
//   round), and gives the normal back the instance's scale that three's instancing divides out.
// - rbox(w, h, d, r): one sized RoundedBoxGeometry, for the few single meshes (slabs, docks).
// - labelTexture(text, sub, wUnits, hUnits, ink, { centre, dark }): a name lying on a plate, fitted
//   to its strip (the font shrinks, then the suffix goes, then an ellipsis), `sub` lighter after it.
// - groundTexture(kind, T): a zone kind's ground in the theme, a small repeating canvas (noise,
//   tiles, seams, lawn, gravel, lines), quiet; cached per theme and kind.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const UNIT_R = 0.25; // the unit box's own corner radius (its core is ±0.25)
const ROUND = 0.07; // the rounding of a building body, a share of its size
const PX = 14; // texture pixels per world unit (labels)
const ANISOTROPY = 8;

/** A unit rounded box for roundedMaterial: the geometry of the plates. */
export const unitBox = () => new RoundedBoxGeometry(1, 1, 1, 3, UNIT_R);

/** The POC's building: a unit rounded box, its base at y = 0, scaled per instance. */
export function buildingBox() {
  const g = new RoundedBoxGeometry(1, 1, 1, 2, ROUND);
  g.translate(0, 0.5, 0);
  return g;
}

/** A mast, its base at y = 0, scaled to its height. */
export function mastBox() {
  const g = new THREE.CylinderGeometry(0.09, 0.11, 1, 10);
  g.translate(0, 0.5, 0);
  return g;
}

/** A mast's cap. */
export const capBall = () => new THREE.SphereGeometry(0.34, 12, 10);

/** A unit plane lying on the ground (a lane dash). */
export function flatPlane() {
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A sized rounded box, its radius clamped to the box. */
export function rbox(w, h, d, r = 0.3) {
  const rr = Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  return new RoundedBoxGeometry(w, h, d, 3, rr);
}

/** A meshStandardMaterial whose instanced unit rounded boxes keep round corners of `radius`. */
export function roundedMaterial(radius, params) {
  const m = new THREE.MeshStandardMaterial(params);
  const core = (0.5 - UNIT_R).toFixed(4), r = UNIT_R.toFixed(4), R = radius.toFixed(4);
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
#ifdef USE_INSTANCING
  vec3 rbScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  objectNormal *= rbScale;
#endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  float rbRad = min(${R}, 0.45 * min(rbScale.x, min(rbScale.y, rbScale.z)));
  vec3 rbCore = sign(position) * min(abs(position), vec3(${core}));
  transformed = (rbCore / ${core} * (0.5 * rbScale - rbRad) + (position - rbCore) * (rbRad / ${r})) / max(rbScale, vec3(1e-4));
#endif`);
  };
  m.customProgramCacheKey = () => `city-rounded-${R}`;
  return m;
}

/** #RRGGBB between two colours. */
export const mix = (a, b, t) => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;

const fontOf = (px, weight) => `${weight} ${px}px "Segoe UI", system-ui, sans-serif`;
const textWidth = (g, label, sub, px) => {
  g.font = fontOf(px, 700);
  const a = g.measureText(label).width;
  g.font = fontOf(Math.round(px * 0.78), 600);
  return a + g.measureText(sub).width;
};

/** `text` in `ink` lying in a strip of wUnits × hUnits: fitted (shrinks, drops `sub`, then an ellipsis), `sub` lighter after it. */
export function labelTexture(text, sub, wUnits, hUnits, ink, { centre = false, dark = true } = {}) {
  const pad = 0.35 * PX;
  const cw = Math.max(8, Math.round(wUnits * PX)), ch = Math.max(8, Math.round(hUnits * PX));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const g = canvas.getContext('2d');
  g.textBaseline = 'middle';
  let font = Math.round(hUnits * 0.6 * PX);
  let suffix = sub || '';
  const width = (label, px) => textWidth(g, label, suffix, px);
  while (width(text, font) > cw - 2 * pad && font > hUnits * 0.36 * PX) font -= 1;
  if (width(text, font) > cw - 2 * pad) suffix = ''; // the name matters more than the suffix
  let label = text;
  while (width(label, font) > cw - 2 * pad && label.length > 2) label = `${label.replace(/…$/, '').slice(0, -1)}…`;
  const x0 = centre ? (cw - width(label, font)) / 2 : pad;
  g.fillStyle = ink;
  g.font = fontOf(font, 700);
  g.fillText(label, x0, ch / 2 + 1);
  const x = x0 + g.measureText(label).width;
  g.fillStyle = mix(ink, dark ? '#000000' : '#ffffff', 0.45);
  g.font = fontOf(Math.round(font * 0.78), 600);
  g.fillText(suffix, x, ch / 2 + 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = ANISOTROPY;
  return tex;
}

const GROUNDS = { civic: ['tiles', 20], commercial: ['tiles', 9], industrial: ['noise'], infrastructure: ['seams', 26], logistics: ['seams', 18], power: ['noise'], workshop: ['gravel'], library: ['lines', 10], campus: ['lawn'], outskirts: ['gravel'] };
const groundCache = new Map();

/** The ground of a zone kind in theme `T` (cityTheme): a small repeating texture, shared by every slab of that kind. */
export function groundTexture(kind, T) {
  const key = `${T.name}:${kind}`;
  if (groundCache.has(key)) return groundCache.get(key);
  const [kindTex, tile = 16] = GROUNDS[kind] || ['gravel'];
  const base = T.kind(kind).ground, dark = T.dark, amp = dark ? 0.3 : 1; // quieter in the dark: specks read as noise there
  const n = 128, canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const g = canvas.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, n, n);
  let seed = 7; // the same texture every time
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const speck = (count, size, down, up) => {
    for (let i = 0; i < count; i++) {
      const t = rnd();
      g.fillStyle = mix(base, t < 0.5 ? '#000000' : '#ffffff', (t < 0.5 ? down : up) * amp);
      g.fillRect(rnd() * n, rnd() * n, size, size);
    }
  };
  if (kindTex === 'noise') speck(900, 2, 0.12, 0.1);
  if (kindTex === 'gravel') speck(500, 3, 0.16, 0.14);
  if (kindTex === 'lawn') {
    speck(700, 2, 0.1, 0.12);
    g.fillStyle = mix(base, '#000000', 0.08 * amp);
    for (let i = 0; i < 60; i++) g.fillRect(rnd() * n, rnd() * n, 1, 3);
  }
  if (kindTex === 'tiles' || kindTex === 'seams' || kindTex === 'lines') {
    g.strokeStyle = mix(base, dark ? '#ffffff' : '#000000', 0.12 * amp);
    g.lineWidth = 1;
    for (let x = 0; x <= n; x += tile) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, n); g.stroke(); }
    if (kindTex !== 'lines') for (let y = 0; y <= n; y += tile) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(n, y + 0.5); g.stroke(); }
    if (kindTex === 'tiles') {
      for (let i = 0; i < 40; i++) {
        g.fillStyle = mix(base, rnd() < 0.5 ? '#000000' : '#ffffff', 0.05 * amp);
        g.fillRect(Math.floor((rnd() * n) / tile) * tile + 1, Math.floor((rnd() * n) / tile) * tile + 1, tile - 1, tile - 1);
      }
    }
    speck(200, 1, 0.1, 0.1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = ANISOTROPY;
  groundCache.set(key, tex);
  return tex;
}
