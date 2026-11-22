// The browser's stored preferences before the rename to Craftorio (T2c): every localStorage key
// `multiagent.<name>` is copied once to `craftorio.<name>` when that one is unset, then removed, so
// the open project, the panels and the filters a user had come back under the new names. Runs when
// loaded as a <script> (the first shared module of the page); in Node it only exports the function.
// Dual-load (Node + <script>).
//   migrateLegacyStorage(storage) → [new keys written]
(function (root) {
  const OLD = 'multiagent.';
  const NEW = 'craftorio.';

  function migrateLegacyStorage(storage) {
    const written = [];
    if (!storage) return written;
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(OLD)) keys.push(k);
    }
    for (const k of keys) {
      const name = NEW + k.slice(OLD.length);
      if (storage.getItem(name) == null) {
        storage.setItem(name, storage.getItem(k));
        written.push(name);
      }
      storage.removeItem(k);
    }
    return written;
  }

  const api = { migrateLegacyStorage };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.LegacyStorage = api;
    try { migrateLegacyStorage(root.localStorage); } catch { /* storage unavailable: nothing to bring over */ }
  }
})(typeof window !== 'undefined' ? window : globalThis);
