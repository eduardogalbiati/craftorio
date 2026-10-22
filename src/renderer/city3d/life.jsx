// The project city's life (#450, poc/project-city-v2.html; the switch of poc/city-modes.html), the
// components scene.jsx draws around the buildings (bundled by scripts/build-3d.js):
// - Props: the trees, lamps and benches (props.js propsOf), one instanced mesh per part kind;
//   City life off shrinks their instance matrices (HIDDEN) without rebuilding the city.
// - Pools: the lamps' pools of light at night. Traffic: the cars of the avenues with their lights.
// - Sky: a gradient dome and the stars around the camera, clouds over the city.
// - Glow: a bloom pass over the lights (three's UnrealBloomPass, from the bundle) into a multisampled
//   render target, else the scene drawn as it is.
// The cars drive and the clouds drift while City life is on, unless the system asks for reduced
// motion. No prop takes the pointer. Also the scene's helpers useDisposable and noRaycast.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { buildingBox, flatPlane, KINDS, mix, partGeometries, poolTexture, skyMaterial, stars } from './geometry.js';
import { carsOf, propsOf } from './props.js';
import { rngOf } from '../../shared/city-buildings.js';

export const LIFE_DIM = 0.72; // City life off: the lights go down to this share
const LIFE_KINDS = ['box', 'cyl', 'green', 'light', 'mast']; // the props' part kinds (KINDS)
const HIDDEN = 0.0001; // City life off shrinks the props to this: the city is not rebuilt (poc/city-modes.html applyLife)
const m4 = new THREE.Matrix4(), quat = new THREE.Quaternion(), at3 = new THREE.Vector3(), scale3 = new THREE.Vector3();
const tmp = new THREE.Object3D();
const tint = new THREE.Color();
export const noRaycast = () => null; // a mesh that never takes the pointer

// a mesh's geometry and material (or a list, or an object of them), freed when the component goes
export function useDisposable(make, deps) {
  const value = useMemo(make, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    const all = Array.isArray(value) ? value : value?.dispose ? [value] : Object.values(value || {});
    for (const x of all) x?.dispose?.();
  }, [value]);
  return value;
}

// the trees, lamps and benches (props.js propsOf): one instanced mesh per part kind, made with the
// layout; City life switches them by their matrices only; the trees and lamps show from LOD level 1
// (the POC's detail kinds); none takes the pointer
export function Props({ layout, T, level, life, store }) {
  const props = propsOf(layout);
  const geos = useDisposable(() => partGeometries(), []);
  const mats = useDisposable(() => Object.fromEntries(LIFE_KINDS.map((k) => [k, KINDS[k].basic ? new THREE.MeshBasicMaterial({ toneMapped: false }) : new THREE.MeshStandardMaterial({ roughness: 0.7, ...KINDS[k].params })])), []);
  const set = useMemo(() => {
    const counts = Object.fromEntries(LIFE_KINDS.map((k) => [k, 0]));
    return { slots: props.map((p) => counts[p.g]++), counts };
  }, [props]);
  const meshes = useMemo(() => Object.fromEntries(LIFE_KINDS.map((k) => {
    const m = new THREE.InstancedMesh(geos[k], mats[k], Math.max(1, set.counts[k]));
    Object.assign(m, { count: set.counts[k], castShadow: KINDS[k].shadow !== false, receiveShadow: true, frustumCulled: false, raycast: noRaycast });
    return [k, m];
  })), [set, geos, mats]);
  useEffect(() => () => { for (const m of Object.values(meshes)) m.dispose(); }, [meshes]);
  useLayoutEffect(() => {
    const role = { bench: T.plinth, lamp: T.lamp, post: T.mast, trunk: T.trunk };
    props.forEach((p, i) => meshes[p.g].setColorAt(set.slots[i], tint.set(p.role === 'leaf' ? mix(T.garden, '#000000', p.shade) : role[p.role])));
    for (const m of Object.values(meshes)) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    store.invalidate();
  }, [meshes, props, set, T, store]);
  useLayoutEffect(() => {
    const s = life ? 1 : HIDDEN;
    quat.identity();
    props.forEach((p, i) => meshes[p.g].setMatrixAt(set.slots[i], m4.compose(at3.set(p.x, p.y, p.z), quat, scale3.set(p.w * s, p.h * s, p.d * s))));
    for (const m of Object.values(meshes)) m.instanceMatrix.needsUpdate = true;
    store.invalidate();
  }, [meshes, props, set, life, store]);
  return (
    <group>
      {Object.entries(meshes).map(([k, m]) => <primitive key={`${k}:${m.uuid}`} object={m} visible={!KINDS[k].detail || level >= 1} />)}
    </group>
  );
}

// the pools of light under the lamps, at night only (additive soft discs)
export function Pools({ layout, T, life }) {
  const at = useMemo(() => propsOf(layout).filter((p) => p.pool != null), [layout]);
  const k = layout.scale || 1;
  const res = useDisposable(() => {
    const map = poolTexture();
    return [flatPlane(), new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }), map];
  }, []);
  const ref = useRef();
  res[1].color.set(T.pool);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    at.forEach((p, i) => { tmp.position.set(p.x, p.pool + 0.05, p.z); tmp.scale.set(7.5 * k, 1, 7.5 * k); tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix); });
    m.instanceMatrix.needsUpdate = true;
  }, [at, k, T.dark]);
  if (!at.length || !T.dark) return null;
  return <instancedMesh key={at.length} ref={ref} args={[res[0], res[1], at.length]} visible={life} frustumCulled={false} raycast={noRaycast} />;
}

const HEAD = '#fff6d8', TAIL = '#ff5a5a';
// the cars of the avenues (props.js carsOf), their head and tail lights; they drive while City life
// is on (and the system does not ask for reduced motion)
export function Traffic({ layout, life, motion }) {
  const cars = useMemo(() => carsOf(layout).map((c) => ({ ...c })), [layout]);
  const k = layout.scale || 1;
  const res = useDisposable(() => [buildingBox(), new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.2 }), new THREE.SphereGeometry(0.5, 12, 10), new THREE.MeshBasicMaterial({ toneMapped: false })], []);
  const body = useRef(), lights = useRef();
  const place = () => {
    const mb = body.current, ml = lights.current;
    if (!mb || !ml) return;
    quat.identity();
    cars.forEach((c, i) => {
      const along = c.axis === 'x', x = along ? c.x + c.t : c.x + c.off, z = along ? c.z + c.off : c.z + c.t, f = 0.85 * k * c.dir;
      mb.setMatrixAt(i, m4.compose(at3.set(x, 0.07, z), quat, scale3.set((along ? 1.7 : 0.75) * k, 0.55 * k, (along ? 0.75 : 1.7) * k)));
      ml.setMatrixAt(i * 2, m4.compose(at3.set(along ? x + f : x, 0.38 * k, along ? z : z + f), quat, scale3.setScalar(0.22 * k)));
      ml.setMatrixAt(i * 2 + 1, m4.compose(at3.set(along ? x - f : x, 0.38 * k, along ? z : z - f), quat, scale3.setScalar(0.18 * k)));
    });
    mb.instanceMatrix.needsUpdate = true;
    ml.instanceMatrix.needsUpdate = true;
  };
  useLayoutEffect(() => {
    cars.forEach((c, i) => {
      body.current?.setColorAt(i, tint.set(c.colour));
      lights.current?.setColorAt(i * 2, tint.set(HEAD));
      lights.current?.setColorAt(i * 2 + 1, tint.set(TAIL));
    });
    for (const m of [body.current, lights.current]) if (m?.instanceColor) m.instanceColor.needsUpdate = true;
    place();
  }, [cars]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, dt) => {
    if (!life || !motion || !cars.length) return;
    const step = Math.min(dt, 0.1);
    for (const c of cars) c.t = (c.t + c.speed * step + c.length) % c.length;
    place();
  });
  if (!cars.length) return null;
  return (
    <group visible={life}>
      <instancedMesh key={`body:${cars.length}`} ref={body} args={[res[0], res[1], cars.length]} castShadow frustumCulled={false} raycast={noRaycast} />
      <instancedMesh key={`lights:${cars.length}`} ref={lights} args={[res[2], res[3], cars.length * 2]} frustumCulled={false} raycast={noRaycast} />
    </group>
  );
}

const CLOUDS = 12, STARS = 1600;
// the sky: a gradient dome and the stars of the night around the camera (as far as it sees), the
// clouds over the city (with City life: they drift while it is on)
export function Sky({ layout, T, life, motion, uniforms }) {
  const { camera } = useThree();
  const b = layout.bounds, sc = Math.max(0.4, b.size / 450); // the POC's clouds were set for a city about 450 wide
  const dome = useDisposable(() => [new THREE.SphereGeometry(1, 32, 16), skyMaterial()], []);
  const night = useDisposable(() => stars(STARS, uniforms), [uniforms]);
  const puff = useDisposable(() => [new THREE.SphereGeometry(0.5, 12, 10), new THREE.MeshStandardMaterial({ roughness: 1, transparent: true, opacity: 0.9 })], []);
  const clouds = useMemo(() => {
    const r = rngOf(5);
    return Array.from({ length: CLOUDS }, () => ({
      x: (r() - 0.5) * 1100 * sc, z: b.centerZ + (r() - 0.5) * 900 * sc, y: (260 + r() * 90) * sc, speed: (1.2 + r() * 1.6) * sc,
      blobs: Array.from({ length: 4 }, (_, k) => ({ dx: (k - 1.5) * (9 + r() * 6) * sc, dz: (r() - 0.5) * 10 * sc, dy: r() * 3 * sc, sx: (16 + r() * 14) * sc, sy: (5 + r() * 4) * sc, sz: (11 + r() * 8) * sc })),
    }));
  }, [b.centerZ, sc]);
  dome[1].uniforms.top.value.set(T.skyTop);
  dome[1].uniforms.horizon.value.set(T.skyHorizon);
  puff[1].color.set(T.cloud);
  puff[1].opacity = T.cloudOpacity;
  const around = useRef(), puffs = useRef();
  const drift = (dt) => {
    const m = puffs.current;
    if (!m) return;
    let i = 0;
    quat.identity();
    for (const c of clouds) {
      c.x += c.speed * dt;
      if (c.x > 620 * sc) c.x = -620 * sc;
      for (const p of c.blobs) m.setMatrixAt(i++, m4.compose(at3.set(b.centerX + c.x + p.dx, c.y + p.dy, c.z + p.dz), quat, scale3.set(p.sx, p.sy, p.sz)));
    }
    m.instanceMatrix.needsUpdate = true;
  };
  useLayoutEffect(() => drift(0), [clouds]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, dt) => {
    const g = around.current;
    if (g) { g.position.copy(camera.position); g.scale.setScalar(camera.far * 0.9); }
    if (life && motion) drift(Math.min(dt, 0.1));
  });
  return (
    <>
      <group ref={around}>
        <mesh geometry={dome[0]} material={dome[1]} renderOrder={-1} frustumCulled={false} raycast={noRaycast} />
        {T.stars && <points geometry={night[0]} material={night[1]} scale={0.95} frustumCulled={false} raycast={noRaycast} />}
      </group>
      <instancedMesh ref={puffs} args={[puff[0], puff[1], CLOUDS * 4]} visible={life} frustumCulled={false} raycast={noRaycast} />
    </>
  );
}

// the Glow: a bloom pass over the lit windows, beacons, lamps and lights (the POC's composer), into a
// multisampled target so the edges keep the canvas' antialiasing; off, the scene is drawn as it is.
// This takes the frame over from React Three Fiber (priority 1).
export function Glow({ glow, T }) {
  const { gl, scene, camera, size, invalidate } = useThree();
  const fx = useMemo(() => {
    const composer = new EffectComposer(gl, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.55, 0.8);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    return { composer, bloom };
  }, [gl, scene, camera]);
  useEffect(() => () => { fx.bloom.dispose(); fx.composer.dispose(); }, [fx]);
  useEffect(() => {
    fx.composer.setPixelRatio(gl.getPixelRatio());
    fx.composer.setSize(size.width, size.height);
    invalidate();
  }, [fx, gl, size, invalidate]);
  useEffect(() => { fx.bloom.strength = T.bloom; invalidate(); }, [fx, T, glow, invalidate]);
  useFrame(() => { if (glow) fx.composer.render(); else gl.render(scene, camera); }, 1);
  return null;
}
