// The project city's state inside the bundle (#373): what main.jsx's handle sets (the layout, its
// paint, the markers, the Tests toggle, the theme, the City life and Glow switches) and what the scene sets (the level of detail, the
// hovered and pinned target), read with useStore. The store object also carries the scene's
// callbacks and its imperative parts (the camera's commands, the tags' DOM nodes, the measures).
import { useSyncExternalStore } from 'react';

export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      for (const f of subs) f();
    },
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}

/** The store's state, re-rendering on every change. */
export const useStore = (store) => useSyncExternalStore(store.subscribe, store.get);

// #450, City life per map mode (fronts/analyser/poc/city-modes.html LIFE_DEFAULT): on where the city is explored or
// watched live, off in the analysis modes so their colours read alone; on without a mode (the
// Architecture tab's city) and in a mode this table does not know
const LIFE_DEFAULT = { explore: true, issue: false, live: true, release: false, replay: false, stage: false };

/** The City life switch's default in `mode`. */
export const cityLifeDefault = (mode) => LIFE_DEFAULT[mode] ?? true;

/** The City life switch in `mode`: what the user set for that mode (`remembered`, by mode), else its default. */
export const cityLifeOf = (remembered, mode) => (typeof remembered?.[mode] === 'boolean' ? remembered[mode] : cityLifeDefault(mode));

/** A new memory with the switch set to `on` in `mode`; `remembered` itself is not changed. */
export const rememberCityLife = (remembered, mode, on) => ({ ...(remembered || {}), [mode]: !!on });
