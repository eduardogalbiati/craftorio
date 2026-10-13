// The project city's scene (#373, bundled by scripts/build-3d.js), in React Three Fiber: it draws the
// layout of src/shared/city-layout.js as it is given (main.jsx's store), with the run's 3D look: the
// lights, the shadow and the materials of run3d/scene.jsx, rounded slabs and boxes, the theme's
// colours (theme.js).
// - Ground: the floor, the avenues (lane markings) and the boulevards, a sidewalk around each zone,
//   the zone's slab in its kind's ground colour, a rounded plate per district (instanced), the zone
//   names on the boulevard and the district names on their plates.
// - Buildings (instanced, round corners at any size: geometry.js roundedMaterial), their floors and
//   antennas (a red cap over COMPLEXITY_LIMIT), landmarks (a plinth, a mast and a beacon), ports
//   (a dock, a hall and a mast past the far edge, arcs to their `via` files) and the overlay's
//   markers (a pin over a roof).
// - Hovering a building draws arcs to what it requires (accent) and to what requires it (amber), and
//   dims the rest; a district does the same with district edges (Rust crates). Clicking pins.
// - Level of detail, by the camera's distance against the home view's: zones and their names only
//   far away, district names closer (LOD_LABELS), floors and antennas near (LOD_DETAIL).
// - The camera (Rig): MapControls as the run's view, the home view, zoom and a fly to a target; the
//   frame loop is on demand (a frame when something moves). The floating tags (landmarks, ports) are
//   DOM nodes moved every frame.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { labelTexture, rbox, roundedMaterial, unitBox } from './geometry.js';
import { useStore } from './store.js';

const SIDEWALK_TOP = 0.22, ZONE_TOP = 0.55, PLATE_TOP = 0.95;
const SIDEWALK = 1.2;
const HOME_DIR = new THREE.Vector3(0.5, 1.15, 1).normalize(); // the proof of concept's home view: 46 degrees up
const LOD_LABELS = 0.8, LOD_DETAIL = 0.5; // shares of the home distance
const COMPLEXITY_LIMIT = 25;
const FLOOR_BUDGET = 60000; // floor bands drawn at most (the rest of a tall building's floors are left out)
const FOV = 30;
const tmp = new THREE.Object3D();
const tint = new THREE.Color();

/** The distance of the home view: the whole city in a frame of `aspect` (width / height). */
export function homeOf(bounds, aspect) {
  // the city's bounding circle across the frame, and up it foreshortened by the view's tilt
  const r = Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;
  const v = Math.tan(THREE.MathUtils.degToRad(FOV / 2)), h = v * Math.max(0.5, aspect || 1);
  return 1.12 * Math.max(r / h, (r * HOME_DIR.y) / v, 12);
}

// a mesh's geometry and material, freed when the component goes
function useDisposable(make, deps) {
  const value = useMemo(make, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { for (const x of [].concat(value)) x?.dispose?.(); }, [value]);
  return value;
}

// a rounded slab by its rect on the ground, from y0 to y1
function Slab({ r, y0, y1, c, rough = 0.95, radius = 0.12, grow = 0, ...rest }) {
  const geo = useDisposable(() => rbox(r.w + 2 * grow, y1 - y0, r.d + 2 * grow, radius), [r.w, r.d, y0, y1, grow, radius]);
  return (
    <mesh geometry={geo} position={[r.x + r.w / 2, (y0 + y1) / 2, r.z + r.d / 2]} receiveShadow {...rest}>
      <meshStandardMaterial color={c} roughness={rough} />
    </mesh>
  );
}

// a name lying on the ground, fitted into a rect
function GroundLabel({ text, r, y, ink, px = 64, visible = true }) {
  const label = useDisposable(() => labelTexture(text, { ink, px }), [text, ink, px]);
  useEffect(() => () => label.tex.dispose(), [label]);
  const h = Math.min(r.d, r.w / label.aspect);
  return (
    <mesh rotation-x={-Math.PI / 2} position={[r.x + r.w / 2, y, r.z + r.d / 2]} visible={visible} renderOrder={1}>
      <planeGeometry args={[h * label.aspect, h]} />
      <meshBasicMaterial map={label.tex} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

// ---------- the ground ----------

function Ground({ layout, T, level, store }) {
  const b = layout.bounds;
  const base = { x: b.minX, z: b.minZ, w: b.maxX - b.minX, d: b.maxZ - b.minZ };
  const kindOf = useMemo(() => Object.fromEntries(layout.zones.map((z) => [z.id, z.kind])), [layout]);
  // the lane markings: dashes along the middle of every avenue and boulevard
  const dashes = useMemo(() => {
    const out = [];
    for (const a of layout.avenues) {
      const along = a.axis === 'z' ? a.d : a.w;
      for (let t = 2; t + 2 <= along; t += 5) {
        out.push(a.axis === 'z' ? { x: a.x + a.w / 2, z: a.z + t + 1, sx: 0.25, sz: 2 } : { x: a.x + t + 1, z: a.z + a.d / 2, sx: 2, sz: 0.25 });
      }
    }
    return out;
  }, [layout]);
  const dashRef = useRef();
  const dashGeo = useDisposable(() => new THREE.BoxGeometry(1, 0.04, 1), []);
  useLayoutEffect(() => {
    const m = dashRef.current;
    if (!m) return;
    dashes.forEach((d, i) => { tmp.position.set(d.x, 0.06, d.z); tmp.scale.set(d.sx, 1, d.sz); tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix); });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [dashes]);
  // the district plates: one instanced mesh, coloured by their zone's kind
  const plateRef = useRef();
  const plate = useDisposable(() => [unitBox(), roundedMaterial(0.25, { roughness: 0.9 })], []);
  useLayoutEffect(() => {
    const m = plateRef.current;
    if (!m) return;
    layout.districts.forEach((d, i) => {
      tmp.position.set(d.x + d.w / 2, (ZONE_TOP + PLATE_TOP) / 2, d.z + d.d / 2);
      tmp.scale.set(d.w, PLATE_TOP - ZONE_TOP, d.d);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
      m.setColorAt(i, tint.set(T.kind(kindOf[d.zone]).block));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [layout, T, kindOf]);
  const hover = (kind, id) => (e) => { e.stopPropagation(); store.hover(kind, id, e.nativeEvent); };
  const pick = (kind, id) => (e) => { e.stopPropagation(); if (e.delta <= 4) store.pick(kind, id); };
  const district = (e) => layout.districts[e.instanceId]?.id;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[b.centerX, -0.42, b.centerZ]}><circleGeometry args={[b.size * 4, 64]} /><meshBasicMaterial color={T.sky} toneMapped={false} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[b.centerX, -0.41, b.centerZ]} receiveShadow><circleGeometry args={[b.size * 1.2, 64]} /><shadowMaterial opacity={T.shadow.opacity} color={T.shadow.color} /></mesh>
      <Slab r={base} y0={-0.4} y1={0} c={T.floor} grow={2} radius={0.3} />
      {layout.avenues.map((a, i) => <Slab key={i} r={a} y0={0} y1={0.04} c={T.lane} radius={0.02} />)}
      <instancedMesh ref={dashRef} args={[dashGeo, undefined, Math.max(1, dashes.length)]} count={dashes.length}>
        <meshStandardMaterial color={T.dash} roughness={0.9} />
      </instancedMesh>
      {layout.zones.map((z) => (
        <group key={z.id}>
          <Slab r={z} y0={0} y1={SIDEWALK_TOP} c={T.pad} grow={SIDEWALK} radius={0.2} />
          <Slab r={z} y0={SIDEWALK_TOP} y1={ZONE_TOP} c={T.kind(z.kind).ground} radius={0.25}
            onPointerMove={hover('zone', z.id)} onPointerOut={() => store.hover(null)} onClick={pick('zone', z.id)} />
          <GroundLabel text={z.name} r={{ x: z.x, z: z.z + z.d + layout.avenueWidth * 0.18, w: z.w, d: layout.avenueWidth * 0.64 }} y={0.08} ink={T.ink} px={96} />
        </group>
      ))}
      <instancedMesh ref={plateRef} args={[plate[0], plate[1], Math.max(1, layout.districts.length)]} count={layout.districts.length} castShadow={false} receiveShadow
        onPointerMove={(e) => hover('district', district(e))(e)} onPointerOut={() => store.hover(null)} onClick={(e) => pick('district', district(e))(e)} />
      {layout.districts.map((d) => <GroundLabel key={d.id} text={d.name} r={d.label} y={PLATE_TOP + 0.02} ink={T.kind(kindOf[d.zone]).ink} px={48} visible={level >= 1} />)}
    </group>
  );
}

// ---------- buildings ----------

// the colour of every building: the paint (colour by, overlay), dimmed outside the focus
function paintBuildings(mesh, layout, paint, focus, T) {
  if (!mesh) return;
  layout.buildings.forEach((b, i) => {
    const dim = focus ? !focus.lit.has(i) : !!paint.greyed?.[i];
    mesh.setColorAt(i, tint.set(dim ? T.dim : paint.colours?.[i] || T.muted));
  });
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function Buildings({ layout, T, paint, tests, level, focus, store }) {
  const body = useDisposable(() => [unitBox(), roundedMaterial(0.14, { roughness: 0.78 })], []);
  const band = useDisposable(() => [new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.8 })], []);
  const mast = useDisposable(() => [new THREE.CylinderGeometry(0.06, 0.1, 1, 6), new THREE.MeshStandardMaterial({ roughness: 0.6 })], []);
  const cap = useDisposable(() => [new THREE.SphereGeometry(0.24, 12, 8), new THREE.MeshStandardMaterial({ roughness: 0.4 })], []);
  const bodyRef = useRef(), bandRef = useRef(), mastRef = useRef(), capRef = useRef();
  // the floor bands and the masts, once per layout
  const floors = useMemo(() => {
    const out = [];
    for (let i = 0; i < layout.buildings.length && out.length < FLOOR_BUDGET; i++) {
      const b = layout.buildings[i];
      for (let k = 1; k <= b.floors; k++) out.push({ i, y: PLATE_TOP + (b.h * k) / (b.floors + 1) });
    }
    return out;
  }, [layout]);
  const masts = useMemo(() => layout.buildings.map((b, i) => ({ b, i })).filter((x) => x.b.antenna > 0), [layout]);
  useLayoutEffect(() => {
    const shown = (b) => tests || !b.test;
    const put = (m, i, x, y, z, sx, sy, sz) => { tmp.position.set(x, y, z); tmp.scale.set(sx, sy, sz); tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix); };
    const done = (m) => { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); };
    const B = layout.buildings;
    B.forEach((b, i) => {
      const s = shown(b) ? 1 : 0;
      put(bodyRef.current, i, b.x + b.w / 2, PLATE_TOP + b.h / 2, b.z + b.d / 2, b.w * s, b.h * s, b.d * s);
    });
    floors.forEach((f, k) => {
      const b = B[f.i], s = shown(b) ? 1 : 0;
      put(bandRef.current, k, b.x + b.w / 2, f.y, b.z + b.d / 2, (b.w + 0.06) * s, 0.07 * s, (b.d + 0.06) * s);
    });
    masts.forEach(({ b }, k) => {
      const s = shown(b) ? 1 : 0, top = PLATE_TOP + b.h;
      put(mastRef.current, k, b.x + b.w / 2, top + b.antenna / 2, b.z + b.d / 2, s, b.antenna * s, s);
      put(capRef.current, k, b.x + b.w / 2, top + b.antenna, b.z + b.d / 2, s, s, s);
      capRef.current.setColorAt(k, tint.set(b.worst > COMPLEXITY_LIMIT ? T.danger : T.mast));
    });
    for (const m of [bodyRef.current, bandRef.current, mastRef.current, capRef.current]) done(m);
    if (capRef.current.instanceColor) capRef.current.instanceColor.needsUpdate = true;
    band[1].color.set(T.dash);
    mast[1].color.set(T.mast);
    store.invalidate();
  }, [layout, tests, floors, masts, T, store, band, mast]);
  useLayoutEffect(() => {
    paintBuildings(bodyRef.current, layout, paint, focus, T);
    store.invalidate();
  }, [layout, paint, focus, T, store]);
  const path = (e) => layout.buildings[e.instanceId]?.path;
  return (
    <group>
      <instancedMesh ref={bodyRef} args={[body[0], body[1], Math.max(1, layout.buildings.length)]} count={layout.buildings.length} castShadow receiveShadow
        onPointerMove={(e) => { e.stopPropagation(); store.hover('building', path(e), e.nativeEvent); }}
        onPointerOut={() => store.hover(null)}
        onClick={(e) => { e.stopPropagation(); if (e.delta <= 4) store.pick('building', path(e)); }} />
      <instancedMesh ref={bandRef} args={[band[0], band[1], Math.max(1, floors.length)]} count={floors.length} visible={level >= 2} raycast={() => null} />
      <instancedMesh ref={mastRef} args={[mast[0], mast[1], Math.max(1, masts.length)]} count={masts.length} visible={level >= 2} raycast={() => null} />
      <instancedMesh ref={capRef} args={[cap[0], cap[1], Math.max(1, masts.length)]} count={masts.length} visible={level >= 2} raycast={() => null} />
    </group>
  );
}

// ---------- landmarks, ports, markers, arcs ----------

function Landmarks({ layout, T }) {
  const at = useMemo(() => Object.fromEntries(layout.buildings.map((b) => [b.path, b])), [layout]);
  return layout.landmarks.map((l) => {
    const b = at[l.path];
    const top = PLATE_TOP + b.h + b.antenna;
    return (
      <group key={l.path}>
        <Slab r={b} y0={PLATE_TOP} y1={PLATE_TOP + 0.25} c={T.plinth} grow={0.6} radius={0.15} rough={0.7} raycast={() => null} />
        <mesh position={[l.x, top + 1.2, l.z]}><cylinderGeometry args={[0.05, 0.05, 2.4, 6]} /><meshStandardMaterial color={T.mast} /></mesh>
        <mesh position={[l.x, top + 2.6, l.z]}><sphereGeometry args={[0.45, 16, 12]} /><meshStandardMaterial color={T.beacon} emissive={T.beacon} emissiveIntensity={1.4} toneMapped={false} /></mesh>
      </group>
    );
  });
}

// a quadratic arc from a to b, lifted with the distance, into `out` as line segments
function arc(out, a, b, segments = 16) {
  const lift = 4 + a.distanceTo(b) * 0.22;
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  mid.y = Math.max(a.y, b.y) + lift;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const pts = curve.getPoints(segments);
  for (let i = 0; i < pts.length - 1; i++) out.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
}

const roofOf = (b) => new THREE.Vector3(b.x + b.w / 2, PLATE_TOP + b.h, b.z + b.d / 2);

function Arcs({ segments, color, opacity = 0.8 }) {
  const geo = useDisposable(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
    return g;
  }, [segments]);
  if (!segments.length) return null;
  return (
    <lineSegments geometry={geo} raycast={() => null} renderOrder={2}>
      <lineBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </lineSegments>
  );
}

function Ports({ layout, T }) {
  const at = useMemo(() => Object.fromEntries(layout.buildings.map((b) => [b.path, b])), [layout]);
  const segments = useMemo(() => {
    const out = [];
    for (const p of layout.ports) for (const v of p.via) if (at[v]) arc(out, new THREE.Vector3(p.x, 8, p.z), roofOf(at[v]));
    return out;
  }, [layout, at]);
  return (
    <group>
      {layout.ports.map((p) => (
        <group key={p.id} position={[p.x, 0, p.z]}>
          <Slab r={{ x: -6, z: -3, w: 12, d: 6 }} y0={0} y1={0.6} c={T.dock} radius={0.2} rough={0.7} castShadow />
          <Slab r={{ x: -3, z: -2.4, w: 6, d: 3.4 }} y0={0.6} y1={3.6} c={T.hall} radius={0.2} rough={0.6} castShadow />
          <mesh position={[3.6, 4.6, 0]}><cylinderGeometry args={[0.08, 0.12, 8, 6]} /><meshStandardMaterial color={T.mast} /></mesh>
          <mesh position={[3.6, 8.6, 0]}><sphereGeometry args={[0.4, 16, 12]} /><meshStandardMaterial color={T.beacon} emissive={T.beacon} emissiveIntensity={1.4} toneMapped={false} /></mesh>
        </group>
      ))}
      <Arcs segments={segments} color={T.beacon} opacity={0.45} />
    </group>
  );
}

function Markers({ markers, T }) {
  const ref = useRef();
  const res = useDisposable(() => [new THREE.ConeGeometry(0.6, 1.6, 16), new THREE.MeshStandardMaterial({ roughness: 0.4 })], []);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    markers.forEach((k, i) => {
      tmp.position.set(k.x, PLATE_TOP + k.y + 1.4, k.z);
      tmp.rotation.set(Math.PI, 0, 0);
      tmp.scale.set(1, 1, 1);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
      m.setColorAt(i, tint.set(k.colour || T.marker));
    });
    tmp.rotation.set(0, 0, 0);
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [markers, T]);
  return <instancedMesh ref={ref} args={[res[0], res[1], Math.max(1, markers.length)]} count={markers.length} raycast={() => null} />;
}

// the arcs of the focus (the hovered or pinned building or district) and the buildings it lights
export function focusOf(layout, target, relationsOf) {
  if (!target) return null;
  const index = new Map(layout.buildings.map((b, i) => [b.path, i]));
  if (target.kind === 'building' && index.has(target.id)) {
    const rel = relationsOf('building', target.id);
    const i = index.get(target.id);
    const from = roofOf(layout.buildings[i]);
    const lit = new Set([i]);
    const requires = [], requiredBy = [];
    for (const p of rel.requires) if (index.has(p)) { lit.add(index.get(p)); arc(requires, from, roofOf(layout.buildings[index.get(p)])); }
    for (const p of rel.requiredBy) if (index.has(p)) { lit.add(index.get(p)); arc(requiredBy, roofOf(layout.buildings[index.get(p)]), from); }
    return { lit, requires, requiredBy };
  }
  if (target.kind === 'district') {
    const rel = relationsOf('district', target.id);
    if (!rel.requires.length && !rel.requiredBy.length) return null;
    const of = Object.fromEntries(layout.districts.map((d) => [d.id, d]));
    const centre = (d) => new THREE.Vector3(d.x + d.w / 2, PLATE_TOP + 2, d.z + d.d / 2);
    const ids = new Set([target.id, ...rel.requires, ...rel.requiredBy]);
    const lit = new Set(layout.buildings.flatMap((b, i) => (ids.has(b.district) ? [i] : [])));
    const requires = [], requiredBy = [];
    const self = of[target.id];
    for (const id of rel.requires) if (of[id]) arc(requires, centre(self), centre(of[id]));
    for (const id of rel.requiredBy) if (of[id]) arc(requiredBy, centre(of[id]), centre(self));
    return { lit, requires, requiredBy };
  }
  return null;
}

// ---------- lights and camera ----------

function Lights({ layout, T }) {
  const b = layout.bounds;
  const sun = useMemo(() => new THREE.DirectionalLight(), []);
  useEffect(() => () => sun.dispose(), [sun]);
  useLayoutEffect(() => {
    const half = b.size * 0.62;
    sun.position.set(b.centerX - b.size * 0.3, b.size * 0.75, b.centerZ + b.size * 0.4);
    sun.target.position.set(b.centerX, 0, b.centerZ);
    sun.target.updateMatrixWorld();
    sun.intensity = T.light.sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: b.size * 2.5 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
  }, [sun, b, T]);
  return (
    <>
      <hemisphereLight color={T.light.sky} groundColor={T.light.ground} intensity={T.light.hemi} />
      <primitive object={sun} />
      <primitive object={sun.target} />
    </>
  );
}

function Rig({ layout, store }) {
  const { camera, gl, invalidate, size } = useThree();
  const b = layout.bounds;
  // fixed when the city is laid out: a resize keeps the camera where the user put it
  const home = useMemo(() => homeOf(b, size.width / size.height), [b]); // eslint-disable-line react-hooks/exhaustive-deps
  const state = useMemo(() => ({ goal: null, frames: 0, since: 0, first: false }), []);
  const controls = useMemo(() => {
    const c = new MapControls(camera, gl.domElement);
    Object.assign(c, { enableDamping: true, dampingFactor: 0.12, minDistance: 4, maxDistance: home * 2, minPolarAngle: 0.2, maxPolarAngle: 1.3, zoomSpeed: 0.8 });
    c.target.set(b.centerX, 0, b.centerZ);
    camera.position.copy(c.target).addScaledVector(HOME_DIR, home);
    camera.near = Math.max(0.5, home / 500);
    camera.far = home * 8;
    camera.updateProjectionMatrix();
    return c;
  }, [camera, gl, home, b]);
  useEffect(() => {
    const onChange = () => invalidate();
    const stop = () => { state.goal = null; };
    controls.addEventListener('change', onChange);
    gl.domElement.addEventListener('pointerdown', stop);
    gl.domElement.addEventListener('wheel', stop, { passive: true });
    // the commands of the HUD: the home view, a zoom step, a fly to a target
    store.rig = {
      home: () => { state.goal = { target: new THREE.Vector3(b.centerX, 0, b.centerZ), dist: home, angle: true }; invalidate(); },
      zoom: (k) => {
        const d = camera.position.distanceTo(controls.target);
        state.goal = { target: controls.target.clone(), dist: THREE.MathUtils.clamp(d * k, controls.minDistance, controls.maxDistance), angle: false };
        invalidate();
      },
      fly: (t) => { state.goal = { target: new THREE.Vector3(t.x, t.y || 0, t.z), dist: t.distance, angle: false }; invalidate(); },
    };
    return () => {
      controls.removeEventListener('change', onChange);
      gl.domElement.removeEventListener('pointerdown', stop);
      gl.domElement.removeEventListener('wheel', stop);
      controls.dispose();
      store.rig = null;
    };
  }, [controls, gl, camera, invalidate, store, state, b, home]);
  const off = useMemo(() => new THREE.Vector3(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 3.2);
    const g = state.goal;
    if (g) {
      off.copy(camera.position).sub(controls.target);
      let d = off.length();
      controls.target.lerp(g.target, k);
      d += (g.dist - d) * k;
      off.normalize();
      if (g.angle) off.lerp(HOME_DIR, k).normalize();
      camera.position.copy(controls.target).addScaledVector(off, d);
      if (controls.target.distanceTo(g.target) < 0.05 && Math.abs(g.dist - d) < 0.05 && (!g.angle || off.angleTo(HOME_DIR) < 0.004)) state.goal = null;
      invalidate();
    }
    if (controls.update()) invalidate();
    // the level of detail
    const ratio = camera.position.distanceTo(controls.target) / home;
    const level = ratio > LOD_LABELS ? 0 : ratio > LOD_DETAIL ? 1 : 2;
    if (level !== store.get().level) store.set({ level });
    // the floating tags follow their anchors
    camera.updateMatrixWorld();
    for (const [id, el] of store.tagEls) {
      const a = store.tagAnchors.get(id);
      if (!a) continue;
      v.copy(a).project(camera);
      const behind = v.z > 1;
      el.style.visibility = behind ? 'hidden' : '';
      el.style.transform = `translate(${((v.x * 0.5 + 0.5) * size.width).toFixed(1)}px,${((-v.y * 0.5 + 0.5) * size.height - 6).toFixed(1)}px) translate(-50%,-100%)`;
    }
    // the measures: the time to the first frame, the frame rate while the camera moves
    const now = performance.now();
    if (!state.first) {
      state.first = true;
      requestAnimationFrame(() => { store.stats.firstFrameMs = Math.round(performance.now() - store.stats.mountedAt); });
    }
    state.frames++;
    if (now - state.since > 1000) {
      if (state.frames >= 10) store.stats.fps = Math.round((state.frames * 1000) / (now - state.since));
      state.frames = 0;
      state.since = now;
    }
  });
  return null;
}

/** The whole city: lights, camera, ground, buildings, landmarks, ports, markers and the focus' arcs. */
export function CityScene({ store }) {
  const { layout, layoutKey, paint, tests, level, markers, theme: T, hover, pinned } = useStore(store);
  const { invalidate } = useThree();
  store.invalidate = invalidate;
  const target = hover || pinned;
  const focus = useMemo(() => focusOf(layout, target, store.relationsOf), [layout, target?.kind, target?.id, store]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // the tags' anchors: above a landmark's beacon, a port's mast
    store.tagAnchors = new Map([
      ...layout.landmarks.map((l) => [`landmark:${l.path}`, new THREE.Vector3(l.x, PLATE_TOP + l.y + 3.4, l.z)]),
      ...layout.ports.map((p) => [`port:${p.id}`, new THREE.Vector3(p.x + 3.6, 9.4, p.z)]),
    ]);
    invalidate();
  }, [layout, store, invalidate]);
  return (
    <group>
      <Lights layout={layout} T={T} />
      <Rig key={layoutKey} layout={layout} store={store} />
      <Ground layout={layout} T={T} level={level} store={store} />
      <Buildings layout={layout} T={T} paint={paint} tests={tests} level={level} focus={focus} store={store} />
      <Landmarks layout={layout} T={T} />
      <Ports layout={layout} T={T} />
      <Markers markers={markers} T={T} />
      {focus && <Arcs segments={focus.requires} color={T.accent} />}
      {focus && <Arcs segments={focus.requiredBy} color={T.marker} />}
    </group>
  );
}
