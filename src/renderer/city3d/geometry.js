// The project city's shared geometry (#373, the proof of concept's in #382): rounded boxes drawn with
// instancing, and the textures of the ground and its names, from poc/project-city.html.
// - buildingBox(): the one geometry of every building and ledge, its base at y = 0: the POC's unit
//   RoundedBoxGeometry (2 segments, ROUND of its size) scaled per instance, so the rounding grows with
//   the building. mastBox() and capBall() are the masts' and their caps'; flatPlane() a lane dash.
// - partGeometries() (#449, poc/project-city-v2.html): the unit geometries of the v2 buildings' parts
//   (src/shared/city-buildings.js `g`), every base at y = 0 but the cap's and the light's (centred):
//   box (buildingBox), wedge (a gable roof, wedgeGeometry), barrel (a half cylinder along x), dome,
//   cyl, cone, green (a blob of foliage), mast, cap and light. windowMaterial(uniforms, { floorH,
//   pitch }) is the walls' material: windows at a real floor height on every facade, lit by churn
//   (instance attribute `aWin`: on, seed, lit share, height), styled per zone kind (`aStyle`: column
//   pitch, window width and height shares, glass tint), fading into the wall from far away (fwidth);
//   uniforms { uNight, uTime }.
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

/** A gable roof: a triangular prism, footprint 1 × 1 (x by z), ridge along x at height 1. */
export function wedgeGeometry() {
  const p = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 1, 0]; // 0..3 the base corners, 4..5 the ridge ends
  const tri = [[0, 1, 4], [1, 5, 4], [3, 4, 2], [4, 5, 2], [0, 4, 3], [1, 2, 5], [0, 3, 1], [1, 3, 2]]; // south slope, north slope, the two gables, the bottom
  const pos = [];
  for (const t of tri) for (const i of t) pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** The unit geometries of the v2 buildings' parts, by city-buildings.js `g` (see the header). */
export function partGeometries() {
  const barrel = new THREE.CylinderGeometry(0.5, 0.5, 1, 18, 1, false, 0, Math.PI); // a half cylinder, axis along x, flat side down
  barrel.rotateZ(Math.PI / 2); barrel.rotateY(Math.PI / 2); barrel.rotateX(-Math.PI / 2);
  barrel.computeBoundingBox();
  barrel.translate(0, -barrel.boundingBox.min.y, 0); barrel.scale(1, 2, 1); // base at y = 0, height 1 (the radius)
  const dome = new THREE.SphereGeometry(0.5, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2); dome.scale(1, 2, 1);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 14); cyl.translate(0, 0.5, 0);
  const cone = new THREE.ConeGeometry(0.5, 1, 12); cone.translate(0, 0.5, 0);
  const green = new THREE.IcosahedronGeometry(0.5, 1); green.translate(0, 0.5, 0);
  return { barrel, box: buildingBox(), cap: capBall(), cone, cyl, dome, green, light: new THREE.SphereGeometry(0.5, 12, 10), mast: mastBox(), wedge: wedgeGeometry() };
}

/** The walls' material: windows at a real floor height, lit by churn, a touch of occlusion at the base (see the header). */
export function windowMaterial(uniforms, { floorH, pitch }) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0 });
  const P = pitch.toFixed(2), F = floorH.toFixed(2);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uniforms.uNight;
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aWin; attribute vec4 aStyle; varying vec4 vWin; varying vec4 vStyle; varying vec3 vLocal; varying vec3 vSize; varying vec3 vNrm;') // i18n-ignore
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWin = aWin; vStyle = aStyle; vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)); vLocal = position * vSize; vNrm = normal;'); // i18n-ignore
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uNight; uniform float uTime; varying vec4 vWin; varying vec4 vStyle; varying vec3 vLocal; varying vec3 vSize; varying vec3 vNrm;
float hash3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 winGlow = vec3(0.0);
diffuseColor.rgb *= 0.72 + 0.28 * smoothstep(0.0, 2.4, vLocal.y);
if (vWin.x > 0.5 && abs(vNrm.y) < 0.4) {
  float pitch = ${P} * vStyle.x, ww = vStyle.y * 0.5, wh = vStyle.z * 0.5;
  bool onX = abs(vNrm.x) > 0.5;
  float fw = onX ? vSize.z : vSize.x;
  float u = (onX ? vLocal.z : vLocal.x) + fw * 0.5;
  float cols = floor((fw - 0.3) / pitch);
  float mu = (fw - cols * pitch) * 0.5;
  float floors = floor((vSize.y - 0.3) / ${F});
  float cu = (u - mu) / pitch, cy = vLocal.y / ${F};
  float px = fwidth(cu) + fwidth(cy);
  float fade = 1.0 - smoothstep(0.18, 0.55, px);
  if (cols >= 1.0 && cu >= 0.0 && cu < cols && cy >= 0.0 && cy < floors && fade > 0.0) {
    vec2 cell = vec2(fract(cu), fract(cy));
    bool door = floor(cy) < 0.5 && vWin.w > 1.6;
    bool inWin = door ? (cell.x > 0.3 && cell.x < 0.7 && cell.y < 0.82) : (abs(cell.x - 0.5) < ww && abs(cell.y - 0.55) < wh);
    if (inWin) {
      float side = onX ? sign(vNrm.x) : 2.0 + sign(vNrm.z);
      float rnd = hash3(vec3(floor(cu), floor(cy), vWin.y * 97.0 + side));
      float lit = door ? 0.0 : step(1.0 - vWin.z, rnd + 0.05 * sin(uTime * 0.35 + rnd * 80.0));
      vec3 glass = mix(mix(diffuseColor.rgb * 0.3, vec3(0.06, 0.08, 0.12), 0.55), vec3(0.16, 0.24, 0.38), vStyle.w * 0.8);
      diffuseColor.rgb = mix(diffuseColor.rgb, glass, fade);
      winGlow = fade * lit * uNight * mix(vec3(1.0, 0.78, 0.5), vec3(0.72, 0.84, 1.0), step(0.82, rnd)) * (0.7 + 0.4 * hash3(vec3(rnd, side, 1.0)));
    }
  }
}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += winGlow;'); // i18n-ignore
  };
  mat.customProgramCacheKey = () => `city-windows-${P}-${F}`;
  return mat;
}

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
${t('city3d_geometry.ifdef_use_instancing_vec3_rbscale_vec3')}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
${t('city3d_geometry.ifdef_use_instancing_float_rbrad_min', { R, core, core2: core, r })}`);
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
