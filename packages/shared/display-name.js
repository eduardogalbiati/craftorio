// An agent's name as people read it: `test_writer` → "Test writer", `pr_babysitter` → "PR babysitter".
// An agent imported from the Agents menu shows its own name (`names`: agent key → name, from the
// run's workflow.started `agent_names`). Fan-out labels ("a · b") are named part by part. The slug
// stays in tooltips and details, for debugging.
// Browser: window.displayName; Node: module.exports.
// Loaded before the renderer's files, like every packages/shared/ module (views/runchat/run-chat-model.js
// reads window.displayName as it loads).
(function (root) {
  const ACRONYMS = new Set(['pr', 'ci', 'mr', 'qa', 'ui', 'api', 'ai', 'cli', 'ux', 'id', 'url', 'sql', 'e2e']);

  function one(slug, names) {
    const key = String(slug || '').trim();
    if (!key) return '';
    if (names && typeof names[key] === 'string' && names[key].trim()) return names[key].trim();
    const words = key.replace(/^_+/, '').split(/[_\-\s]+/).filter(Boolean);
    if (!words.length) return key;
    return words.map((w, i) => {
      if (ACRONYMS.has(w.toLowerCase())) return w.toUpperCase();
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    }).join(' ');
  }

  function displayName(slug, names) {
    return String(slug || '').split(' · ').map((s) => one(s, names)).filter(Boolean).join(' · ');
  }

  if (typeof module === 'object' && module.exports) module.exports = { displayName };
  else root.displayName = displayName;
})(typeof window !== 'undefined' ? window : globalThis);
