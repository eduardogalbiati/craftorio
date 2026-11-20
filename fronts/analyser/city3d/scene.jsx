// The project city's scene (#373, bundled by scripts/build-3d.js), in React Three Fiber: it draws the
// layout of packages/shared/city-layout.js as it is given (main.jsx's store), with the look of the proof
// of concept poc/project-city.html (#382: its geometry and constants, ported) over the run's 3D
// lights, shadow and themes (theme.js).
// - Ground: the water around the city (#450, rippling: geometry.js waterMaterial), the floor slab (a
//   quay past the ring road, so the ports' docks stand over the water as piers), the lane slab under
//   the city (the ring road and the avenues, with lane dashes along the avenues' centre lines and the
//   crosswalks, props.js crosswalksOf), per zone a sidewalk, the zone's slab in its kind's ground
//   texture and its name along its avenue side, per district a sidewalk around a raised plate
//   (instanced, round corners of a fixed radius: geometry.js roundedMaterial) with its name, its file
//   count and a lawn in front of its buildings (props.js lawnsOf).
// - The city's life (#450, poc/project-city-v2.html; the switch of fronts/analyser/poc/city-modes.html): the props,
//   pools, cars, sky and Glow of life.jsx, a moonlight and a fill light (Lights). City life off (the
//   store's `cityLife`) shrinks the props' instance matrices and hides the cars, pools and clouds, the
//   lights at LIFE_DIM, without rebuilding the city; on, a frame after another (unless the system asks
//   for reduced motion), but none while the city is off screen (the store's `paused`, main.jsx). The
//   Glow (the store's `glow`): the bloom pass, else the scene drawn as it is.
// - Buildings (#449, poc/project-city-v2.html): each file is packages/shared/city-buildings.js's archetype
//   and parts (buildingsOf, once per layout), one InstancedMesh per part kind (KINDS, geometry.js
//   partGeometries); the walls carry the windows (geometry.js windowMaterial: `aWin` lit by churn,
//   `aStyle` the zone kind's facade, theme.js), each part coloured by its role from the building's
//   colour (paintBuildings); crane arms swing and warning lights pulse near (level 1 and closer,
//   unless the system asks for reduced motion). Landmarks (a plinth, a pole and a beacon), ports (a
//   dock, a hall and a mast outside the city edge, arcs to their `via` files) and the overlay's
//   markers (a pin over a roof) stand on each building's `top`.
// - Hovering a building shows a halo, draws dashed arcs to what it requires (accent) and from
//   what requires it (amber), lights their roofs (RoofLights) and lightens those buildings; nothing
//   else changes colour (#382: no flash across the city). Pinning (a click, or the connections
//   panel's pins) keeps the arcs and a ring, and dims every building outside the pinned connections
//   with a short fade (DIM_MS). A district's hover or pin does the same with district edges (Rust
//   crates).
// - Level of detail, by the camera's distance against the home view's: zones and their names only
//   far away, district names and the parts' details closer (LOD_LABELS), up close (LOD_DETAIL) the
//   district under the camera's target shows its files' scores as tags (`scoreDistrict`).
// - The camera (Rig): MapControls as the run's view, the home view (#849 cityFrame: the whole city and the
//   top of its tallest building in the frame, clear of the HUD, refitted on a resize while the user has not
//   moved the camera), zoom (a fixed share of the distance a click, zoomDistance) and a fly to a target;
//   at rest it tells store.onCamera({ distance, home, framed }); the frame loop is on demand (a frame
//   when something moves). The floating tags (landmarks, ports) are DOM nodes moved every frame.
//   Left alone for IDLE_MS with City life on (and motion allowed), the camera drifts slowly around
//   what it looks at (#415's idle camera); any input stops it.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { buildingBox, flatPlane, groundTexture, KINDS, labelTexture, mastBox, mix, partGeometries, rbox, roundedMaterial, unitBox, waterMaterial, windowMaterial } from './geometry.js';
import { Glow, LIFE_DIM, noRaycast, Pools, Props, Sky, Traffic, useDisposable } from './life.jsx';
import { crosswalksOf, inset, lawnsOf, PLATE_TOP, SIDEWALK_AV, SIDEWALK_TOP, STREET, ZONE_TOP } from './props.js';
import { useStore } from './store.js';
import { buildingOf, FLOOR_H, hashOf, WIN_PITCH } from '@multiagent/shared/city-buildings.js';
import { labelsShown } from '@multiagent/shared/city-layout.js';

const Y0 = PLATE_TOP; // the buildings stand on the district plates (props.js has the slabs' tops)
const QUAY = 6, SHORE = 170; // the floor past the ring road, the water past the floor (the POC's quay and shore)
const HOME_DIR = new THREE.Vector3(0.5, 1.15, 1).normalize(); // the home view: from the south-east, 46 degrees up
const IDLE_MS = 20000, IDLE_TURN = 0.04, UP = new THREE.Vector3(0, 1, 0); // the idle camera: after 20 s, radians a second
const LOD_LABELS = 0.8, LOD_DETAIL = 0.5; // shares of the home distance
const FOV = 30;
const ZOOM_STEP = 0.2, ZOOM_ROOM = 4; // #849: a HUD zoom click's share of the distance; the farthest zoom out, in home distances
const DIM_MS = 220; // the fade of the buildings outside a pinned file's connections
const DIM = 0.8; // how far they go toward the theme's dim colour
const LIT = 0.3; // how far a hovered building's connections go toward the ink
const tmp = new THREE.Object3D();
const tint = new THREE.Color();

/** The distance of the home view: the whole city in a frame of `aspect` (width / height). */
export function homeOf(bounds, aspect) {
  // the city's bounding circle across the frame, and up it foreshortened by the view's tilt
  const r = Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;
  const v = Math.tan(THREE.MathUtils.degToRad(FOV / 2)), h = v * Math.max(0.5, aspect || 1);
  return 1.12 * Math.max(r / h, (r * HOME_DIR.y) / v, 12);
}

/** The POC's home view: the camera distance along `dir` from `target` at which every corner of `rect` (ground and `top`) shows, clear of the HUD. */
export function fitDistance(camera, target, dir, rect, top, cap = 4000) {
  const corners = [[rect.x, rect.z], [rect.x + rect.w, rect.z], [rect.x, rect.z + rect.d], [rect.x + rect.w, rect.z + rect.d]];
  return fitPoints(camera, target, dir, corners.flatMap(([x, z]) => [new THREE.Vector3(x, 0, z), new THREE.Vector3(x, top, z)]), cap);
}

// fitDistance over any points: the nearest distance (4% steps) at which they all show, clear of the HUD
function fitPoints(camera, target, dir, points, cap) {
  const probe = camera.clone(), v = new THREE.Vector3();
  for (let d = 20; d < cap; d *= 1.04) {
    probe.position.copy(target).addScaledVector(dir, d);
    probe.lookAt(target);
    probe.updateMatrixWorld();
    if (points.every((p) => { v.copy(p).project(probe); return Math.abs(v.x) < 0.94 && v.y < 0.76 && v.y > -0.95; })) return d;
  }
  return cap;
}

// #849: what the first view keeps in sight: the city's ground (its ring and the quay past it) and the top
// corners of its tallest building (antenna included), so one file far larger than the rest never fills the view
function framePoints(layout) {
  const b = layout.bounds, built = buildingsOf(layout);
  const points = [[b.minX - QUAY, b.minZ - QUAY], [b.maxX + QUAY, b.minZ - QUAY], [b.minX - QUAY, b.maxZ + QUAY], [b.maxX + QUAY, b.maxZ + QUAY]].map(([x, z]) => new THREE.Vector3(x, 0, z));
  let tall = null, top = 0;
  layout.buildings.forEach((x, i) => { const h = Math.max(x.h, built[i]?.top ?? 0, x.h + (x.antenna || 0)); if (h > top) { tall = x; top = h; } });
  if (tall) for (const [x, z] of [[tall.x, tall.z], [tall.x + tall.w, tall.z], [tall.x, tall.z + tall.d], [tall.x + tall.w, tall.z + tall.d]]) points.push(new THREE.Vector3(x, Y0 + top, z));
  return points;
}

/** #849 the home view: { target, position, distance } of a camera along HOME_DIR that frames the whole city and its tallest top, in a frame of `aspect` (none yet: 1.6). */
export function cityFrame(layout, aspect) {
  const b = layout.bounds;
  const target = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  const probe = new THREE.PerspectiveCamera(FOV, aspect > 0 ? aspect : 1.6, 1, 1e6);
  const distance = fitPoints(probe, target, HOME_DIR, framePoints(layout), 1e5);
  return { target, position: target.clone().addScaledVector(HOME_DIR, distance), distance };
}

/** #849 whether every point of the home view (cityFrame's) shows through `camera`, inside 95% of the frame. */
export function cityFramed(layout, camera) {
  const v = new THREE.Vector3();
  return framePoints(layout).every((p) => { v.copy(p).project(camera); return v.z < 1 && Math.abs(v.x) <= 0.95 && Math.abs(v.y) <= 0.95; });
}

/** #849 the distance after a HUD zoom click: ZOOM_STEP of the distance closer ('in') or the inverse away ('out'); a click out that passes near the home view lands on it. */
export function zoomDistance(distance, direction, homeDistance) {
  if (direction !== 'out') return distance * (1 - ZOOM_STEP);
  const next = distance / (1 - ZOOM_STEP);
  return distance < homeDistance && Math.abs(next - homeDistance) <= homeDistance * 0.05 ? homeDistance : next;
}

// the POC's slab: a rounded box over a ground rect, its top at `top`, `thick` tall
function Slab({ r, top, thick, radius, c, map, rough = 0.95, castShadow = true, ...rest }) {
  const geo = useDisposable(() => rbox(r.w, thick, r.d, radius), [r.w, r.d, thick, radius]);
  const material = useDisposable(() => {
    const m = new THREE.MeshStandardMaterial({ color: c, roughness: rough });
    if (map) { m.map = map.clone(); m.map.needsUpdate = true; m.map.repeat.set(r.w / 14, r.d / 14); }
    return m;
  }, [c, rough, map, r.w, r.d]);
  return <mesh geometry={geo} material={material} position={[r.x + r.w / 2, top - thick / 2, r.z + r.d / 2]} castShadow={castShadow} receiveShadow {...rest} />;
}

// a name lying in its strip on the ground (vertical strips read south to north)
function GroundLabel({ text, sub, strip, y, ink, T, centre = false, visible = true }) {
  const len = strip.vertical ? strip.d : strip.w, thick = strip.vertical ? strip.w : strip.d;
  const tex = useDisposable(() => labelTexture(text, sub, len, thick, ink, { centre, dark: T.dark }), [text, sub, len, thick, ink, centre, T.dark]);
  if (len <= 2 || thick <= 1) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, strip.vertical ? Math.PI / 2 : 0]} position={[strip.x + strip.w / 2, y, strip.z + strip.d / 2]} visible={visible} renderOrder={1}>
      <planeGeometry args={[len, thick]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

// ---------- the ground ----------

// rounded slabs in one instanced mesh (the district sidewalks, the lawns): `rects` at `top`, `thick` tall
function Slabs({ rects, top, thick, radius, c, rough = 0.9 }) {
  const ref = useRef();
  const res = useDisposable(() => [unitBox(), roundedMaterial(radius, { roughness: rough })], [radius, rough]);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    rects.forEach((r, i) => { tmp.position.set(r.x + r.w / 2, top - thick / 2, r.z + r.d / 2); tmp.scale.set(r.w, thick, r.d); tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix); });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [rects, top, thick]);
  if (!rects.length) return null;
  return <instancedMesh key={rects.length} ref={ref} args={[res[0], res[1], rects.length]} material-color={c} receiveShadow raycast={noRaycast} />;
}

function Ground({ layout, T, labelled, store, uniforms }) {
  const b = layout.bounds, k = layout.scale || 1;
  const kindOf = useMemo(() => Object.fromEntries(layout.zones.map((z) => [z.id, z.kind])), [layout]);
  // quiet lane markings along the avenues' centre lines, and the crosswalks (#450)
  const dashes = useMemo(() => {
    const out = [];
    for (const a of layout.avenues) {
      for (let t = 6 * k; t < a.length - 4 * k; t += 11 * k) {
        out.push(a.axis === 'x' ? { x: a.x + t + 1.75 * k, z: a.z, sx: 3.5 * k, sz: 0.45 * k } : { x: a.x, z: a.z + t + 1.75 * k, sx: 0.45 * k, sz: 3.5 * k });
      }
    }
    return [...out, ...crosswalksOf(layout)];
  }, [layout, k]);
  // the sidewalk around every district plate and the lawn in front of its buildings (#450)
  const walks = useMemo(() => layout.districts.filter((d) => d.cell).map((d) => inset(d.cell, (STREET / 2 - 1.3) * k)), [layout, k]);
  const lawns = useMemo(() => lawnsOf(layout).filter(Boolean), [layout]);
  const water = useDisposable(() => waterMaterial(uniforms, '#ffffff'), [uniforms]);
  water.color.set(T.water);
  const dashRef = useRef();
  const dashGeo = useDisposable(() => flatPlane(), []);
  useLayoutEffect(() => {
    const m = dashRef.current;
    if (!m) return;
    dashes.forEach((d, i) => { tmp.position.set(d.x, 0.09, d.z); tmp.scale.set(d.sx, 1, d.sz); tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix); });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [dashes]);
  // the district plates: one instanced mesh, round corners of the POC's radius, coloured by their zone's kind
  const plateRef = useRef();
  const plate = useDisposable(() => [unitBox(), roundedMaterial(1.0 * k, { roughness: 0.85 })], [k]);
  useLayoutEffect(() => {
    const m = plateRef.current;
    if (!m) return;
    const thick = PLATE_TOP - ZONE_TOP + 0.1;
    layout.districts.forEach((d, i) => {
      tmp.position.set(d.x + d.w / 2, PLATE_TOP - thick / 2, d.z + d.d / 2);
      tmp.scale.set(d.w, thick, d.d);
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
  // the floor: a quay past the ring road; the water around it, under the ports' piers (the POC's build)
  const floor = inset(layout.ring, -QUAY * k);
  const sea = { x: b.minX - SHORE * k, z: b.minZ - SHORE * k, w: b.maxX - b.minX + 2 * SHORE * k, d: b.maxZ - b.minZ + 2 * SHORE * k };
  return (
    <group>
      <Slab r={sea} top={-0.18} thick={0.4} radius={14 * k} c={T.water} castShadow={false} material={water} raycast={noRaycast} />
      <Slab r={floor} top={0} thick={0.6} radius={4 * k} c={T.floor} castShadow={false} />
      <Slabs rects={walks} top={ZONE_TOP + 0.14} thick={0.24} radius={0.8 * k} c={T.pad} />
      <Slabs rects={lawns} top={PLATE_TOP + 0.05} thick={0.1} radius={0.3 * k} c={T.lawn} rough={1} />
      <Slab r={layout.ring} top={0.06} thick={0.12} radius={2.5 * k} c={T.lane} castShadow={false} />
      <instancedMesh ref={dashRef} args={[dashGeo, undefined, Math.max(1, dashes.length)]} count={dashes.length} position-y={0} raycast={noRaycast}>
        <meshBasicMaterial color={T.dash} transparent opacity={0.55} />
      </instancedMesh>
      {layout.zones.map((z) => (
        <group key={z.id}>
          <Slab r={inset(z.cell, layout.avenueWidth / 2 - SIDEWALK_AV * k)} top={SIDEWALK_TOP} thick={SIDEWALK_TOP + 0.1} radius={1.6 * k} c={T.pad} rough={0.9} />
          <Slab r={z} top={ZONE_TOP} thick={ZONE_TOP - SIDEWALK_TOP + 0.1} radius={1.4 * k} c="#ffffff" map={groundTexture(z.kind, T)}
            onPointerMove={hover('zone', z.id)} onPointerOut={() => store.hover(null)} onClick={pick('zone', z.id)} />
          {z.label && <GroundLabel text={z.name} sub={`  ${z.kind}`} strip={z.label} y={ZONE_TOP + 0.03} ink={T.kind(z.kind).ink} T={T} centre />}
        </group>
      ))}
      <instancedMesh ref={plateRef} args={[plate[0], plate[1], Math.max(1, layout.districts.length)]} count={layout.districts.length} castShadow receiveShadow
        onPointerMove={(e) => hover('district', district(e))(e)} onPointerOut={() => store.hover(null)} onClick={(e) => pick('district', district(e))(e)} />
      {layout.districts.map((d) => d.label && (
        <GroundLabel key={d.id} text={d.name} sub={`  ${d.files}`} strip={d.label} y={PLATE_TOP + 0.03} T={T}
          ink={mix(T.kind(kindOf[d.zone]).ink, T.dark ? '#ffffff' : '#000000', 0.2)} visible={labelled.includes(d.id)} />
      ))}
    </group>
  );
}

// ---------- buildings ----------

/** The colour of every building: the paint (colour by, the overlay's greying), the pinned `focus` dimming the rest by `dim` (0..1, the fade), a hovered building's connections (`hoverLit`) lightened; nothing else changes with the hover. */
export function buildingColours(layout, paint, { focus = null, hoverLit = null, dim = 0, T }) {
  return layout.buildings.map((_, i) => {
    let c = paint.greyed?.[i] ? T.dim : paint.colours?.[i] || T.muted;
    if (focus && dim > 0 && !focus.lit.has(i)) c = mix(c, T.dim, DIM * dim);
    else if (hoverLit && hoverLit.has(i)) c = mix(c, T.ink, LIT);
    return c;
  });
}

const ACCESSORY = new Set(['amber', 'cap', 'green', 'metal', 'warn']); // the roles a greyed building greys too
const built = new WeakMap();

/** The v2 building of every file of `layout` (packages/shared/city-buildings.js buildingOf), once per layout: a complex is measured against its district's median footprint. */
export function buildingsOf(layout) {
  if (!layout) return [];
  if (built.has(layout)) return built.get(layout);
  const areas = {};
  for (const b of layout.buildings) (areas[b.district] ||= []).push(b.w * b.d);
  const median = {};
  for (const id of Object.keys(areas)) { const a = areas[id].sort((x, y) => x - y); median[id] = a[Math.floor(a.length / 2)] || 0; }
  const out = layout.buildings.map((b) => buildingOf(b, { medianArea: median[b.district] }));
  built.set(layout, out);
  return out;
}

// the parts of a layout in the instanced meshes: each part's slot in its kind's mesh, the building
// each pickable slot belongs to, the animated parts (crane arms, warning lights)
function slotsOf(layout) {
  const list = buildingsOf(layout), counts = Object.fromEntries(Object.keys(KINDS).map((k) => [k, 0]));
  const slots = list.map((x) => x.parts.map((p) => counts[p.g]++));
  const owner = Object.fromEntries(Object.keys(KINDS).filter((k) => KINDS[k].pick).map((k) => [k, new Int32Array(Math.max(1, counts[k]))]));
  const moving = [];
  list.forEach((x, i) => x.parts.forEach((p, k) => {
    if (owner[p.g]) owner[p.g][slots[i][k]] = i;
    if (p.crane || (p.g === 'light' && p.role === 'warn')) moving.push({ i, p, slot: slots[i][k] });
  }));
  return { list, counts, slots, owner, moving };
}

const m4 = new THREE.Matrix4(), mR = new THREE.Matrix4(), mT = new THREE.Matrix4(), mS = new THREE.Matrix4();
const quat = new THREE.Quaternion(), euler = new THREE.Euler(), at3 = new THREE.Vector3(), scale3 = new THREE.Vector3();
// a part's matrix on its lot (cx, cz the lot's centre), `s` 0 to hide it
const partMatrix = (cx, cz, p, s) => m4.compose(at3.set(cx + p.x, Y0 + p.y, cz + p.z), quat.setFromEuler(euler.set(0, p.ry || 0, 0)), scale3.set(Math.max(0.03, p.w) * s, Math.max(0.03, p.h) * s, Math.max(0.03, p.d) * s));

const BLACK = new THREE.Color('#000000'), WHITE = new THREE.Color('#ffffff');
const ROLES = Object.fromEntries(['amber', 'body', 'cap', 'glass', 'green', 'metal', 'roof', 'trim', 'warn'].map((r) => [r, new THREE.Color()]));

// the colour of every part: its building's (buildingColours, then a touch of its own tone so
// neighbours differ), then its role's (the POC's roles); a greyed building greys its accessories too
function paintBuildings(meshes, set, layout, paint, focus, hoverLit, dim, T) {
  const colours = buildingColours(layout, paint, { focus, hoverLit, dim, T });
  const R = ROLES, roofTo = new THREE.Color(T.dark ? '#0e1014' : '#ffffff'), accent = new THREE.Color(T.accent);
  R.metal.set(T.mast); R.green.set(T.garden); R.warn.set(T.status.failed); R.amber.set(T.status.changes); R.cap.set(T.status.pending);
  const metal = R.metal.clone(), green = R.green.clone(), warn = R.warn.clone(), amber = R.amber.clone(), cap = R.cap.clone();
  set.list.forEach((x, i) => {
    const c = R.body.set(colours[i]).lerp(x.tint < 0.5 ? BLACK : WHITE, Math.abs(x.tint - 0.5) * 0.22);
    R.trim.copy(c).lerp(BLACK, T.dark ? 0.3 : 0.2); R.roof.copy(c).lerp(roofTo, 0.42); R.glass.copy(c).lerp(accent, 0.55);
    const grey = !!paint.greyed?.[i];
    if (grey) for (const r of ACCESSORY) R[r].copy(R.trim);
    x.parts.forEach((p, k) => meshes[p.g].setColorAt(set.slots[i][k], R[p.role] || c));
    if (grey) { R.metal.copy(metal); R.green.copy(green); R.warn.copy(warn); R.amber.copy(amber); R.cap.copy(cap); }
  });
  for (const m of Object.values(meshes)) if (m.instanceColor) m.instanceColor.needsUpdate = true;
}

// whether the city may move by itself (crane arms, warning lights)
const moves = () => !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

function Buildings({ layout, T, paint, tests, level, focus, hoverLit, store }) {
  const set = useMemo(() => slotsOf(layout), [layout]);
  const geos = useDisposable(() => partGeometries(), []);
  const uniforms = useMemo(() => ({ uNight: { value: 0 }, uTime: { value: 0 } }), []);
  const mats = useDisposable(() => Object.fromEntries(Object.entries(KINDS).map(([k, o]) => [k,
    k === 'box' ? windowMaterial(uniforms, { floorH: FLOOR_H, pitch: WIN_PITCH })
      : o.basic ? new THREE.MeshBasicMaterial({ toneMapped: false }) : new THREE.MeshStandardMaterial({ roughness: 0.7, ...o.params })])), [uniforms]);
  // one instanced mesh per part kind, made again with the layout
  const meshes = useMemo(() => Object.fromEntries(Object.keys(KINDS).map((k) => {
    const m = new THREE.InstancedMesh(geos[k], mats[k], Math.max(1, set.counts[k]));
    Object.assign(m, { count: set.counts[k], castShadow: KINDS[k].shadow !== false, receiveShadow: true, frustumCulled: false });
    if (!KINDS[k].pick) m.raycast = noRaycast;
    return [k, m];
  })), [set, geos, mats]);
  useEffect(() => () => { for (const m of Object.values(meshes)) m.dispose(); }, [meshes]);
  const motion = useMemo(moves, []);
  useLayoutEffect(() => {
    const B = layout.buildings, maxChurn = B.reduce((m, b) => Math.max(m, b.churn || 0), 1);
    const kindOf = Object.fromEntries(layout.zones.map((z) => [z.id, z.kind]));
    const win = new Float32Array(Math.max(1, set.counts.box) * 4), style = new Float32Array(Math.max(1, set.counts.box) * 4);
    B.forEach((b, i) => {
      const s = tests || !b.test ? 1 : 0, cx = b.x + b.w / 2, cz = b.z + b.d / 2, facade = T.facade(kindOf[b.zone]);
      const lit = b.test ? 0.05 : 0.1 + 0.6 * (Math.log1p(b.churn || 0) / Math.log1p(maxChurn)); // the share of lit windows: the churn
      set.list[i].parts.forEach((p, k) => {
        const j = set.slots[i][k];
        meshes[p.g].setMatrixAt(j, partMatrix(cx, cz, p, s));
        if (p.g === 'box') { win.set([p.win ? 1 : 0, (hashOf(`${b.path}:${k}`) % 1000) / 1000, lit, p.h], j * 4); style.set(facade, j * 4); }
      });
    });
    geos.box.setAttribute('aWin', new THREE.InstancedBufferAttribute(win, 4));
    geos.box.setAttribute('aStyle', new THREE.InstancedBufferAttribute(style, 4));
    for (const m of Object.values(meshes)) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
    uniforms.uNight.value = T.night;
    store.invalidate();
  }, [layout, set, meshes, geos, uniforms, tests, T, store]);
  // the fade of the dimming: toward 1 while something is pinned, toward 0 when nothing is
  const fade = useMemo(() => ({ value: 0 }), []);
  const want = focus ? 1 : 0;
  useLayoutEffect(() => {
    paintBuildings(meshes, set, layout, paint, focus, hoverLit, fade.value, T);
    store.invalidate();
  }, [meshes, set, layout, paint, focus, hoverLit, T, store, fade]);
  useFrame(({ clock }, dt) => {
    if (fade.value !== want) {
      const step = Math.min(dt, 0.1) * (1000 / DIM_MS);
      fade.value = want > fade.value ? Math.min(want, fade.value + step) : Math.max(want, fade.value - step);
      paintBuildings(meshes, set, layout, paint, focus || store.lastFocus, hoverLit, fade.value, T);
      store.invalidate();
    }
    // the living city, near: the crane arms swing around their mast, the warning lights pulse
    if (!motion || level < 1 || !set.moving.length) return;
    const t = clock.elapsedTime;
    uniforms.uTime.value = t;
    for (const { i, p, slot } of set.moving) {
      const b = layout.buildings[i], s = tests || !b.test ? 1 : 0, cx = b.x + b.w / 2, cz = b.z + b.d / 2;
      if (p.crane) {
        const k = p.crane;
        m4.makeTranslation(cx + k.x, Y0 + k.y, cz + k.z).multiply(mR.makeRotationY(Math.sin(t * 0.11 + k.seed) * 1.1))
          .multiply(mT.makeTranslation(p.x - k.x, p.y - k.y, p.z - k.z)).multiply(mS.makeScale(p.w * s, p.h * s, p.d * s));
      } else {
        const r = p.w * (0.5 + 0.5 * Math.max(0, Math.sin(t * 5 + slot))) * s;
        m4.makeTranslation(cx + p.x, Y0 + p.y, cz + p.z).multiply(mS.makeScale(r, r, r));
      }
      meshes[p.g].setMatrixAt(slot, m4);
      meshes[p.g].instanceMatrix.needsUpdate = true;
    }
    store.invalidate();
  });
  if (focus) store.lastFocus = focus; // what fades out when the pins go
  const path = (k, e) => layout.buildings[set.owner[k]?.[e.instanceId]]?.path;
  const pointer = (k) => (KINDS[k].pick ? {
    onPointerMove: (e) => { e.stopPropagation(); store.hover('building', path(k, e), e.nativeEvent); },
    onPointerOut: () => store.hover(null),
    onClick: (e) => { e.stopPropagation(); if (e.delta <= 4) store.pick('building', path(k, e)); },
  } : {});
  const shown = (k) => !KINDS[k].detail || level >= 1;
  return (
    <group>
      {Object.entries(meshes).map(([k, m]) => <primitive key={`${k}:${m.uuid}`} object={m} visible={shown(k)} {...pointer(k)} />)}
    </group>
  );
}

// the halo of the hovered building and a ring under each pinned one, as tall as its body (the POC's placeHalo)
function Halos({ layout, T, hover, pins, topOf }) {
  const at = useMemo(() => Object.fromEntries(layout.buildings.map((b) => [b.path, b])), [layout]);
  const box = useDisposable(() => buildingBox(), []);
  const ring = useDisposable(() => new THREE.RingGeometry(1, 1.08, 48), []);
  const h = hover?.kind === 'building' ? at[hover.id] : null;
  const tall = (b) => Math.min(b.h, topOf[b.path] ?? b.h);
  return (
    <group>
      {h && (
        <mesh geometry={box} position={[h.x + h.w / 2, Y0 - 0.02, h.z + h.d / 2]} scale={[h.w + 0.7, tall(h) + 0.42, h.d + 0.7]} raycast={noRaycast}>
          <meshBasicMaterial color={T.ink} transparent opacity={0.18} depthWrite={false} />
        </mesh>
      )}
      {pins.map((p) => at[p]).filter(Boolean).map((b) => {
        const r = Math.max(b.w, b.d) / 2 + 1.6;
        return (
          <group key={b.path}>
            <mesh geometry={box} position={[b.x + b.w / 2, Y0 - 0.02, b.z + b.d / 2]} scale={[b.w + 1, tall(b) + 0.6, b.d + 1]} raycast={noRaycast}>
              <meshBasicMaterial color={T.accent} transparent opacity={0.3} depthWrite={false} toneMapped={false} />
            </mesh>
            <mesh geometry={ring} rotation-x={-Math.PI / 2} position={[b.x + b.w / 2, Y0 + 0.08, b.z + b.d / 2]} scale={[r, r, 1]} raycast={noRaycast}>
              <meshBasicMaterial color={T.accent} transparent opacity={0.7} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ---------- landmarks, ports, markers, arcs ----------

// the top of a building: its highest part (the v2 building's `top`), its body and mast without one
const topIn = (topOf, b) => topOf?.[b.path] ?? b.h + (b.antenna || 0);

function Landmarks({ layout, T, topOf }) {
  const at = useMemo(() => Object.fromEntries(layout.buildings.map((b) => [b.path, b])), [layout]);
  const pole = useDisposable(() => mastBox(), []);
  return layout.landmarks.map((l) => {
    const b = at[l.path];
    if (!b) return null;
    const px = b.x + b.w / 2 + b.w * 0.32, pz = b.z + b.d / 2 - b.d * 0.32, roof = Y0 + Math.min(b.h, topIn(topOf, b)), top = Y0 + topIn(topOf, b) + 3;
    return (
      <group key={l.path}>
        <Slab r={{ x: b.x - 1.3, z: b.z - 1.3, w: b.w + 2.6, d: b.d + 2.6 }} top={Y0 + 0.5} thick={0.5} radius={0.25} c={T.plinth} rough={0.8} raycast={noRaycast} />
        <mesh geometry={pole} position={[px, roof, pz]} scale={[1.3, top - roof, 1.3]} castShadow><meshStandardMaterial color={T.mast} roughness={0.5} /></mesh>
        <mesh position={[px, top + 0.6, pz]} castShadow><sphereGeometry args={[1.0, 16, 12]} /><meshStandardMaterial color={T.beacon} emissive={T.beacon} emissiveIntensity={0.8} roughness={0.4} /></mesh>
      </group>
    );
  });
}

// the POC's arc from a to b, lifted with the distance, into `out` as line segments
function arc(out, a, b, segments = 18) {
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  mid.y = Math.max(a.y, b.y) + 6 + a.distanceTo(b) * 0.22;
  const pts = new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(segments);
  for (let i = 0; i < pts.length - 1; i++) out.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
}

const roofOf = (b, top) => new THREE.Vector3(b.x + b.w / 2, Y0 + (top ?? b.h + (b.antenna || 0)), b.z + b.d / 2);

// the arcs of a dependency: dashed (the POC's arcsOut / arcsIn; three's LineDashedMaterial has no
// dash offset, so the dashes stay still, as in the POC), or plain
function Arcs({ segments, color, opacity = 0.95, dashed = true }) {
  const ref = useRef();
  const geo = useDisposable(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
    return g;
  }, [segments]);
  useLayoutEffect(() => { if (dashed) ref.current?.computeLineDistances(); }, [geo, dashed]);
  if (!segments.length) return null;
  return (
    <lineSegments ref={ref} geometry={geo} raycast={noRaycast} renderOrder={2}>
      {dashed
        ? <lineDashedMaterial color={color} transparent opacity={opacity} dashSize={2.4} gapSize={1.4} depthWrite={false} toneMapped={false} />
        : <lineBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />}
    </lineSegments>
  );
}

const ROOF_LIGHTS = 600;
// a light on the roof of every connected file (the POC's lightRoofs): the hovered or pinned file in
// the ink, what it requires in the accent, what requires it in amber
function RoofLights({ layout, focuses, tops, T }) {
  const ref = useRef();
  const res = useDisposable(() => [new THREE.SphereGeometry(0.5, 12, 10), new THREE.MeshBasicMaterial({ toneMapped: false })], []);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    let n = 0;
    const put = (i, colour, size) => {
      const b = layout.buildings[i];
      if (n >= ROOF_LIGHTS || !b) return;
      tmp.position.set(b.x + b.w / 2, Y0 + (tops[i] ?? b.h) + 0.3, b.z + b.d / 2);
      tmp.scale.setScalar(size);
      tmp.updateMatrix();
      m.setMatrixAt(n, tmp.matrix);
      m.setColorAt(n++, tint.set(colour));
    };
    for (const f of focuses) {
      if (!f?.roofs) continue;
      for (const i of f.roofs.centre) put(i, T.ink, 1.1);
      for (const i of f.roofs.to) put(i, T.accent, 0.8);
      for (const i of f.roofs.from) put(i, T.status.changes, 0.8);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [layout, focuses, tops, T]);
  return <instancedMesh ref={ref} args={[res[0], res[1], ROOF_LIGHTS]} frustumCulled={false} raycast={noRaycast} />;
}

function Ports({ layout, T, topOf }) {
  const at = useMemo(() => Object.fromEntries(layout.buildings.map((b) => [b.path, b])), [layout]);
  const mastOf = (p) => ({ x: p.x + (p.along ? 4.5 : 0), z: p.z + (p.along ? 0 : 4.5) });
  const segments = useMemo(() => {
    const out = [];
    for (const p of layout.ports) {
      const m = mastOf(p);
      for (const v of p.via) if (at[v]) arc(out, new THREE.Vector3(m.x, 7.7, m.z), new THREE.Vector3(at[v].x + at[v].w / 2, Y0 + Math.min(at[v].h, topIn(topOf, at[v])), at[v].z + at[v].d / 2));
    }
    return out;
  }, [layout, at, topOf]);
  const pole = useDisposable(() => mastBox(), []);
  return (
    <group>
      {layout.ports.map((p) => {
        const m = mastOf(p);
        const dock = p.along ? { w: 16, d: 9 } : { w: 9, d: 16 }, hall = p.along ? { w: 7, d: 4 } : { w: 4, d: 7 };
        const hx = p.x - (p.along ? 3.5 : 0), hz = p.z - (p.along ? 0 : 3.5);
        return (
          <group key={p.id}>
            <Slab r={{ x: p.x - dock.w / 2, z: p.z - dock.d / 2, w: dock.w, d: dock.d }} top={0.7} thick={0.7} radius={0.3} c={T.dock} rough={0.85} />
            <Slab r={{ x: hx - hall.w / 2, z: hz - hall.d / 2, w: hall.w, d: hall.d }} top={3.7} thick={3} radius={0.35} c={T.hall} rough={0.6} />
            <mesh geometry={pole} position={[m.x, 0.7, m.z]} scale={[1.6, 7, 1.6]} castShadow><meshStandardMaterial color={T.mast} roughness={0.5} /></mesh>
            <mesh position={[m.x, 8, m.z]}><sphereGeometry args={[0.75, 14, 10]} /><meshStandardMaterial color={T.accent} emissive={T.accent} emissiveIntensity={0.8} roughness={0.4} /></mesh>
          </group>
        );
      })}
      <Arcs segments={segments} color={T.accent} opacity={0.4} dashed={false} />
    </group>
  );
}

// the overlay's markers: a pin over the roof (applyOverlay's `y` is the body, the v2 building's top wins)
function Markers({ markers, T, topOf }) {
  const ref = useRef();
  const res = useDisposable(() => [new THREE.ConeGeometry(0.6, 1.6, 16), new THREE.MeshStandardMaterial({ roughness: 0.4 })], []);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    markers.forEach((k, i) => {
      tmp.position.set(k.x, Y0 + (topOf[k.path] ?? k.y) + 1.4, k.z);
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
  }, [markers, T, topOf]);
  return <instancedMesh ref={ref} args={[res[0], res[1], Math.max(1, markers.length)]} count={markers.length} raycast={noRaycast} />;
}

// the arcs of one target (a building or a district) and the buildings it lights; `tops` (per
// building, optional) the roofs the arcs leave from, the body and mast without; `roofs` the indexes
// of the lit roofs (RoofLights): the target, what it requires, what requires it
export function focusOf(layout, target, relationsOf, tops) {
  if (!target) return null;
  const index = new Map(layout.buildings.map((b, i) => [b.path, i]));
  const roof = (i) => roofOf(layout.buildings[i], tops?.[i]);
  if (target.kind === 'building' && index.has(target.id)) {
    const rel = relationsOf('building', target.id);
    const i = index.get(target.id);
    const from = roof(i);
    const lit = new Set([i]);
    const requires = [], requiredBy = [], roofs = { centre: [i], to: [], from: [] };
    for (const p of rel.requires) if (index.has(p)) { const j = index.get(p); lit.add(j); roofs.to.push(j); arc(requires, from, roof(j)); }
    for (const p of rel.requiredBy) if (index.has(p)) { const j = index.get(p); lit.add(j); roofs.from.push(j); arc(requiredBy, roof(j), from); }
    return { lit, requires, requiredBy, roofs };
  }
  if (target.kind === 'district') {
    const rel = relationsOf('district', target.id);
    if (!rel.requires.length && !rel.requiredBy.length) return null;
    const of = Object.fromEntries(layout.districts.map((d) => [d.id, d]));
    const centre = (d) => new THREE.Vector3(d.x + d.w / 2, Y0 + 4, d.z + d.d / 2);
    const ids = new Set([target.id, ...rel.requires, ...rel.requiredBy]);
    const lit = new Set(layout.buildings.flatMap((b, i) => (ids.has(b.district) ? [i] : [])));
    const requires = [], requiredBy = [];
    const self = of[target.id];
    if (!self) return null;
    for (const id of rel.requires) if (of[id]) arc(requires, centre(self), centre(of[id]));
    for (const id of rel.requiredBy) if (of[id]) arc(requiredBy, centre(of[id]), centre(self));
    return { lit, requires, requiredBy, roofs: { centre: [], to: [], from: [] } };
  }
  return null;
}

/** The focus of several targets at once (the pinned card and the connections panel's pins): their lit sets, arcs and roofs merged; null when none has one. */
export function focusOfAll(layout, targets, relationsOf, tops) {
  const parts = targets.map((t) => focusOf(layout, t, relationsOf, tops)).filter(Boolean);
  if (!parts.length) return null;
  const roofs = (k) => parts.flatMap((p) => p.roofs?.[k] || []);
  return {
    lit: new Set(parts.flatMap((p) => [...p.lit])), requires: parts.flatMap((p) => p.requires), requiredBy: parts.flatMap((p) => p.requiredBy),
    roofs: { centre: roofs('centre'), to: roofs('to'), from: roofs('from') },
  };
}

// ---------- lights and camera ----------

function Lights({ layout, T, life }) {
  const b = layout.bounds;
  const sun = useMemo(() => new THREE.DirectionalLight(), []);
  const fill = useMemo(() => new THREE.DirectionalLight(), []);
  useEffect(() => () => { sun.dispose(); fill.dispose(); }, [sun, fill]);
  const dim = life ? 1 : LIFE_DIM;
  useLayoutEffect(() => {
    // the POC's fill: a cool light from the far side, so the shaded faces keep their shape
    fill.position.set(300, 180, -420).normalize().multiplyScalar(Math.max(520, b.size * 1.5)).add(new THREE.Vector3(b.centerX, 0, b.centerZ));
    fill.target.position.set(b.centerX, 0, b.centerZ);
    fill.target.updateMatrixWorld();
    fill.color.set(T.fill);
    fill.intensity = T.fillIntensity * dim;
    sun.color.set(T.moon); // a moonlight in the dark theme
    sun.intensity = T.light.sun * dim;
  }, [fill, sun, b, T, dim]);
  useLayoutEffect(() => {
    const half = b.size * 0.62;
    // the POC's sun: from the north-west, high
    sun.position.set(-12, 26, 15).normalize().multiplyScalar(Math.max(520, b.size * 1.5)).add(new THREE.Vector3(b.centerX, 0, b.centerZ));
    sun.target.position.set(b.centerX, 0, b.centerZ);
    sun.target.updateMatrixWorld();
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: Math.max(1200, b.size * 4) });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.1;
    sun.shadow.radius = 4;
  }, [sun, b, T]);
  return (
    <>
      <hemisphereLight color={T.light.sky} groundColor={T.light.ground} intensity={T.light.hemi * dim} />
      <primitive object={sun} />
      <primitive object={sun.target} />
      <primitive object={fill} />
      <primitive object={fill.target} />
    </>
  );
}

function Rig({ layout, store, T }) {
  const { camera, gl, invalidate, scene, size } = useThree();
  // #849 the home view frames the whole city and its tallest top in the canvas's shape (cityFrame); it follows
  // a resize (the tab shown, the city expanded): the camera goes there while the user has not moved it
  const aspect = size.width && size.height ? size.width / size.height : 0;
  const home = useMemo(() => cityFrame(layout, aspect), [layout, aspect]);
  const homeRef = useRef(home);
  homeRef.current = home;
  const state = useMemo(() => ({ goal: null, frames: 0, since: 0, first: false, input: performance.now(), moved: false, placed: false, told: '' }), []);
  const motion = useMemo(moves, []);
  const controls = useMemo(() => {
    const c = new MapControls(camera, gl.domElement);
    Object.assign(c, { enableDamping: true, dampingFactor: 0.12, minDistance: 12 * (layout.scale || 1), minPolarAngle: 0.3, maxPolarAngle: 1.25, zoomSpeed: 0.8 });
    return c;
  }, [camera, gl, layout.scale]);
  useLayoutEffect(() => {
    controls.maxDistance = home.distance * ZOOM_ROOM;
    camera.near = Math.max(0.5, home.distance / 500);
    camera.far = home.distance * (ZOOM_ROOM + 6);
    camera.updateProjectionMatrix();
    if (!state.moved) {
      // the first view is placed at once; a later resize flies there (or jumps, motion reduced)
      if (state.placed && motion) state.goal = { target: home.target.clone(), dist: home.distance, angle: true };
      else { state.goal = null; controls.target.copy(home.target); camera.position.copy(home.position); }
      state.placed = true;
    }
    invalidate();
  }, [controls, camera, home, state, motion, invalidate]);
  useEffect(() => {
    scene.fog = new THREE.Fog(T.skyHorizon, home.distance * 2.2, home.distance * 4.8);
    invalidate();
    return () => { scene.fog = null; };
  }, [scene, T, home, invalidate]);
  useEffect(() => {
    const onChange = () => invalidate();
    const stop = () => { state.goal = null; state.moved = true; };
    const touched = () => { state.input = performance.now(); };
    controls.addEventListener('change', onChange);
    gl.domElement.addEventListener('pointerdown', stop);
    gl.domElement.addEventListener('wheel', stop, { passive: true });
    const INPUTS = ['keydown', 'pointerdown', 'pointermove', 'wheel'];
    for (const ev of INPUTS) window.addEventListener(ev, touched, { passive: true });
    // the commands of the HUD: the home view, a zoom step ('in' | 'out', #849: zoomDistance), a fly to a target
    store.rig = {
      home: () => { const h = homeRef.current; state.moved = false; state.goal = { target: h.target.clone(), dist: h.distance, angle: true }; invalidate(); },
      zoom: (direction) => {
        const d = camera.position.distanceTo(controls.target);
        state.moved = true;
        state.goal = { target: controls.target.clone(), dist: THREE.MathUtils.clamp(zoomDistance(d, direction, homeRef.current.distance), controls.minDistance, controls.maxDistance), angle: false };
        invalidate();
      },
      fly: (t) => { state.moved = true; state.goal = { target: new THREE.Vector3(t.x, t.y || 0, t.z), dist: t.distance, angle: false }; invalidate(); },
    };
    return () => {
      controls.removeEventListener('change', onChange);
      gl.domElement.removeEventListener('pointerdown', stop);
      gl.domElement.removeEventListener('wheel', stop);
      for (const ev of INPUTS) window.removeEventListener(ev, touched);
      controls.dispose();
      store.rig = null;
    };
  }, [controls, gl, camera, invalidate, store, state]);
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
    // the idle camera: City life on keeps the frames coming, so the drift needs no frame of its own
    if (!g && motion && store.get().cityLife && performance.now() - state.input > IDLE_MS) {
      off.copy(camera.position).sub(controls.target).applyAxisAngle(UP, Math.min(dt, 0.1) * IDLE_TURN);
      camera.position.copy(controls.target).add(off);
    }
    if (controls.update()) invalidate();
    // the level of detail
    const ratio = camera.position.distanceTo(controls.target) / home.distance;
    const level = ratio > LOD_LABELS ? 0 : ratio > LOD_DETAIL ? 1 : 2;
    if (level !== store.get().level) store.set({ level });
    // up close, the district under the camera's target shows its files' scores (the POC's scoresFollow)
    const at = controls.target;
    const scored = level === 2 ? layout.districts.find((d) => at.x >= d.x && at.x <= d.x + d.w && at.z >= d.z && at.z <= d.z + d.d)?.id ?? null : null;
    if (scored !== (store.get().scoreDistrict ?? null)) store.set({ scoreDistrict: scored });
    // the floating tags follow their anchors; one that would overlap another already placed moves up
    // until it is clear (the POC's placeTags), the lowest on screen placed first
    camera.updateMatrixWorld();
    const shown = [];
    for (const [id, el] of store.tagEls) {
      const a = store.tagAnchors.get(id);
      if (!a) continue;
      v.copy(a).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.style.visibility = visible ? '' : 'hidden';
      if (visible) shown.push({ el, x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height - 6 });
    }
    shown.sort((a, b) => b.y - a.y);
    const placed = [];
    for (const s of shown) {
      const w = s.el.offsetWidth || 120, h = (s.el.offsetHeight || 22) + 4;
      const r = { x0: s.x - w / 2, x1: s.x + w / 2, y1: s.y, y0: s.y - h };
      for (let i = 0; i < 12; i++) {
        const hit = placed.find((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0);
        if (!hit) break;
        const dy = r.y1 - hit.y0;
        r.y0 -= dy;
        r.y1 -= dy;
      }
      placed.push(r);
      s.el.style.transform = `translate(${s.x.toFixed(1)}px,${r.y1.toFixed(1)}px) translate(-50%,-100%)`;
    }
    // #849: once the camera rests, the HUD hears where it is (once per change, not every frame)
    if (!state.goal && store.onCamera) {
      const distance = camera.position.distanceTo(controls.target);
      const told = `${distance.toFixed(2)}|${home.distance.toFixed(2)}|${size.width}x${size.height}`;
      if (told !== state.told) {
        state.told = told;
        store.onCamera({ distance, home: home.distance, framed: cityFramed(layout, camera) });
      }
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

/** The whole city: lights, camera, ground, buildings, landmarks, ports, markers, the halos and the arcs. */
export function CityScene({ store }) {
  const { layout, layoutKey, paint, tests, level, markers, theme: T, hover, pinned, fly, pins, cityLife = true, glow = true, paused = false } = useStore(store);
  const { invalidate } = useThree();
  store.invalidate = invalidate;
  // #450: the time of the water and the stars; with City life on (and motion allowed) the city lives:
  // a frame after another while the cars drive and the clouds drift, none while it is off screen
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  const motion = useMemo(moves, []);
  useEffect(() => { invalidate(); }, [cityLife, glow, paused, invalidate]);
  useFrame(({ clock }) => {
    if (!cityLife || !motion || store.get().paused) return;
    uniforms.uTime.value = clock.elapsedTime;
    invalidate();
  });
  // what is pinned: the card's target and the connections panel's files
  const pinnedTargets = useMemo(() => {
    const list = pins.map((p) => ({ kind: 'building', id: p }));
    if (pinned && !(pinned.kind === 'building' && pins.includes(pinned.id))) list.push(pinned);
    return list;
  }, [pins, pinned]);
  const pinsKey = pinnedTargets.map((t) => `${t.kind}:${t.id}`).join('|');
  // the v2 buildings' tops, per building and per path (halos, landmarks, ports, markers, arcs, tags)
  const tops = useMemo(() => buildingsOf(layout).map((x) => x.top), [layout]);
  const topOf = useMemo(() => Object.fromEntries(layout.buildings.map((b, i) => [b.path, tops[i]])), [layout, tops]);
  const focus = useMemo(() => focusOfAll(layout, pinnedTargets, store.relationsOf, tops), [layout, pinsKey, store, tops]); // eslint-disable-line react-hooks/exhaustive-deps
  const hovered = hover && !pinnedTargets.some((t) => t.kind === hover.kind && t.id === hover.id) ? hover : null;
  const hoverFocus = useMemo(() => focusOf(layout, hovered, store.relationsOf, tops), [layout, hovered?.kind, hovered?.id, store, tops]); // eslint-disable-line react-hooks/exhaustive-deps
  const pinnedPaths = pinnedTargets.filter((t) => t.kind === 'building').map((t) => t.id);
  const focuses = useMemo(() => [focus, hoverFocus], [focus, hoverFocus]);
  useEffect(() => {
    // the tags' anchors: above a landmark's beacon, a port's mast, a scored building's roof
    const at = Object.fromEntries(layout.buildings.map((b) => [b.path, b]));
    store.tagAnchors = new Map([
      ...layout.landmarks.filter((l) => at[l.path]).map((l) => { const b = at[l.path]; return [`landmark:${l.path}`, new THREE.Vector3(b.x + b.w / 2 + b.w * 0.32, Y0 + topIn(topOf, b) + 5.2, b.z + b.d / 2 - b.d * 0.32)]; }),
      ...layout.ports.map((p) => [`port:${p.id}`, new THREE.Vector3(p.x + (p.along ? 4.5 : 0), 9.4, p.z + (p.along ? 0 : 4.5))]),
      ...layout.buildings.filter((b) => b.score != null).map((b) => [`score:${b.path}`, new THREE.Vector3(b.x + b.w / 2, Y0 + topIn(topOf, b) + 0.8, b.z + b.d / 2)]),
    ]);
    invalidate();
  }, [layout, store, invalidate, topOf]);
  return (
    <group>
      <Lights layout={layout} T={T} life={cityLife} />
      <Rig key={layoutKey} layout={layout} store={store} T={T} />
      <Sky layout={layout} T={T} life={cityLife} motion={motion} uniforms={uniforms} />
      <Ground layout={layout} T={T} labelled={labelsShown(layout, { hover, pinned, fly }).districts} store={store} uniforms={uniforms} />
      <Props layout={layout} T={T} level={level} life={cityLife} store={store} />
      <Pools layout={layout} T={T} life={cityLife} />
      <Traffic layout={layout} life={cityLife} motion={motion} />
      <Glow glow={glow} T={T} />
      <Buildings layout={layout} T={T} paint={paint} tests={tests} level={level} focus={focus} hoverLit={hoverFocus?.lit || null} store={store} />
      <Halos layout={layout} T={T} hover={hovered} pins={pinnedPaths} topOf={topOf} />
      <Landmarks layout={layout} T={T} topOf={topOf} />
      <Ports layout={layout} T={T} topOf={topOf} />
      <Markers markers={markers} T={T} topOf={topOf} />
      <RoofLights layout={layout} focuses={focuses} tops={tops} T={T} />
      {focus && <Arcs segments={focus.requires} color={T.accent} />}
      {focus && <Arcs segments={focus.requiredBy} color={T.status.changes} />}
      {hoverFocus && <Arcs segments={hoverFocus.requires} color={T.accent} />}
      {hoverFocus && <Arcs segments={hoverFocus.requiredBy} color={T.status.changes} />}
    </group>
  );
}
