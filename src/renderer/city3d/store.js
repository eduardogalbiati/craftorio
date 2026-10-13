// The project city's state inside the bundle (#373): what main.jsx's handle sets (the layout, its
// paint, the markers, the Tests toggle, the theme) and what the scene sets (the level of detail, the
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
