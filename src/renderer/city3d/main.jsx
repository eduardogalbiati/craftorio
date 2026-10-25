// The project city's 3D view (#373), the bundle's entry (scripts/build-3d.js → generated/project-city.js):
// defines window.ProjectCityScene, which the City view of the Architecture tab
// (src/renderer/views/project/project-city.js) calls once the bundle has loaded. The HUD (header,
// legend, cards, controls, the connections panel) is that classic script's; the bundle draws the
// city and reports what the pointer is on.
//   ProjectCityScene.mount(element, { layout, paint, markers, tests, pins, theme, cityLife, glow, relationsOf, onHover, onPick }) → handle
//   - layout: packages/shared/city-layout.js layoutCity; paint: { colours: [hex], greyed: [bool] } per
//     building (colourBy, then applyOverlay); markers: applyOverlay's; tests: draw the test files;
//     pins: the file paths whose connections stay drawn (#382, the connections panel); theme: 'dark'
//     | 'light' (run3d-theme.js); cityLife, glow (#450, both on by default): the street life (trees,
//     lamps, benches, cars, the lamps' pools) and the bloom with its vignette; relationsOf(kind, id) → { requires, requiredBy } (city-layout.js
//     neighbours / districtNeighbours); onHover({ kind, id, x, y } | null) with the pointer's client
//     position; onPick({ kind, id } | null) on a click (null: the empty sky).
//   - handle: update(patch of the same keys; a new layout drops the hover and the pinned card, the
//     pins stay), pin(target | null) (the card's target), flyTo(flyTarget), home(), zoom(factor),
//     stats() → { firstFrameMs, fps, buildings, cityLife, glow, props } (the time to the first frame,
//     the frame rate while the camera moves; per drawn file { path, archetype, greyed }: its v2
//     building's kind, scene.jsx buildingsOf, and whether the overlay greys it; the two switches; the
//     life props shown, props.js lifeCount, 0 with City life off), unmount() (React Three Fiber gives
//     the WebGL context back). A switch's update changes the store only: the city is not rebuilt.
//   While the element is off screen (another tab or view hides it) or the window is hidden, the store's
//   `paused` stops City life's frames (scene.jsx CityScene).
import { Component } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { lifeCount } from './props.js';
import { buildingsOf, CityScene } from './scene.jsx';
import { cityTheme } from './theme.js';
import { createStore, useStore } from './store.js';

// A failure of the scene (WebGL lost or refused) is a message, never a blank tab: the HUD still works.
class SceneBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <div className="r3d-message" role="alert" children={t('city3d.scene_failed', { error: String(this.state.error.message || this.state.error) })} />;
    return this.props.children;
  }
}

// the tags that float over the scene: landmarks (always visible), ports and, up close, the scores of
// the district under the camera (#449, coloured as their building); Rig moves them
function Tags({ store }) {
  const { layout, paint, scoreDistrict, tests } = useStore(store);
  const ref = (id) => (el) => { if (el) store.tagEls.set(id, el); else store.tagEls.delete(id); };
  return (
    <div className="r3d-tags">
      {layout.landmarks.map((l) => (
        <button type="button" key={`landmark:${l.path}`} ref={ref(`landmark:${l.path}`)} className="r3d-tag live" title={l.path}
          onClick={() => store.pick('building', l.path)}>
          <i className="r3d-dot" />
          {l.label} <span children={l.path.split('/').pop()} />
        </button>
      ))}
      {layout.ports.map((p) => (
        <div key={`port:${p.id}`} ref={ref(`port:${p.id}`)} className="r3d-tag sel" title={t('city3d.talks_to', { files: p.via.join(', ') })}>
          <i className="r3d-dot" />
          {p.name} <span children={t('city3d.files', { count: p.via.length })} />
        </div>
      ))}
      {scoreDistrict && layout.buildings.map((b, i) => b.district === scoreDistrict && b.score != null && (tests || !b.test) && (
        <div key={`score:${b.path}`} ref={ref(`score:${b.path}`)} className="r3d-tag pc-score" title={b.path}
          style={{ '--c': paint.colours?.[i] || undefined }} children={Number(b.score).toFixed(1)} />
      ))}
    </div>
  );
}

function App({ store }) {
  const { theme: T, glError, glow } = useStore(store);
  return (
    <>
      {glError ? <div className="r3d-message" role="alert" children={glError} /> : (
        <SceneBoundary>
          <Canvas shadows flat dpr={[1, 2]} frameloop="demand" camera={{ fov: 30, near: 1, far: 4000 }}
            onPointerMissed={() => store.pick(null)}
            onCreated={({ gl }) => gl.domElement.addEventListener('webglcontextlost', () => store.set({ glError: t('city3d.webgl_lost') }))}>
            <color attach="background" args={[T.skyHorizon]} />
            <CityScene store={store} />
          </Canvas>
        </SceneBoundary>
      )}
      {glow && !glError && <div className="pc-vignette" style={{ opacity: T.vignette }} />}
      <Tags store={store} />
    </>
  );
}

const same = (a, b) => a?.kind === b?.kind && a?.id === b?.id;

function mount(element, { layout, paint, markers = [], tests = true, pins = [], theme, cityLife = true, glow = true, relationsOf, onHover, onPick }) {
  const store = createStore({ layout, layoutKey: 1, paint, markers, tests, pins: [...pins], theme: cityTheme(theme), cityLife: !!cityLife, glow: !!glow, paused: false, level: 0, scoreDistrict: null, hover: null, pinned: null, glError: '' });
  Object.assign(store, {
    tagEls: new Map(),
    tagAnchors: new Map(),
    rig: null,
    lastFocus: null,
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
  // off screen (display: none, out of view) or the window hidden: no frame of City life
  let seen = true;
  const page = typeof document === 'object' ? document : null;
  const watch = () => { const paused = !seen || !!page?.hidden; if (paused !== store.get().paused) store.set({ paused }); };
  const seer = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => { seen = entries[entries.length - 1].isIntersecting; watch(); }) : null;
  seer?.observe(element);
  page?.addEventListener('visibilitychange', watch);
  const root = createRoot(element);
  root.render(<App store={store} />);
  return {
    update(patch) {
      const next = { ...patch };
      if (patch.theme) next.theme = cityTheme(patch.theme);
      if (patch.pins) next.pins = [...patch.pins];
      if (patch.layout && patch.layout !== store.get().layout) Object.assign(next, { layoutKey: store.get().layoutKey + 1, scoreDistrict: null, hover: null, pinned: null });
      store.set(next);
    },
    pin(target) { store.set({ pinned: target || null }); },
    flyTo(target) { if (target) store.rig?.fly(target); },
    home() { store.rig?.home(); },
    zoom(factor) { store.rig?.zoom(factor); },
    stats: () => {
      const { layout, paint, cityLife, glow } = store.get(), built = buildingsOf(layout);
      const buildings = (layout?.buildings || []).map((b, i) => ({ path: b.path, archetype: built[i]?.kind || null, greyed: !!paint?.greyed?.[i] }));
      return { firstFrameMs: store.stats.firstFrameMs, fps: store.stats.fps, buildings, cityLife, glow, props: lifeCount(layout, cityLife) };
    },
    unmount() {
      seer?.disconnect();
      page?.removeEventListener('visibilitychange', watch);
      root.unmount();
    },
  };
}

window.ProjectCityScene = { mount };
