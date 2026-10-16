// The run's 3D view, the bundle's entry (scripts/build-3d.js → generated/run3d-scene.js): defines
// window.Run3DScene, which the overlay (src/renderer/run3d.js) calls once the bundle has loaded.
//   Run3DScene.webgl()                     '' when WebGL works here, else why not
//   Run3DScene.mount(element, { player, workflows, theme, canAnswer, onClose, onOpenGate, onTheme }) → { unmount() }
// `player` is a Run3DPlayer (src/renderer/run3d-replay.js) the overlay keeps feeding with the run's
// events; the view only reads the model it shows (the run as it is now, or a replayed moment) and
// drives its replay: the clock of a playing replay (one requestAnimationFrame loop, only while it
// plays), and the keys
// (Space plays / pauses, Left / Right step to the previous / next step, with Shift by 1% of the
// timeline; never while a field is focused, and Space is left to a button focused with the keyboard).
// `theme` is 'dark' or 'light' (src/renderer/run3d-theme.js); the top bar's toggle switches it and
// tells the overlay (onTheme), which remembers it.
// App holds the selection and the camera's mode: it follows the run by default, selecting a
// station, a tag or a row pins it, dragging or zooming hands the camera to the user; the zoom
// column's buttons zoom in / out, show the whole floor or follow the run again. Neither a replay nor
// a change of theme resets them.
// The Canvas draws on demand (#388, scene.jsx says when it asks for frames), and not at all while the
// window is hidden or minimised (frameloop 'never'): a still run costs no frames.
// unmount() releases the WebGL context, the geometries, textures and listeners (view.js end()).
import { Component, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, invalidate } from '@react-three/fiber';
import { begin, end, entityPos, rig, useModel, useTheme, view } from './view.js';
import { followRunTarget, Scene } from './scene.jsx';
import { Detail, Icon, Kpis, List, Pipeline, Tags, TopBar } from './hud.jsx';

/** '' when this window can draw WebGL, else the reason (a context made and given back at once). */
function webgl() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return 'WebGL is not available in this window (no GPU context).';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return '';
  } catch (e) {
    return `WebGL is not available in this window: ${e.message}`;
  }
}

// A failure of the scene (WebGL lost or refused) is a message, never a blank overlay: Close still works.
class SceneBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <div className="r3d-message" role="alert" children={t('run3d.scene_failed', { error: String(this.state.error.message || this.state.error) })} />;
    return this.props.children;
  }
}

const FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const PRESSABLE = 'button:focus-visible, a:focus-visible, [role="tab"]:focus-visible';
// what a key does to the replay (Run3DReplay.keyAction), given what has the focus
const replayKey = (e, target) => (e.defaultPrevented ? null : window.Run3DReplay.keyAction(e.key, {
  shift: e.shiftKey, modifier: e.ctrlKey || e.altKey || e.metaKey, field: !!target?.closest?.(FIELD), pressable: !!target?.matches?.(PRESSABLE),
}));

// The replay's clock and keys, while the overlay is open. The clock spins only while a replay plays
// (#388): the player's notices start it, and it stops once the replay pauses or reaches the head.
function useReplay() {
  useEffect(() => {
    let frame = 0, last = 0;
    const playing = () => !!view.player?.playing && !view.player.atHead;
    const loop = (t) => {
      if (!playing()) { frame = 0; return; }
      // a tab left in the background comes back with one long frame: at most a quarter of a second of it
      view.player.tick(Math.min(250, t - last));
      last = t;
      frame = requestAnimationFrame(loop);
    };
    const wake = () => {
      if (frame || !playing()) return;
      last = performance.now();
      frame = requestAnimationFrame(loop);
    };
    const off = view.player?.subscribe(wake);
    wake();
    const overlay = view.root?.closest('.r3d') || view.root;
    const onKey = (e) => {
      const p = view.player, at = document.activeElement;
      if (!p || (at && at !== document.body && !overlay?.contains(at))) return; // the overlay has the focus
      const act = replayKey(e, at);
      if (!act) return;
      e.preventDefault();
      if (act === 'toggle') p.toggle();
      else if (act === 'back') p.step(-1);
      else if (act === 'forward') p.step(1);
      else p.nudge(act === 'nudge-back' ? -0.01 : 0.01);
    };
    document.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(frame); off?.(); document.removeEventListener('keydown', onKey); };
  }, []);
}

// The window hidden or minimised (#388): the Canvas' loop is switched off ('never') until it shows again.
function usePageHidden() {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const onChange = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return hidden;
}

function App({ canAnswer, onClose, onOpenGate }) {
  const [sel, setSel] = useState(null); // the entity pinned by the user
  const [follow, setFollow] = useState(true); // the camera and the detail card follow the run
  const [query, setQuery] = useState('');
  const [glError, setGlError] = useState(() => webgl());
  const theme = useTheme();
  const hasFloor = useModel((m) => m.steps.length > 0);
  const activeId = useModel((m) => (m.activeId && m.layout().byId[m.activeId] ? m.activeId : null));
  const shown = follow ? (activeId || 'item') : sel;
  const live = useRef({});
  live.current = { shown, follow };
  useReplay();
  const hidden = usePageHidden();

  // a new goal for the camera rig draws the frames that ease to it (the scene draws on demand)
  const aim = (goal) => { Object.assign(rig, goal); invalidate(); };
  const zoomIn = () => aim({ zoomBy: 0.78 }), zoomOut = () => aim({ zoomBy: 1.28 });
  const select = (id) => {
    setSel(id); setFollow(false);
    aim({ free: false, distGoal: id === 'item' ? 22 : 26, targetFn: (out) => entityPos(id, out, 1) });
  };
  const followRun = () => { setFollow(true); aim({ free: false, distGoal: 36, targetFn: followRunTarget }); };
  const overview = () => {
    setSel(null); setFollow(false);
    aim({ free: false, distGoal: view.model.layout().overview, angleGoal: true, targetFn: (out) => entityPos('center', out) });
  };
  useEffect(() => {
    rig.targetFn = followRunTarget;
    // dragging the scene pins what was shown and stops following the run
    rig.onUserMove = () => { if (live.current.follow) { setSel(live.current.shown); setFollow(false); } };
  }, []);

  if (!hasFloor) {
    return (
      <div className="r3d-message">
        <p children={t('run3d.no_events_yet')} />
        <button type="button" className="r3d-primary inline" onClick={onClose} children={t('common.close')} />
      </div>
    );
  }
  return (
    <div className="r3d-app">
      <div className="r3d-stage">
        {glError ? <div className="r3d-message" role="alert" children={glError} /> : (
          <SceneBoundary>
            <Canvas frameloop={hidden ? 'never' : 'demand'} shadows flat dpr={[1, 2]} camera={{ fov: 30, near: 1, far: 500 }}
              onCreated={({ gl }) => gl.domElement.addEventListener('webglcontextlost', () => setGlError(t('run3d.webgl_lost')))}>
              <color attach="background" args={[theme.sky]} />
              <Scene shown={shown} onSelect={select} />
            </Canvas>
          </SceneBoundary>
        )}
      </div>
      {!glError && <Tags shown={shown} onSelect={select} />}
      <div className="r3d-hud">
        <TopBar query={query} setQuery={setQuery} onClose={onClose} />
        <Kpis />
        <div className="r3d-hint r3d-card" children={t('run3d.camera_hint')} />
        <div className="r3d-zoom r3d-card" role="toolbar" aria-label={t('run3d.camera')}>
          <button type="button" title={t('run3d.zoom_in')} aria-label={t('run3d.zoom_in')} onClick={zoomIn}><Icon name="plus" /></button>
          <button type="button" title={t('run3d.zoom_out')} aria-label={t('run3d.zoom_out')} onClick={zoomOut}><Icon name="minus" /></button>
          <button type="button" title={t('run3d.whole_floor')} aria-label={t('run3d.whole_floor')} onClick={overview}><Icon name="home" /></button>
          <button type="button" title={t('run3d.follow_the_run')} aria-label={t('run3d.follow_the_run')} aria-pressed={follow} className={follow ? 'on' : ''} onClick={followRun}><Icon name="follow" /></button>
        </div>
        <Detail shown={shown || 'item'} canAnswer={canAnswer} onOpenGate={onOpenGate} />
        <List shown={shown} onSelect={select} query={query} />
        <Pipeline shown={shown} onSelect={select} />
      </div>
    </div>
  );
}

function mount(element, { player, workflows = [], theme, canAnswer = false, onClose = () => {}, onOpenGate = () => {}, onTheme = null }) {
  begin({ player, workflows, root: element, theme, onTheme });
  const root = createRoot(element);
  root.render(<App canAnswer={canAnswer} onClose={onClose} onOpenGate={onOpenGate} />);
  return {
    unmount() {
      root.unmount(); // R3F disposes its renderer and gives the WebGL context back
      end();
    },
  };
}

window.Run3DScene = { mount, webgl };
