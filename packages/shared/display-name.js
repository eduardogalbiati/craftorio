// An agent's name as people read it: `test_writer` → "Test writer", `pr_babysitter` → "PR babysitter".
// An agent imported from the Agents menu shows its own name (`names`: agent key → name, from the
// run's workflow.started `agent_names`). Fan-out labels ("a · b") are named part by part. The slug
// stays in tooltips and details, for debugging.
// #41: a bundled agent's name (agent_names.<slug>) reads in the interface language when the recorded
// name is the English one (derived from the slug, or the catalog's English); an imported name stays.
// Browser: window.displayName; Node: module.exports.
// Loaded before the renderer's files, like every packages/shared/ module (views/runchat/run-chat-model.js
// reads window.displayName as it loads).
(function (root) {
  const ACRONYMS = new Set(['pr', 'ci', 'mr', 'qa', 'ui', 'api', 'ai', 'cli', 'ux', 'id', 'url', 'sql', 'e2e']);
  const i18n = () => (typeof module === 'object' && module.exports ? require('./i18n') : root.I18n);

  function derived(key) {
    const words = key.replace(/^_+/, '').split(/[_\-\s]+/).filter(Boolean);
    if (!words.length) return key;
    return words.map((w, i) => {
      if (ACRONYMS.has(w.toLowerCase())) return w.toUpperCase();
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    }).join(' ');
  }

  function one(slug, names) {
    const key = String(slug || '').trim();
    if (!key) return '';
    const own = names && typeof names[key] === 'string' && names[key].trim() ? names[key].trim() : '';
    const plain = derived(key);
    const I18n = i18n();
    if (!I18n?.translated) return own || plain;
    const catalogKey = `agent_names.${key}`;
    const english = I18n.t(catalogKey, {}, 'en');
    if (own && own !== plain && own !== english) return own;
    return I18n.translated(catalogKey, own || plain);
  }

  function displayName(slug, names) {
    return String(slug || '').split(' · ').map((s) => one(s, names)).filter(Boolean).join(' · ');
  }

  if (typeof module === 'object' && module.exports) module.exports = { displayName };
  else root.displayName = displayName;
})(typeof window !== 'undefined' ? window : globalThis);
