// The project city's 3D view (#373), the bundle's entry (scripts/build-3d.js → generated/project-city.js):
// defines window.ProjectCityScene, which the City view of the Architecture tab
// (src/renderer/views/project/project-city.js) calls once the bundle has loaded. The HUD (header,
// legend, cards, controls) is that classic script's; the bundle draws the city and reports what the
// pointer is on.
//   ProjectCityScene.mount(element, { layout, paint, markers, tests, theme, relationsOf, onHover, onPick }) → handle
//   - layout: src/shared/city-layout.js layoutCity; paint: { colours: [hex], greyed: [bool] } per
//     building (colourBy, then applyOverlay); markers: applyOverlay's; tests: draw the test files;
//     theme: 'dark' | 'light' (run3d-theme.js); relationsOf(kind, id) → { requires, requiredBy }
//     (city-layout.js neighbours / districtNeighbours); onHover({ kind, id, x, y } | null) with the
//     pointer's client position; onPick({ kind, id } | null) on a click (null: the empty sky).
//   - handle: update(patch of the same keys), pin(target | null), flyTo(flyTarget), home(),
//     zoom(factor), stats() → { firstFrameMs, fps } (the time to the first frame, the frame rate
//     while the camera moves), unmount() (React Three Fiber gives the WebGL context back).
import { Component } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { CityScene } from './scene.jsx';
import { cityTheme } from './theme.js';
import { createStore, useStore } from './store.js';

// A failure of the scene (WebGL lost or refused) is a message, never a blank tab: the HUD still works.
class SceneBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <div className="r3d-message" role="alert">The city could not be drawn: {String(this.state.error.message || this.state.error)}. The Facts view has the same numbers.</div>;
    return this.props.children;
  }
}

// the tags that float over the scene: landmarks (always visible) and ports; Rig moves them
function Tags({ store }) {
  const { layout } = useStore(store);
  const ref = (id) => (el) => { if (el) store.tagEls.set(id, el); else store.tagEls.delete(id); };
  return (
    <div className="r3d-tags">
      {layout.landmarks.map((l) => (
        <button type="button" key={`landmark:${l.path}`} ref={ref(`landmark:${l.path}`)} className="r3d-tag live" title={l.path}
          onClick={() => store.pick('building', l.path)}>
          <i className="r3d-dot" />{l.label}
        </button>
      ))}
      {layout.ports.map((p) => (
        <div key={`port:${p.id}`} ref={ref(`port:${p.id}`)} className="r3d-tag dim" title={`Talks to: ${p.via.join(', ')}`}>
          <i className="r3d-dot" />{p.name} <span>port</span>
        </div>
      ))}
    </div>
  );
}

function App({ store }) {
  const { theme: T, glError } = useStore(store);
  return (
    <>
      {glError ? <div className="r3d-message" role="alert">{glError}</div> : (
        <SceneBoundary>
          <Canvas shadows flat dpr={[1, 2]} frameloop="demand" camera={{ fov: 30, near: 1, far: 4000 }}
            onPointerMissed={() => store.pick(null)}
            onCreated={({ gl }) => gl.domElement.addEventListener('webglcontextlost', () => store.set({ glError: 'The WebGL context was lost: switch to the Facts and back to the City to draw it again.' }))}>
            <color attach="background" args={[T.sky]} />
            <CityScene store={store} />
          </Canvas>
        </SceneBoundary>
      )}
      <Tags store={store} />
    </>
  );
}

const same = (a, b) => a?.kind === b?.kind && a?.id === b?.id;

function mount(element, { layout, paint, markers = [], tests = true, theme, relationsOf, onHover, onPick }) {
  const store = createStore({ layout, layoutKey: 1, paint, markers, tests, theme: cityTheme(theme), level: 0, hover: null, pinned: null, glError: '' });
  Object.assign(store, {
    tagEls: new Map(),
    tagAnchors: new Map(),
    rig: null,
    invalidate: () => {},
    stats: { mountedAt: performance.now(), firstFrameMs: null, fps: null },
    relationsOf: relationsOf || (() => ({ requires: [], requiredBy: [] })),
    hover(kind, id, ev) {
      const next = kind && id != null ? { kind, id } : null;
      if (!same(store.get().hover, next)) store.set({ hover: next });
      onHover?.(next && { ...next, x: ev?.clientX, y: ev?.clientY });
    },
    pick(kind, id) {
      const next = kind && id != null ? { kind, id } : null;
      store.set({ pinned: next });
      onPick?.(next);
    },
  });
  const root = createRoot(element);
  root.render(<App store={store} />);
  return {
    update(patch) {
      const next = { ...patch };
      if (patch.theme) next.theme = cityTheme(patch.theme);
      if (patch.layout && patch.layout !== store.get().layout) Object.assign(next, { layoutKey: store.get().layoutKey + 1, hover: null, pinned: null });
      store.set(next);
    },
    pin(target) { store.set({ pinned: target || null }); },
    flyTo(target) { if (target) store.rig?.fly(target); },
    home() { store.rig?.home(); },
    zoom(factor) { store.rig?.zoom(factor); },
    stats: () => ({ firstFrameMs: store.stats.firstFrameMs, fps: store.stats.fps }),
    unmount() { root.unmount(); },
  };
}

window.ProjectCityScene = { mount };
