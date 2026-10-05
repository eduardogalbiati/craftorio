// The run's 3D view (bundled by scripts/build-3d.js): the floor and what moves on it, in React Three
// Fiber, drawn from the model the player shows (view.js: the run as it is now, or a replayed moment).
// Ported from poc/run-3d.html, behaviour unchanged; its colours are the theme's (useTheme: the dark
// one of the app, or the light one of the proof of concept), the robots keep their role colours:
// - the floor built from the run's workflow: a desk with one robot per agent for an agent step
//   (Station, Seat), a console with a screen for a step the engine runs itself (Machine), an arch
//   with a barrier and the approver for a human gate (Gate); the lane in front (Route: blue where
//   the work item has been), the issue inbox at its start and the base branch at its end (Floor);
// - the work item as a cart driving the lane to the step the run is at (Courier); a jump of the
//   shown moment (a seek of the replay, back to live) puts it there instead of driving;
// - the supervisor on its podium, sending packets to the step it works on (Supervisor);
// - the robots of src/renderer/robots.js in 3D (Robot): the same boxes and colours (Robots.look),
//   the face, emblem and balloon of their state as textures;
// - the camera (CameraRig): a fixed isometric-like angle easing to a goal (the run, or what is
//   selected); dragging, right-dragging or the wheel hands it to the user (MapControls);
// - the floating tags' positions (TagProjector: DOM nodes moved every frame, no React render).
import { forwardRef, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { MapControls } from 'three/addons/controls/MapControls.js';
import {
  agentDef, entityPos, geoOf, lanePoint, rbox, rig, robotStateOf, STATUS, svgTexture,
  TAG_LIFT, tagEls, textTexture, canvasTexture, fitText, useModel, useTheme, view, VIEW_DIR,
} from './view.js';

const U = 0.01; // robots.js draws in units of 1/100 of ours
const lighten = (h, t) => window.Robots.lighten(h, t);
const darken = (h, t) => window.Robots.darken(h, t);

// a rounded box by its centre and size
const B = forwardRef(({ p, s, c, r, rough = 0.78, emissive, glow = 0, ...rest }, ref) => (
  <mesh ref={ref} position={p} geometry={rbox(s[0], s[1], s[2], r)} castShadow receiveShadow {...rest}>
    <meshStandardMaterial color={c} roughness={rough} emissive={emissive || '#000000'} emissiveIntensity={glow} />
  </mesh>
));
// robots.js box(x, y, z, W, D, H) (x right, y depth, z up, origin at the robot's corner) → centre + size here
const S = (x, y, z, W, D, H, ox = 75, oy = 75) => ({ p: [(x + W / 2 - ox) * U, (z + H / 2) * U, (y + D / 2 - oy) * U], s: [W * U, H * U, D * U] });

// a flat picture on a surface (unlit, so screens and emblems keep their colours)
function Decal({ tex, size, ...rest }) {
  return <mesh {...rest}><planeGeometry args={size} /><meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} /></mesh>;
}
const SVG = (viewBox, w, h, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}">${inner}</svg>`;
const nested = (svg, x, y, w, h) => svg.replace('<svg ', `<svg x="${x}" y="${y}" width="${w}" height="${h}" `);

// the robot's SVG art, cut into the pieces a 3D robot needs
const faceSvg = (v) => SVG('0 0 120 110', 480, 440,
  `<rect x="10" y="20" width="100" height="66" rx="18" fill="${v.screen}" stroke="${v.outline}" stroke-width="3"/>${v.face(v, 'f')}`
  + '<rect x="18" y="26" width="30" height="5" rx="2.5" fill="#fff" opacity=".18"/>');
const chestSvg = (v) => (v.logo
  ? SVG('-11 -11 22 22', 256, 256, nested(window.Robots.emblem(v.logo, v.chestLogo || '#fff'), -11, -11, 22, 22))
  : SVG('-21 -21 42 42', 256, 256, `<rect x="-16" y="-10" width="32" height="20" rx="6" fill="${darken(v.body, 0.12)}" stroke="${v.outline}" stroke-width="2.5"/><circle cx="-6" r="3.5" fill="${v.accent}"/><circle cx="6" r="3.5" fill="${lighten(v.body, 0.5)}"/>`));
const plateSvg = (v) => SVG('-36 -36 72 72', 288, 288, `<circle r="32" fill="${v.plate}" stroke="${v.outline}" stroke-width="4"/>` + (v.logo
  ? nested(window.Robots.emblem(v.logo, v.plateLogo || '#fff'), -22, -22, 44, 44)
  : `<circle r="22" fill="none" stroke="${darken(v.plate, 0.25)}" stroke-width="3"/>`));
const bubbleSvg = (v) => SVG('30 30 184 156', 368, 312, v.overlay.replace('__UNFLIP__', ''));

// A robot of robots.js in 3D: the same boxes (visorBot), its face, emblems and balloon as textures.
function Robot({ variant, color, state, seated = false }) {
  const v = useMemo(() => window.Robots.look(variant, state, color ? { color } : {}), [variant, color, state]);
  const root = useRef(), head = useRef(), armL = useRef(), armR = useRef(), bubble = useRef();
  const seed = useMemo(() => Math.random() * 10, []);
  const antenna = v.antenna || v.accent;
  const ballMat = useMemo(() => new THREE.MeshStandardMaterial({ color: antenna, emissive: antenna, roughness: 0.4 }), [antenna]);
  useEffect(() => () => ballMat.dispose(), [ballMat]);
  useFrame(({ clock }) => {
    if (!root.current) return;
    const t = clock.elapsedTime + seed;
    let x = 0, y = 0, hx = 0, hy = 0, hz = 0, la = 0, ra = 0, glow = 0.9;
    if (state === 'sleeping') { y = Math.sin(t * 1.2) * 0.012; hx = 0.1; glow = 0.1; }
    else if (state === 'thinking') { hz = Math.sin(t * 1.4) * 0.06; hy = Math.sin(t * 0.9) * 0.14; glow = 0.55 + 0.45 * Math.sin(t * 4.5); }
    else if (state === 'reading') { hy = Math.sin(t * 2.4) * 0.22; glow = 0.55 + 0.45 * Math.sin(t * 4.5); }
    else if (state === 'writing') { la = Math.max(0, Math.sin(t * 13)) * 0.07; ra = Math.max(0, -Math.sin(t * 13)) * 0.07; hx = 0.07; }
    else if (state === 'error') { x = Math.sin(t * 38) * 0.03 * (Math.sin(t * 2.6) > 0.2 ? 1 : 0); glow = Math.sin(t * 10) > 0 ? 1 : 0.15; }
    else if (state === 'waiting') { hz = Math.sin(t * 1.1) * 0.05; glow = 0.5 + 0.5 * Math.sin(t * 5); }
    else y = Math.sin(t * 2.1) * (state === 'done' ? 0.05 : 0.022);
    root.current.position.set(x, (seated ? 0.4 : 0) + y, 0);
    head.current.rotation.set(hx, hy, hz);
    armL.current.position.y = la; armR.current.position.y = ra;
    ballMat.emissiveIntensity = glow;
    if (bubble.current) bubble.current.position.y = 2.72 + Math.sin(t * 2.2) * 0.05;
  });
  const body = S(40, 40, 44, 70, 70, 60);
  return (
    <group ref={root}>
      {!seated && <B {...S(0, 0, 0, 150, 190, 16)} c={v.base} r={0.05} />}
      <B {...S(48, 78, 16, 22, 22, 28)} c={v.limb} />
      <B {...S(80, 78, 16, 22, 22, 28)} c={v.limb} />
      <group ref={armL}><B {...S(20, 76, 48, 20, 24, 40)} c={v.limb} r={0.05} /></group>
      <group ref={armR}><B {...S(110, 76, 48, 20, 24, 40)} c={v.limb} r={0.05} /></group>
      <B {...body} c={v.body} r={0.07} rough={0.6} />
      <Decal tex={svgTexture(chestSvg(v), 256, 256)} size={[0.42, 0.42]} position={[0, body.p[1], 0.357]} />
      <group ref={head} position={[0, 1.59, 0]}>
        <B p={[0, 0, 0]} s={[1.2, 1.1, 1.2]} c={v.head} r={0.11} rough={0.6} />
        <Decal tex={svgTexture(faceSvg(v), 480, 440)} size={[1.2, 1.1]} position={[0, 0, 0.607]} />
        <Decal tex={svgTexture(plateSvg(v), 288, 288)} size={[0.72, 0.72]} position={[0.607, 0, 0]} rotation={[0, Math.PI / 2, 0]} />
        {[-0.3, 0.3].map((x) => (
          <group key={x} position={[x, 0.55, 0]}>
            <mesh position={[0, 0.12, 0]} castShadow><cylinderGeometry args={[0.025, 0.025, 0.24, 8]} /><meshStandardMaterial color={v.outline} /></mesh>
            <mesh position={[0, 0.26, 0]} material={ballMat} castShadow><sphereGeometry args={[0.095, 16, 12]} /></mesh>
          </group>
        ))}
      </group>
      {v.overlay && (
        <sprite ref={bubble} position={[-0.95, 2.72, 0.95]} scale={[1.3, 1.1, 1]}>
          <spriteMaterial map={svgTexture(bubbleSvg(v), 368, 312)} transparent depthWrite={false} toneMapped={false} />
        </sprite>
      )}
    </group>
  );
}

// the pointer over a clickable thing (the overlay's cursor, not the page's)
const pointer = {
  onPointerOver: (e) => { e.stopPropagation(); if (view.root) view.root.style.cursor = 'pointer'; },
  onPointerOut: () => { if (view.root) view.root.style.cursor = ''; },
};
const clicks = (id, onSelect) => ({ onClick: (e) => { e.stopPropagation(); onSelect(id); }, ...pointer });

// The ring on the floor under the selected entity.
function SelectionRing({ r = 2.5 }) {
  const ref = useRef(), T = useTheme();
  useFrame(({ clock }) => { ref.current.material.opacity = 0.55 + 0.25 * Math.sin(clock.elapsedTime * 3); });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position-y={0.1}>
      <ringGeometry args={[r, r + 0.12, 64, 1]} /><meshBasicMaterial color={T.accent} transparent toneMapped={false} />
    </mesh>
  );
}

// The pad every station stands on; its front light shows the step's status.
function Pad({ st, width = 4.1, selected }) {
  const status = useModel((m) => m.state[st.id]?.status || 'pending');
  const light = useRef(), T = useTheme(), col = T.status[status];
  useFrame(({ clock }) => {
    const live = status === 'running' || status === 'failed' || status === 'waiting';
    light.current.material.emissiveIntensity = live ? 0.75 + 0.45 * Math.sin(clock.elapsedTime * 5) : status === 'pending' ? 0.05 : 0.7;
  });
  return (
    <group>
      <B p={[0, 0.04, 0.45]} s={[width, 0.08, 4.5]} c={T.pad} r={0.04} />
      <B ref={light} p={[0, 0.09, 2.45]} s={[2.6, 0.05, 0.16]} c={col} emissive={col} r={0.02} castShadow={false} />
      <mesh position={[0, 0.03, view.model.layout().lane]} rotation-x={-Math.PI / 2}><ringGeometry args={[0.5, 0.62, 32]} /><meshBasicMaterial color={col} toneMapped={false} /></mesh>
      {selected && <group position-z={0.45}><SelectionRing r={width / 2 + 0.85} /></group>}
    </group>
  );
}

// One agent at a desk: its chair, its robot and its laptop (as in robots.js desk()).
function Seat({ st, agent, x }) {
  const key = `${st.id}:${agent}`, def = agentDef(agent), T = useTheme(), CHAIR = T.chair;
  const state = useModel(() => robotStateOf(key));
  const busy = useModel((m) => !!m.robots[key]?.busy);
  const screen = useRef();
  useFrame(({ clock }) => { screen.current.material.opacity = busy ? 0.75 + 0.25 * Math.sin(clock.elapsedTime * 9) : 0.12; });
  return (
    <group position-x={x}>
      <B {...S(10, -26, 44, 130, 16, 150)} c={CHAIR} r={0.06} />
      <B {...S(62, 70, 0, 26, 26, 40)} c={darken(CHAIR, 0.2)} />
      <B {...S(0, 10, 40, 150, 170, 14)} c={CHAIR} r={0.05} />
      <Robot variant={def.variant} color={def.color} state={state} seated />
      <B {...S(50, 174, 152, 84, 56, 5)} c={T.laptop} r={0.02} />
      <B {...S(50, 230, 152, 84, 5, 46)} c={T.laptopLid} r={0.02} />
      <mesh ref={screen} position={[0.17, 1.75, 1.54]} rotation-y={Math.PI}>
        <planeGeometry args={[0.74, 0.36]} /><meshBasicMaterial color={lighten(def.color, 0.55)} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

// A step run by agents: one desk, a seat per agent (a review with two reviewers has two robots).
function Station({ st, selected, onSelect }) {
  const n = st.agents.length, grow = (n - 1) * 90;
  const x0 = -60 - grow, x1 = 210 + grow, y0 = 150, D = 110, top = 150;
  const panel = S(x0 + 6, y0 + D - 20, 18, x1 - x0 - 12, 12, top - 30);
  const first = agentDef(st.agents[0]), T = useTheme(), WOOD = T.wood;
  const sub = n === 1 ? ((first.model && window.Robots.plaqueFor(first.model)) || first.label) : st.agents.map((a) => agentDef(a).label).join(' + ');
  const label = textTexture([
    { text: st.id, size: 60, y: 96, color: lighten(WOOD, 0.86) },
    { text: sub, size: 38, y: 162, color: lighten(WOOD, 0.6), weight: 700 },
  ], (x1 - x0 - 12) * 2, 240, true);
  return (
    <group position={[st.x, 0, st.z]} {...clicks(st.id, onSelect)}>
      <Pad st={st} width={4.1 + (n - 1) * 1.8} selected={selected} />
      {st.agents.map((a, i) => <Seat key={a} st={st} agent={a} x={(i - (n - 1) / 2) * 1.8} />)}
      <B {...S(x0 + 8, y0 + 6, 0, 16, 16, top - 12)} c={darken(WOOD, 0.15)} />
      <B {...S(x1 - 24, y0 + 6, 0, 16, 16, top - 12)} c={darken(WOOD, 0.15)} />
      <B {...S(x1 - 24, y0 + D - 22, 0, 16, 16, top - 12)} c={darken(WOOD, 0.15)} />
      <B {...panel} c={darken(WOOD, 0.05)} r={0.03} />
      <Decal tex={label} size={[(x1 - x0 - 12) * U, 1.2]} position={[panel.p[0], panel.p[1], panel.p[2] + 0.066]} />
      <B {...S(x0, y0, top - 12, x1 - x0, D, 14)} c={WOOD} r={0.05} rough={0.55} />
      <B {...S(x0 + 22, y0 + 40, top + 2, 56, 44, 6)} c={T.paper} r={0.01} />
    </group>
  );
}

// A step the engine runs itself (a suite, test ids, screenshots): a console, no robot. Its screen
// shows the step and how it ended.
function Machine({ st, selected, onSelect }) {
  const status = useModel((m) => m.state[st.id]?.status || 'pending');
  const note = useModel((m) => m.state[st.id]?.note || '');
  const beacon = useRef(), T = useTheme(), K = T.machine, col = T.status[status];
  const tex = canvasTexture(`machine:${st.id}:${status}:${note}`, 560, 300, (g, w) => {
    g.fillStyle = K.screen; g.fillRect(0, 0, w, 300);
    g.textBaseline = 'middle';
    g.fillStyle = K.title; g.font = '700 22px Arial, Helvetica, sans-serif';
    g.fillText(`ENGINE · ${st.type.replace(/_/g, ' ').toUpperCase()}`, 28, 40);
    g.fillStyle = K.ink; g.font = '800 44px Arial, Helvetica, sans-serif';
    g.fillText(fitText(g, st.id, w - 56), 28, 100);
    g.fillStyle = col; g.beginPath(); g.arc(40, 166, 11, 0, 7); g.fill();
    g.font = '800 30px Arial, Helvetica, sans-serif';
    g.fillText(status === 'running' ? 'Running…' : STATUS[status].label, 64, 168);
    g.fillStyle = K.note; g.font = '500 23px Arial, Helvetica, sans-serif';
    let line = '', y = 222;
    for (const word of String(note || '').split(' ')) {
      if (g.measureText(`${line} ${word}`).width > w - 56 && line) { g.fillText(line, 28, y); line = word; y += 32; if (y > 270) { line = ''; break; } } else line = line ? `${line} ${word}` : word;
    }
    if (line) g.fillText(line, 28, y);
  }, true);
  useFrame(({ clock }) => {
    beacon.current.material.emissiveIntensity = status === 'running' ? 0.7 + 0.7 * Math.sin(clock.elapsedTime * 7) : status === 'pending' ? 0.05 : 0.8;
  });
  const lights = ['#3DDC97', '#FFB020', '#6EA8FF'];
  return (
    <group position={[st.x, 0, st.z]} {...clicks(st.id, onSelect)}>
      <Pad st={st} selected={selected} />
      <B p={[0, 0.15, 0.1]} s={[2.9, 0.14, 1.5]} c={K.base} r={0.05} />
      <B p={[0, 1.05, 0]} s={[2.7, 1.72, 1.1]} c={K.body} r={0.09} rough={0.5} />
      <Decal tex={tex} size={[2.3, 1.23]} position={[0, 1.12, 0.557]} />
      <B p={[0, 0.44, 0.78]} s={[1.7, 0.07, 0.42]} c={K.keys} r={0.02} />
      <mesh position={[-1.0, 1.99, 0]} castShadow><cylinderGeometry args={[0.05, 0.05, 0.16, 8]} /><meshStandardMaterial color={K.mast} /></mesh>
      <mesh ref={beacon} position={[-1.0, 2.14, 0]} castShadow><sphereGeometry args={[0.14, 16, 12]} /><meshStandardMaterial color={col} emissive={col} roughness={0.4} /></mesh>
      {lights.map((c, i) => <B key={i} p={[0.55 + i * 0.3, 1.96, 0.25]} s={[0.2, 0.1, 0.2]} c={c} emissive={c} glow={status === 'running' ? 0.9 : 0.15} r={0.03} castShadow={false} />)}
    </group>
  );
}

// The person of robots.js gate(): the human approver, holding a clipboard.
function Person() {
  const P = (x, y, z, W, D, H) => S(x, y, z, W, D, H, 30, 17);
  const T = useTheme(), { skin, shirt, pants, hair } = T.person;
  const face = SVG('0 0 40 40', 160, 160, '<circle cx="13" cy="18" r="2.8" fill="#1A1A22"/><circle cx="27" cy="18" r="2.8" fill="#1A1A22"/><path d="M13 27 Q20 32 27 27" fill="none" stroke="#1A1A22" stroke-width="2.2" stroke-linecap="round"/>');
  const check = SVG('0 0 36 46', 144, 184, '<path d="M9 24 L16 32 L28 13" fill="none" stroke="#2F9E5B" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>');
  return (
    <group>
      <B {...P(8, 8, 0, 18, 18, 80)} c={pants} />
      <B {...P(34, 8, 0, 18, 18, 80)} c={pants} />
      <B {...P(-14, 8, 92, 14, 18, 64)} c={shirt} />
      <B {...P(0, 0, 80, 60, 34, 78)} c={shirt} r={0.06} />
      <B {...P(60, 8, 92, 14, 18, 64)} c={shirt} />
      <B {...P(10, 2, 158, 40, 34, 40)} c={skin} r={0.07} />
      <Decal tex={svgTexture(face, 160, 160)} size={[0.4, 0.4]} position={[0, 1.78, 0.196]} />
      <B {...P(8, 0, 192, 44, 38, 12)} c={hair} r={0.04} />
      <B {...P(12, 34, 96, 36, 4, 46)} c={T.paper} r={0.01} />
      <Decal tex={svgTexture(check, 144, 184)} size={[0.36, 0.46]} position={[0, 1.19, 0.216]} />
    </group>
  );
}

// A human gate: an arch facing the lane, with the approver next to it and a barrier that lifts once
// the gate is answered. The view only shows it: it is answered where the app answers gates.
function Gate({ st, selected, onSelect }) {
  const status = useModel((m) => m.state[st.id]?.status || 'pending');
  const bar = useRef(), lamp = useRef(), who = useRef(), T = useTheme(), GATE = T.gate;
  const stripes = canvasTexture('stripes', 256, 32, (g, w, h) => {
    g.fillStyle = '#F4F1EA'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#D9483B';
    for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(i * 48 + 8, h); g.lineTo(i * 48 + 24, 0); g.lineTo(i * 48 + 44, 0); g.lineTo(i * 48 + 28, h); g.fill(); }
  });
  const sign = textTexture([{ text: 'HUMAN APPROVAL', size: 40, y: 40, color: '#2A1E08' }], 520, 76);
  useFrame(({ clock }, dt) => {
    const open = status === 'done' ? -1.32 : 0;
    bar.current.rotation.x += (open - bar.current.rotation.x) * (1 - Math.exp(-dt * 4));
    const m = lamp.current.material, c = status === 'waiting' ? '#FFB020' : status === 'done' || status === 'failed' ? T.status[status] : T.status.pending;
    m.color.set(c); m.emissive.set(c);
    m.emissiveIntensity = status === 'waiting' ? 0.8 + 0.6 * Math.sin(clock.elapsedTime * 6) : status === 'pending' ? 0.05 : 0.9;
    who.current.position.y = 0.08 + (status === 'waiting' ? Math.abs(Math.sin(clock.elapsedTime * 3)) * 0.07 : 0);
  });
  return (
    <group position={[st.x, 0, st.z]} {...clicks(st.id, onSelect)}>
      <Pad st={st} width={4.6} selected={selected} />
      <group position-z={0.6} rotation-y={-Math.PI / 2}>
        <B p={[0, 1.23, -1.35]} s={[0.3, 2.3, 0.3]} c={GATE} r={0.05} />
        <B p={[0, 1.23, 1.35]} s={[0.3, 2.3, 0.3]} c={GATE} r={0.05} />
        <B p={[0, 2.58, 0]} s={[0.42, 0.4, 3.2]} c={darken(GATE, 0.05)} r={0.06} />
        <Decal tex={sign} size={[2.6, 0.38]} position={[0.216, 2.58, 0]} rotation={[0, Math.PI / 2, 0]} />
        <mesh ref={lamp} position={[0, 2.91, 0]} castShadow><sphereGeometry args={[0.16, 16, 12]} /><meshStandardMaterial roughness={0.4} /></mesh>
        <group ref={bar} position={[0, 1.0, -1.15]}>
          <mesh position={[0, 0, 1.15]} castShadow geometry={rbox(0.14, 0.2, 2.3, 0.04)}><meshStandardMaterial map={stripes} roughness={0.7} /></mesh>
        </group>
      </group>
      <group ref={who} position={[2.0, 0.08, 1.3]}><Person /></group>
    </group>
  );
}

// The supervisor on its podium; while it works on a step, packets fly to that step.
function Supervisor({ selected, onSelect }) {
  const T = useTheme(), SUPERVISOR = T.supervisor;
  const state = useModel(() => robotStateOf('supervisor'));
  const target = useModel((m) => (m.sup.target && m.layout().byId[m.sup.target] ? m.sup.target : null));
  const layout = useModel((m) => m.layout());
  const dots = useRef();
  const curve = useMemo(() => {
    if (!target) return null;
    const a = geoOf(layout).sup.clone().setY(2.6), b = entityPos(target, new THREE.Vector3(), 3.2);
    return new THREE.QuadraticBezierCurve3(a, a.clone().lerp(b, 0.5).setY(6.5), b);
  }, [target, layout]);
  useFrame(({ clock }) => {
    if (!dots.current || !curve) return;
    dots.current.children.forEach((m, i) => { curve.getPoint((clock.elapsedTime * 0.55 + i / 7) % 1, m.position); });
  });
  return (
    <group>
      <group position={geoOf(layout).sup} {...clicks('supervisor', onSelect)}>
        <mesh position-y={0.13} castShadow receiveShadow><cylinderGeometry args={[1.45, 1.6, 0.26, 40]} /><meshStandardMaterial color={T.podium} roughness={0.7} /></mesh>
        <mesh position-y={0.27} rotation-x={-Math.PI / 2}><ringGeometry args={[1.22, 1.36, 40]} /><meshBasicMaterial color={SUPERVISOR} toneMapped={false} /></mesh>
        {selected && <SelectionRing r={1.9} />}
        <group position-y={0.26} rotation-y={Math.PI / 4}><Robot variant="supervisor" state={state} /></group>
      </group>
      {curve && (
        <group ref={dots}>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => <mesh key={i}><sphereGeometry args={[0.11, 12, 8]} /><meshBasicMaterial color={SUPERVISOR} toneMapped={false} /></mesh>)}
        </group>
      )}
    </group>
  );
}

// The work item: a cart that drives along the lane to the step the run is at. Opening the view in
// the middle of a run puts it where the run is (no drive from the start), and so does a jump of the
// shown moment (the player's epoch: a seek of the replay, back to the head).
function Courier({ selected, onSelect }) {
  const ref = useRef(), box = useRef(), T = useTheme(), K = T.cart;
  const pos = useMemo(() => new THREE.Vector3(), []);
  const cart = useRef(null);
  useFrame(({ clock }, dt) => {
    const player = view.player, m = player.model, layout = m.layout(), goal = m.cartGoal(layout);
    if (cart.current?.epoch !== player.epoch) cart.current = { d: goal, dir: cart.current?.dir || 1, reached: Math.max(goal, m.farthest(layout)), epoch: player.epoch };
    const c = cart.current;
    const left = goal - c.d, step = Math.max(7, Math.abs(left) * 2.6) * Math.min(dt, 0.1);
    rig.cartMoving = Math.abs(left) > 0.02;
    if (rig.cartMoving) { c.dir = Math.sign(left); c.d = Math.abs(left) <= step ? goal : c.d + c.dir * step; }
    c.reached = Math.max(c.reached, c.d);
    rig.cartD = c.d;
    rig.reached = c.reached;
    lanePoint(layout, c.d, pos);
    ref.current.position.copy(pos);
    // heading: along the segment it is on, in its direction of travel
    const P = geoOf(layout).path;
    let i = 0;
    while (i < P.length - 2 && c.d > layout.cum[i + 1] + 1e-6) i++;
    const want = Math.atan2((P[i + 1].x - P[i].x) * c.dir, (P[i + 1].z - P[i].z) * c.dir);
    const diff = want - ref.current.rotation.y;
    ref.current.rotation.y += Math.atan2(Math.sin(diff), Math.cos(diff)) * (1 - Math.exp(-dt * 9));
    box.current.position.y = 0.62 + Math.sin(clock.elapsedTime * (rig.cartMoving ? 9 : 2.5)) * (rig.cartMoving ? 0.012 : 0.03);
  });
  const wheels = [[-0.36, 0.38], [0.36, 0.38], [-0.36, -0.38], [0.36, -0.38]];
  return (
    <group ref={ref} {...clicks('item', onSelect)}>
      {selected && <SelectionRing r={1.0} />}
      <B p={[0, 0.27, 0]} s={[0.78, 0.16, 1.15]} c={K.base} r={0.06} />
      {wheels.map(([x, z]) => (
        <mesh key={`${x}:${z}`} position={[x, 0.15, z]} rotation-z={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.15, 0.15, 0.12, 16]} /><meshStandardMaterial color={K.wheel} roughness={0.9} />
        </mesh>
      ))}
      <group ref={box} position={[0, 0.62, -0.05]}>
        <B p={[0, 0, 0]} s={[0.62, 0.52, 0.72]} c={K.box} r={0.06} rough={0.5} />
        <B p={[0, 0.27, 0]} s={[0.64, 0.05, 0.2]} c={K.lid} r={0.02} castShadow={false} />
        <B p={[0, 0.31, 0.08]} s={[0.4, 0.03, 0.5]} c={K.paper} r={0.01} castShadow={false} />
      </group>
      <mesh position={[0, 0.36, 0.585]}><sphereGeometry args={[0.05, 8, 8]} /><meshBasicMaterial color={K.lamp} toneMapped={false} /></mesh>
    </group>
  );
}

// The lane on the floor: grey where the work item has not been yet, the accent where it has.
function Route({ layout }) {
  const done = useRef([]), T = useTheme();
  const segs = useMemo(() => {
    const P = geoOf(layout).path;
    return P.slice(0, -1).map((a, i) => {
      const b = P[i + 1];
      return { a, len: a.distanceTo(b), alongX: Math.abs(b.x - a.x) > 0.01, mid: a.clone().lerp(b, 0.5), dir: b.clone().sub(a).normalize() };
    });
  }, [layout]);
  useFrame(() => {
    segs.forEach((g, i) => {
      const m = done.current[i];
      if (!m) return;
      const covered = Math.max(0, Math.min(g.len, (rig.reached ?? 0) - layout.cum[i]));
      m.visible = covered > 0.02;
      m.scale.x = Math.max(0.001, covered);
      m.position.copy(g.a).addScaledVector(g.dir, covered / 2).setY(0.035);
    });
  });
  return (
    <group>
      {segs.map((g, i) => (
        <group key={i}>
          <mesh position={[g.mid.x, 0.012, g.mid.z]} rotation-y={g.alongX ? 0 : Math.PI / 2} receiveShadow>
            <boxGeometry args={[g.len + 0.9, 0.02, 0.9]} /><meshStandardMaterial color={T.lane} roughness={0.9} />
          </mesh>
          <mesh ref={(m) => { done.current[i] = m; }} rotation-y={g.alongX ? 0 : Math.PI / 2}>
            <boxGeometry args={[1, 0.02, 0.2]} /><meshBasicMaterial color={T.laneDone} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Tree({ p, s = 1 }) {
  const K = useTheme().tree;
  return (
    <group position={p} scale={s}>
      <mesh position-y={0.6} castShadow><cylinderGeometry args={[0.11, 0.15, 1.2, 8]} /><meshStandardMaterial color={K.trunk} /></mesh>
      <mesh position-y={1.75} castShadow><icosahedronGeometry args={[0.95, 2]} /><meshStandardMaterial color={K.leaf} roughness={0.85} /></mesh>
      <mesh position={[0.35, 2.35, 0.2]} castShadow><icosahedronGeometry args={[0.55, 2]} /><meshStandardMaterial color={K.leaf2} roughness={0.85} /></mesh>
    </group>
  );
}

// The floor, the walls behind it, where the task comes in (the issue) and where it ends (the base branch).
function Floor({ layout }) {
  const T = useTheme(), run = view.model.run, { minX, maxX, minZ, maxZ } = layout.bounds;
  const w = maxX - minX, d = maxZ - minZ, cz = (minZ + maxZ) / 2, P = geoOf(layout).path, end = P[P.length - 1];
  const issues = run.issues.length ? `issue${run.issues.length > 1 ? 's' : ''} ${run.issues.map((i) => `#${i.number}`).join(' ')}` : 'no issue';
  const sign = textTexture([
    { text: run.workflow, size: 60, y: 70, color: T.boardInk },
    { text: `run ${String(run.id || '').slice(-8)} · ${issues}`, size: 34, y: 136, color: T.boardSub, weight: 600 },
  ], 900, 180, true);
  const leds = useRef();
  useFrame(({ clock }) => {
    leds.current?.children.forEach((m, i) => { m.material.opacity = view.model.merged ? 1 : 0.3 + 0.7 * (Math.sin(clock.elapsedTime * 3 + i * 1.7) > 0.2 ? 1 : 0); });
  });
  const win = { c: T.window, emissive: T.window, glow: T.windowGlow, r: 0.02, rough: 0.3, castShadow: false }; // lit from inside in the dark
  const backWins = [], sideWins = [];
  for (let x = minX + 2.6; x < maxX - 1.4; x += 3.5) if (Math.abs(x) > 6.4) backWins.push(x);
  for (let z = minZ + 2.8; z < maxZ - 1.4; z += 3.5) sideWins.push(z);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.4}><circleGeometry args={[220, 48]} /><meshBasicMaterial color={T.sky} toneMapped={false} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.395} receiveShadow><circleGeometry args={[80, 48]} /><shadowMaterial opacity={T.shadow.opacity} color={T.shadow.color} /></mesh>
      <B p={[0, -0.2, cz]} s={[w, 0.4, d]} c={T.floor} r={0.12} rough={0.95} castShadow={false} />
      <B p={[0, 1.25, minZ + 0.2]} s={[w, 2.5, 0.4]} c={T.wall} r={0.08} />
      <B p={[0, 2.56, minZ + 0.2]} s={[w + 0.2, 0.14, 0.6]} c={T.wallCap} r={0.05} />
      <B p={[minX + 0.2, 1.25, cz]} s={[0.4, 2.5, d]} c={T.wall} r={0.08} />
      <B p={[minX + 0.2, 2.56, cz]} s={[0.6, 0.14, d + 0.2]} c={T.wallCap} r={0.05} />
      {backWins.map((x) => <B key={x} p={[x, 1.4, minZ + 0.41]} s={[2.4, 1.2, 0.06]} {...win} />)}
      {sideWins.map((z) => <B key={z} p={[minX + 0.41, 1.4, z]} s={[0.06, 1.2, 2.4]} {...win} />)}
      <B p={[0, 1.4, minZ + 0.42]} s={[9.4, 1.9, 0.08]} c={T.board} r={0.03} castShadow={false} />
      <Decal tex={sign} size={[9, 1.8]} position={[0, 1.4, minZ + 0.47]} />

      <group position={P[0]}>
        <B p={[-0.2, 0.04, 0]} s={[2.4, 0.08, 2.4]} c={T.pad} r={0.04} />
        <B p={[-0.9, 0.45, 0]} s={[0.9, 0.8, 1.5]} c={T.inbox} r={0.06} />
        <B p={[-0.9, 0.9, 0.2]} s={[0.6, 0.1, 0.8]} c={T.paper} r={0.02} />
        <B p={[-0.9, 0.98, 0.15]} s={[0.6, 0.06, 0.8]} c="#FFFFFF" r={0.02} />
      </group>
      <group position={[end.x + layout.endDir * 1.4, 0, end.z]}>
        <B p={[-layout.endDir * 0.6, 0.04, 0]} s={[2.6, 0.08, 3.2]} c={T.pad} r={0.04} />
        {[-0.75, 0.75].map((z) => <B key={z} p={[0, 1.25, z]} s={[1.0, 2.5, 1.1]} c={T.rack} r={0.07} rough={0.5} />)}
        <group ref={leds}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <mesh key={i} position={[0.51, 0.55 + (i >> 1) * 0.5, (i % 2 ? 0.75 : -0.75)]} rotation-y={Math.PI / 2}>
              <planeGeometry args={[0.7, 0.09]} /><meshBasicMaterial color={T.led} transparent toneMapped={false} />
            </mesh>
          ))}
        </group>
      </group>

      <Tree p={[maxX + 2.5, -0.4, minZ + 3]} /><Tree p={[maxX + 3.5, -0.4, cz]} s={0.8} /><Tree p={[maxX + 2.2, -0.4, maxZ + 2.4]} s={1.1} />
      <Tree p={[4, -0.4, maxZ + 3]} s={0.85} /><Tree p={[-8, -0.4, maxZ + 2.8]} /><Tree p={[minX - 2.7, -0.4, minZ - 2.5]} s={1.3} />
      <Tree p={[6, -0.4, minZ - 2.5]} s={1.2} /><Tree p={[minX - 2.6, -0.4, cz + 4]} s={1.05} />
    </group>
  );
}

/** The point the camera follows while it follows the run: the cart, or the step it waits at. */
export function followRunTarget(out) {
  const m = view.model;
  if (m.finished) return entityPos('end', out);
  entityPos('item', out);
  if (!rig.cartMoving && m.activeId && m.layout().byId[m.activeId]) out.lerp(entityPos(m.activeId, new THREE.Vector3()), 0.55);
  return out;
}

// The HUD's cards cover the right of the window: the camera's centre is moved left by half the detail
// card, so the selected station's robot stays in the free part of the window.
const SHIFT = 160;
function CameraRig() {
  const { camera, gl, size } = useThree();
  const controls = useMemo(() => {
    const c = new MapControls(camera, gl.domElement);
    Object.assign(c, { enableDamping: true, dampingFactor: 0.12, minDistance: 9, maxDistance: 130, minPolarAngle: 0.35, maxPolarAngle: 1.2, zoomSpeed: 0.8 });
    const layout = view.model.layout(), center = geoOf(layout).center;
    c.target.copy(center);
    camera.position.copy(center).addScaledVector(VIEW_DIR, layout.overview);
    return c;
  }, [camera, gl]);
  useEffect(() => {
    const el = gl.domElement;
    let down = null;
    const moved = () => { if (!rig.free) { rig.free = true; rig.distGoal = null; rig.angleGoal = false; rig.onUserMove?.(); } };
    const onDown = (e) => { down = [e.clientX, e.clientY]; };
    const onMove = (e) => { if (down && e.buttons && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) moved(); };
    const onUp = () => { down = null; };
    const onWheel = () => { rig.distGoal = null; };
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp); el.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp); el.removeEventListener('wheel', onWheel); controls.dispose();
    };
  }, [controls, gl]);
  const goal = useMemo(() => new THREE.Vector3(), []), off = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    // the view offset: kept in step with the canvas' size (R3F resets the aspect on a resize)
    const shift = size.width >= 1000 ? SHIFT : 0, full = size.width + 2 * shift;
    if (camera.view?.fullWidth !== full || camera.view?.height !== size.height || Math.abs(camera.aspect - full / size.height) > 1e-6) {
      camera.aspect = full / size.height;
      camera.setViewOffset(full, size.height, 2 * shift, 0, size.width, size.height);
    }
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 3.2);
    if (!rig.free && rig.targetFn) {
      rig.targetFn(goal).sub(controls.target).multiplyScalar(k);
      controls.target.add(goal); camera.position.add(goal);
    }
    off.copy(camera.position).sub(controls.target);
    let d = off.length();
    if (rig.zoomBy) { rig.distGoal = THREE.MathUtils.clamp((rig.distGoal ?? d) * rig.zoomBy, 10, 120); rig.zoomBy = 0; }
    if (rig.distGoal != null) {
      const nd = d + (rig.distGoal - d) * k;
      off.multiplyScalar(nd / d); d = nd;
      if (rig.free && Math.abs(rig.distGoal - d) < 0.05) rig.distGoal = null;
    }
    if (rig.angleGoal) {
      off.normalize().lerp(VIEW_DIR, k).normalize();
      if (off.angleTo(VIEW_DIR) < 0.004) rig.angleGoal = false;
      off.multiplyScalar(d);
    }
    camera.position.copy(controls.target).add(off);
    controls.update();
    rig.distance = d;
  });
  return null;
}

// Floating tags are DOM nodes: their anchors are projected every frame, without a React render. At
// the whole-floor distance the tags of the stations nothing happens at fold to their dot (`far`), so
// neighbours do not overlap.
function TagProjector() {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    camera.updateMatrixWorld();
    const layout = view.model.layout();
    const far = (rig.distance ?? 0) > 44;
    const box = view.root?.querySelector('.r3d-tags');
    if (box && box.classList.contains('far') !== far) box.classList.toggle('far', far);
    for (const [id, el] of tagEls) {
      entityPos(id, v, TAG_LIFT[id] ?? TAG_LIFT[layout.byId[id]?.kind] ?? 3).project(camera);
      const x = (v.x * 0.5 + 0.5) * size.width, y = (-v.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate(${x.toFixed(1)}px,${(y - 6).toFixed(1)}px) translate(-50%,-100%)`;
    }
  });
  return null;
}

const STATION = { agent: Station, machine: Machine, gate: Gate };
/** The whole scene: lights, camera, floor, stations, supervisor, cart and the tags' projector. */
export function Scene({ shown, onSelect }) {
  const layout = useModel((m) => m.layout());
  const c = geoOf(layout).center, K = useTheme().light;
  return (
    <group>
      <hemisphereLight color={K.sky} groundColor={K.ground} intensity={K.hemi} />
      <directionalLight position={[c.x - 12, 26, c.z + 15]} intensity={K.sun} castShadow
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={40} shadow-camera-bottom={-40}
        shadow-camera-near={1} shadow-camera-far={110} shadow-bias={-0.0004} shadow-normalBias={0.04} />
      <CameraRig />
      <Floor layout={layout} />
      <Route layout={layout} />
      {layout.stations.map((st) => {
        const Kind = STATION[st.kind];
        return <Kind key={st.id} st={st} selected={shown === st.id} onSelect={onSelect} />;
      })}
      <Supervisor selected={shown === 'supervisor'} onSelect={onSelect} />
      <Courier selected={shown === 'item'} onSelect={onSelect} />
      <TagProjector />
    </group>
  );
}
