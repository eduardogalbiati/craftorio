// The project city's shared geometry (#373): rounded boxes drawn with instancing, and text on the ground.
// - roundedMaterial(radius, params): a meshStandardMaterial for an InstancedMesh of unitBox() whose
//   corners keep a radius of `radius` world units whatever each instance's scale. The run's 3D view
//   sizes one RoundedBoxGeometry per box (run3d/view.js rbox); the city draws thousands of buildings
//   in one draw call, so its vertex shader splits each vertex of the unit rounded box into its flat
//   core (stretched to the instance's size) and its corner offset (kept round), and gives the normal
//   back the instance's scale that three's instancing divides out. The shadow pass keeps the plain
//   scaled box: the same silhouette.
// - rbox(w, h, d, r): one sized RoundedBoxGeometry, for the few single meshes (slabs, docks).
// - labelTexture(text, { ink, px }): a name drawn into a canvas texture, for a plane on the ground.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const UNIT_R = 0.25; // the unit box's own corner radius (its core is ±0.25)

/** A unit rounded box: the geometry of every rounded instanced mesh. */
export const unitBox = () => new RoundedBoxGeometry(1, 1, 1, 3, UNIT_R);

/** A sized rounded box, its radius clamped to the box. */
export function rbox(w, h, d, r = 0.06) {
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

/** `text` in `ink` on a transparent canvas texture: { tex, aspect } (width / height). */
export function labelTexture(text, { ink, px = 64, weight = 700 }) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `${weight} ${px}px "Segoe UI", system-ui, sans-serif`;
  ctx.font = font;
  canvas.width = Math.min(2048, Math.ceil(ctx.measureText(text).width + px * 0.6));
  canvas.height = Math.ceil(px * 1.35);
  ctx.font = font; // a resize resets the context
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - px * 0.3);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: canvas.width / canvas.height };
}
