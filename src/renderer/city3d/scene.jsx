// The project city's scene (#373, bundled by scripts/build-3d.js), in React Three Fiber: it draws the
// layout of src/shared/city-layout.js as it is given (main.jsx's store), with the look of the proof
// of concept poc/project-city.html (#382: its geometry and constants, ported) over the run's 3D
// lights, shadow and themes (theme.js).
// - Ground: the floor slab, the lane slab under the city (the ring road and the avenues, with lane
//   dashes along the avenues' centre lines), per zone a sidewalk, the zone's slab in its kind's
//   ground texture and its name along its avenue side, per district a raised plate (instanced,
//   round corners of a fixed radius: geometry.js roundedMaterial) with its name and file count.
// - Buildings (instanced: geometry.js buildingBox, the POC's rounded box scaled per instance), a few
//   thin ledges each (layout.ledges), masts for the worst function with a cap (red over
//   COMPLEXITY_LIMIT), landmarks (a plinth, a pole and a beacon), ports (a dock, a hall and a mast
//   outside the city edge, arcs to their `via` files) and the overlay's markers (a pin over a roof).
// - Hovering a building shows a halo, draws arcs to what it requires (accent) and to what requires it
//   (amber) and lightens those buildings; nothing else changes colour (#382: no flash across the
//   city). Pinning (a click, or the connections panel's pins) keeps the arcs and a ring, and dims
//   every building outside the pinned connections with a short fade (DIM_MS). A district's hover or
//   pin does the same with district edges (Rust crates).
// - Level of detail, by the camera's distance against the home view's: zones and their names only
//   far away, district names closer (LOD_LABELS), ledges and masts near (LOD_DETAIL).
// - The camera (Rig): MapControls as the run's view, the POC's home view (the whole city in the frame,
//   clear of the HUD: fitDistance), zoom and a fly to a target; the frame loop is on demand (a frame
//   when something moves). The floating tags (landmarks, ports) are DOM nodes moved every frame.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { buildingBox, capBall, flatPlane, groundTexture, labelTexture, mastBox, mix, rbox, roundedMaterial, unitBox } from './geometry.js';
import { useStore } from './store.js';

// the slabs: the floor's top is y = 0; the sidewalk, the zone slab and the district plate stack on it
const SIDEWALK_TOP = 0.22, ZONE_TOP = 0.55, PLATE_TOP = 0.95, Y0 = PLATE_TOP;
const SIDEWALK_AV = 2.6; // the sidewalk along a zone's avenue side
const FLOOR_MARGIN = 44;
const HOME_DIR = new THREE.Vector3(0.5, 1.15, 1).normalize(); // the home view: from the south-east, 46 degrees up
const LOD_LABELS = 0.8, LOD_DETAIL = 0.5; // shares of the home distance
const COMPLEXITY_LIMIT = 25;
const FOV = 30;
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
export function fitDistance(camera, target, dir, rect, top) {
  const corners = [[rect.x, rect.z], [rect.x + rect.w, rect.z], [rect.x, rect.z + rect.d], [rect.x + rect.w, rect.z + rect.d]];
  const points = corners.flatMap(([x, z]) => [new THREE.Vector3(x, 0, z), new THREE.Vector3(x, top, z)]);
  const probe = camera.clone(), v = new THREE.Vector3();
  for (let d = 20; d < 4000; d *= 1.04) {
    probe.position.copy(target).addScaledVector(dir, d);
    probe.lookAt(target);
    probe.updateMatrixWorld();
    if (points.every((p) => { v.copy(p).project(probe); return Math.abs(v.x) < 0.94 && v.y < 0.76 && v.y > -0.95; })) return d;
  }
  return 4000;
}

// a mesh's geometry and material, freed when the component goes
function useDisposable(make, deps) {
  const value = useMemo(make, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { for (const x of [].concat(value)) x?.dispose?.(); }, [value]);
  return value;
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

const inset = (r, m) => ({ x: r.x + m, z: r.z + m, w: Math.max(0, r.w - 2 * m), d: Math.max(0, r.d - 2 * m) });

// ---------- the ground ----------

function Ground({ layout, T, level, store }) {
  const b = layout.bounds, k = layout.scale || 1;
  const kindOf = useMemo(() => Object.fromEntries(layout.zones.map((z) => [z.id, z.kind])), [layout]);
  // quiet lane markings along the avenues' centre lines
  const dashes = useMemo(() => {
    const out = [];
    for (const a of layout.avenues) {
      for (let t = 6 * k; t < a.length - 4 * k; t += 11 * k) {
        out.push(a.axis === 'x' ? { x: a.x + t + 1.75 * k, z: a.z, sx: 3.5 * k, sz: 0.45 * k } : { x: a.x, z: a.z + t + 1.75 * k, sx: 0.45 * k, sz: 3.5 * k });
      }
    }
    return out;
  }, [layout, k]);
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
  const floor = { x: b.minX - FLOOR_MARGIN * k, z: b.minZ - FLOOR_MARGIN * k, w: b.maxX - b.minX + 2 * FLOOR_MARGIN * k, d: b.maxZ - b.minZ + 2 * FLOOR_MARGIN * k };
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[b.centerX, -0.52, b.centerZ]}><circleGeometry args={[b.size * 7, 64]} /><meshBasicMaterial color={T.sky} toneMapped={false} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[b.centerX, -0.51, b.centerZ]} receiveShadow><circleGeometry args={[b.size * 2.5, 64]} /><shadowMaterial opacity={T.shadow.opacity} color={T.shadow.color} /></mesh>
      <Slab r={floor} top={0} thick={0.5} radius={7 * k} c={T.floor} castShadow={false} />
      <Slab r={layout.ring} top={0.06} thick={0.12} radius={2.5 * k} c={T.lane} castShadow={false} />
      <instancedMesh ref={dashRef} args={[dashGeo, undefined, Math.max(1, dashes.length)]} count={dashes.length} position-y={0} raycast={() => null}>
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
          ink={mix(T.kind(kindOf[d.zone]).ink, T.dark ? '#ffffff' : '#000000', 0.2)} visible={level >= 1} />
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

// the colour of every building and ledge, see buildingColours
function paintBuildings({ body, band }, layout, ledges, paint, focus, hoverLit, dim, T) {
  if (!body) return;
  const colours = buildingColours(layout, paint, { focus, hoverLit, dim, T });
  colours.forEach((c, i) => body.setColorAt(i, tint.set(c)));
  if (body.instanceColor) body.instanceColor.needsUpdate = true;
  if (band) {
    ledges.forEach((l, k) => band.setColorAt(k, tint.set(mix(colours[l.i], '#000000', 0.2))));
    if (band.instanceColor) band.instanceColor.needsUpdate = true;
  }
}

function Buildings({ layout, T, paint, tests, level, focus, hoverLit, store }) {
  const body = useDisposable(() => [buildingBox(), new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 })], []);
  const band = useDisposable(() => [buildingBox(), new THREE.MeshStandardMaterial({ roughness: 0.75 })], []);
  const mast = useDisposable(() => [mastBox(), new THREE.MeshStandardMaterial({ roughness: 0.5 })], []);
  const cap = useDisposable(() => [capBall(), new THREE.MeshStandardMaterial({ roughness: 0.4 })], []);
  const bodyRef = useRef(), bandRef = useRef(), mastRef = useRef(), capRef = useRef();
  // the ledges (a few per building, spaced along its height) and the masts, once per layout
  const ledges = useMemo(() => {
    const out = [];
    layout.buildings.forEach((b, i) => { for (let k = 1; k <= (b.ledges || 0); k++) out.push({ i, y: Y0 + (b.h * k) / (b.ledges + 1) - 0.03 }); });
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
      put(bodyRef.current, i, b.x + b.w / 2, Y0, b.z + b.d / 2, Math.max(0.05, b.w) * s, b.h * s, Math.max(0.05, b.d) * s);
    });
    ledges.forEach((l, k) => {
      const b = B[l.i], s = shown(b) ? 1 : 0;
      put(bandRef.current, k, b.x + b.w / 2, l.y, b.z + b.d / 2, (b.w + 0.08) * s, 0.06 * s, (b.d + 0.08) * s);
    });
    masts.forEach(({ b }, k) => {
      const s = shown(b) ? 1 : 0, top = Y0 + b.h;
      put(mastRef.current, k, b.x + b.w / 2, top, b.z + b.d / 2, s, b.antenna * s, s);
      put(capRef.current, k, b.x + b.w / 2, top + b.antenna, b.z + b.d / 2, s, s, s);
      capRef.current.setColorAt(k, tint.set(b.worst > COMPLEXITY_LIMIT ? T.status.failed : T.status.pending));
    });
    for (const m of [bodyRef.current, bandRef.current, mastRef.current, capRef.current]) done(m);
    if (capRef.current.instanceColor) capRef.current.instanceColor.needsUpdate = true;
    mast[1].color.set(T.mast);
    store.invalidate();
  }, [layout, tests, ledges, masts, T, store, mast]);
  // the fade of the dimming: toward 1 while something is pinned, toward 0 when nothing is
  const fade = useMemo(() => ({ value: 0 }), []);
  const want = focus ? 1 : 0;
  useLayoutEffect(() => {
    paintBuildings({ body: bodyRef.current, band: bandRef.current }, layout, ledges, paint, focus, hoverLit, fade.value, T);
    store.invalidate();
  }, [layout, ledges, paint, focus, hoverLit, T, store, fade]);
  useFrame((_, dt) => {
    if (fade.value === want) return;
    const step = Math.min(dt, 0.1) * (1000 / DIM_MS);
    fade.value = want > fade.value ? Math.min(want, fade.value + step) : Math.max(want, fade.value - step);
    paintBuildings({ body: bodyRef.current, band: bandRef.current }, layout, ledges, paint, focus || store.lastFocus, hoverLit, fade.value, T);
    store.invalidate();
  });
  if (focus) store.lastFocus = focus; // what fades out when the pins go
  const path = (e) => layout.buildings[e.instanceId]?.path;
  return (
    <group>
      <instancedMesh ref={bodyRef} args={[body[0], body[1], Math.max(1, layout.buildings.length)]} count={layout.buildings.length} castShadow receiveShadow
        onPointerMove={(e) => { e.stopPropagation(); store.hover('building', path(e), e.nativeEvent); }}
        onPointerOut={() => store.hover(null)}
        onClick={(e) => { e.stopPropagation(); if (e.delta <= 4) store.pick('building', path(e)); }} />
      <instancedMesh ref={bandRef} args={[band[0], band[1], Math.max(1, ledges.length)]} count={ledges.length} visible={level >= 2} raycast={() => null} />
      <instancedMesh ref={mastRef} args={[mast[0], mast[1], Math.max(1, masts.length)]} count={masts.length} visible={level >= 2} castShadow raycast={() => null} />
      <instancedMesh ref={capRef} args={[cap[0], cap[1], Math.max(1, masts.length)]} count={masts.length} visible={level >= 2} raycast={() => null} />
    </group>
  );
}

// the halo of the hovered building and a ring under each pinned one
function Halos({ layout, T, hover, pins }) {
  const at = useMemo(() => Object.fromEntries(layout.buildings.map((b) => [b.path, b])), [layout]);
  const box = useDisposable(() => buildingBox(), []);
  const ring = useDisposable(() => new THREE.RingGeometry(1, 1.08, 48), []);
  const h = hover?.kind === 'building' ? at[hover.id] : null;
  return (
    <group>
      {h && (
        <mesh geometry={box} position={[h.x + h.w / 2, Y0 - 0.02, h.z + h.d / 2]} scale={[h.w + 0.7, h.h + 0.42, h.d + 0.7]} raycast={() => null}>
          <meshBasicMaterial color={T.ink} transparent opacity={0.18} depthWrite={false} />
        </mesh>
      )}
      {pins.map((p) => at[p]).filter(Boolean).map((b) => {
        const r = Math.max(b.w, b.d) / 2 + 1.6;
        return (
          <group key={b.path}>
            <mesh geometry={box} position={[b.x + b.w / 2, Y0 - 0.02, b.z + b.d / 2]} scale={[b.w + 1, b.h + 0.6, b.d + 1]} raycast={() => null}>
              <meshBasicMaterial color={T.accent} transparent opacity={0.3} depthWrite={false} toneMapped={false} />
            </mesh>
            <mesh geometry={ring} rotation-x={-Math.PI / 2} position={[b.x + b.w / 2, Y0 + 0.08, b.z + b.d / 2]} scale={[r, r, 1]} raycast={() => null}>
              <meshBasicMaterial color={T.accent} transparent opacity={0.7} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ---------- landmarks, ports, markers, arcs ----------

function Landmarks({ layout, T }) {
  const at = useMemo(() => Object.fromEntries(layout.buildings.map((b) => [b.path, b])), [layout]);
  const pole = useDisposable(() => mastBox(), []);
  return layout.landmarks.map((l) => {
    const b = at[l.path];
    if (!b) return null;
    const px = b.x + b.w / 2 + b.w * 0.32, pz = b.z + b.d / 2 - b.d * 0.32, roof = Y0 + b.h, top = roof + b.antenna + 3;
    return (
      <group key={l.path}>
        <Slab r={{ x: b.x - 1.3, z: b.z - 1.3, w: b.w + 2.6, d: b.d + 2.6 }} top={Y0 + 0.5} thick={0.5} radius={0.25} c={T.plinth} rough={0.8} raycast={() => null} />
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

const roofOf = (b) => new THREE.Vector3(b.x + b.w / 2, Y0 + b.h + (b.antenna || 0), b.z + b.d / 2);

function Arcs({ segments, color, opacity = 0.85 }) {
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
  const mastOf = (p) => ({ x: p.x + (p.along ? 4.5 : 0), z: p.z + (p.along ? 0 : 4.5) });
  const segments = useMemo(() => {
    const out = [];
    for (const p of layout.ports) {
      const m = mastOf(p);
      for (const v of p.via) if (at[v]) arc(out, new THREE.Vector3(m.x, 7.7, m.z), new THREE.Vector3(at[v].x + at[v].w / 2, Y0 + at[v].h, at[v].z + at[v].d / 2));
    }
    return out;
  }, [layout, at]);
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
      <Arcs segments={segments} color={T.accent} opacity={0.4} />
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
      tmp.position.set(k.x, Y0 + k.y + 1.4, k.z);
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

// the arcs of one target (a building or a district) and the buildings it lights
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
    const centre = (d) => new THREE.Vector3(d.x + d.w / 2, Y0 + 4, d.z + d.d / 2);
    const ids = new Set([target.id, ...rel.requires, ...rel.requiredBy]);
    const lit = new Set(layout.buildings.flatMap((b, i) => (ids.has(b.district) ? [i] : [])));
    const requires = [], requiredBy = [];
    const self = of[target.id];
    if (!self) return null;
    for (const id of rel.requires) if (of[id]) arc(requires, centre(self), centre(of[id]));
    for (const id of rel.requiredBy) if (of[id]) arc(requiredBy, centre(of[id]), centre(self));
    return { lit, requires, requiredBy };
  }
  return null;
}

/** The focus of several targets at once (the pinned card and the connections panel's pins): their lit sets and arcs merged; null when none has one. */
export function focusOfAll(layout, targets, relationsOf) {
  const parts = targets.map((t) => focusOf(layout, t, relationsOf)).filter(Boolean);
  if (!parts.length) return null;
  return { lit: new Set(parts.flatMap((p) => [...p.lit])), requires: parts.flatMap((p) => p.requires), requiredBy: parts.flatMap((p) => p.requiredBy) };
}

// ---------- lights and camera ----------

function Lights({ layout, T }) {
  const b = layout.bounds;
  const sun = useMemo(() => new THREE.DirectionalLight(), []);
  useEffect(() => () => sun.dispose(), [sun]);
  useLayoutEffect(() => {
    const half = b.size * 0.62;
    // the POC's sun: from the north-west, high
    sun.position.set(-12, 26, 15).normalize().multiplyScalar(Math.max(520, b.size * 1.5)).add(new THREE.Vector3(b.centerX, 0, b.centerZ));
    sun.target.position.set(b.centerX, 0, b.centerZ);
    sun.target.updateMatrixWorld();
    sun.intensity = T.light.sun;
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
      <hemisphereLight color={T.light.sky} groundColor={T.light.ground} intensity={T.light.hemi} />
      <primitive object={sun} />
      <primitive object={sun.target} />
    </>
  );
}

function Rig({ layout, store, T }) {
  const { camera, gl, invalidate, scene, size } = useThree();
  const b = layout.bounds;
  // the POC's home view, fixed when the city is laid out: a resize keeps the camera where the user put it
  const home = useMemo(() => {
    const rect = { x: b.minX - 6, z: b.minZ - 6, w: b.maxX - b.minX + 12, d: b.maxZ - b.minZ + 12 };
    const target = new THREE.Vector3(rect.x + rect.w / 2, 0, rect.z + rect.d / 2 + rect.d * 0.1); // a little south of the centre
    const probe = new THREE.PerspectiveCamera(FOV, size.width && size.height ? size.width / size.height : 1.6, 1, 10000);
    const distance = size.width && size.height ? fitDistance(probe, target, HOME_DIR, rect, 12) : homeOf(b, 1.6);
    return { target, distance };
  }, [b]); // eslint-disable-line react-hooks/exhaustive-deps
  const state = useMemo(() => ({ goal: null, frames: 0, since: 0, first: false }), []);
  const controls = useMemo(() => {
    const c = new MapControls(camera, gl.domElement);
    Object.assign(c, { enableDamping: true, dampingFactor: 0.12, minDistance: 12 * (layout.scale || 1), maxDistance: home.distance * 3.2, minPolarAngle: 0.3, maxPolarAngle: 1.25, zoomSpeed: 0.8 });
    c.target.copy(home.target);
    camera.position.copy(c.target).addScaledVector(HOME_DIR, home.distance);
    camera.near = Math.max(0.5, home.distance / 500);
    camera.far = home.distance * 10;
    camera.updateProjectionMatrix();
    return c;
  }, [camera, gl, home, layout.scale]);
  useEffect(() => {
    scene.fog = new THREE.Fog(T.sky, home.distance * 2.2, home.distance * 4.8);
    invalidate();
    return () => { scene.fog = null; };
  }, [scene, T, home, invalidate]);
  useEffect(() => {
    const onChange = () => invalidate();
    const stop = () => { state.goal = null; };
    controls.addEventListener('change', onChange);
    gl.domElement.addEventListener('pointerdown', stop);
    gl.domElement.addEventListener('wheel', stop, { passive: true });
    // the commands of the HUD: the home view, a zoom step, a fly to a target
    store.rig = {
      home: () => { state.goal = { target: home.target.clone(), dist: home.distance, angle: true }; invalidate(); },
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
  }, [controls, gl, camera, invalidate, store, state, home]);
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
    const ratio = camera.position.distanceTo(controls.target) / home.distance;
    const level = ratio > LOD_LABELS ? 0 : ratio > LOD_DETAIL ? 1 : 2;
    if (level !== store.get().level) store.set({ level });
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
  const { layout, layoutKey, paint, tests, level, markers, theme: T, hover, pinned, pins } = useStore(store);
  const { invalidate } = useThree();
  store.invalidate = invalidate;
  // what is pinned: the card's target and the connections panel's files
  const pinnedTargets = useMemo(() => {
    const list = pins.map((p) => ({ kind: 'building', id: p }));
    if (pinned && !(pinned.kind === 'building' && pins.includes(pinned.id))) list.push(pinned);
    return list;
  }, [pins, pinned]);
  const pinsKey = pinnedTargets.map((t) => `${t.kind}:${t.id}`).join('|');
  const focus = useMemo(() => focusOfAll(layout, pinnedTargets, store.relationsOf), [layout, pinsKey, store]); // eslint-disable-line react-hooks/exhaustive-deps
  const hovered = hover && !pinnedTargets.some((t) => t.kind === hover.kind && t.id === hover.id) ? hover : null;
  const hoverFocus = useMemo(() => focusOf(layout, hovered, store.relationsOf), [layout, hovered?.kind, hovered?.id, store]); // eslint-disable-line react-hooks/exhaustive-deps
  const pinnedPaths = pinnedTargets.filter((t) => t.kind === 'building').map((t) => t.id);
  useEffect(() => {
    // the tags' anchors: above a landmark's beacon, a port's mast
    const at = Object.fromEntries(layout.buildings.map((b) => [b.path, b]));
    store.tagAnchors = new Map([
      ...layout.landmarks.filter((l) => at[l.path]).map((l) => { const b = at[l.path]; return [`landmark:${l.path}`, new THREE.Vector3(b.x + b.w / 2 + b.w * 0.32, Y0 + b.h + b.antenna + 5.2, b.z + b.d / 2 - b.d * 0.32)]; }),
      ...layout.ports.map((p) => [`port:${p.id}`, new THREE.Vector3(p.x + (p.along ? 4.5 : 0), 9.4, p.z + (p.along ? 0 : 4.5))]),
    ]);
    invalidate();
  }, [layout, store, invalidate]);
  return (
    <group>
      <Lights layout={layout} T={T} />
      <Rig key={layoutKey} layout={layout} store={store} T={T} />
      <Ground layout={layout} T={T} level={level} store={store} />
      <Buildings layout={layout} T={T} paint={paint} tests={tests} level={level} focus={focus} hoverLit={hoverFocus?.lit || null} store={store} />
      <Halos layout={layout} T={T} hover={hovered} pins={pinnedPaths} />
      <Landmarks layout={layout} T={T} />
      <Ports layout={layout} T={T} />
      <Markers markers={markers} T={T} />
      {focus && <Arcs segments={focus.requires} color={T.accent} />}
      {focus && <Arcs segments={focus.requiredBy} color={T.status.changes} />}
      {hoverFocus && <Arcs segments={hoverFocus.requires} color={T.accent} />}
      {hoverFocus && <Arcs segments={hoverFocus.requiredBy} color={T.status.changes} />}
    </group>
  );
}
