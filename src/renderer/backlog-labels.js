// Backlog label filter rule (#91): labels from different groups combine with AND, labels of the
// same group with OR. A group is the prefix before ':' (`complexity:1`, `complexity:2`); labels
// without a prefix form one group of their own (`bug`, `enhancement`). Names compare whole and
// case-insensitively, never as substrings (`bug` does not match `debug`).
// The triage labels of the issue tracker (`impact:<1-5>`, `complexity:<1-5>`) also give each issue
// scores, for the badges and the sort.
// No DOM here: backlog.js draws the control, a test feeds it issues.
// Browser: window.BacklogLabels; Node: module.exports.
(function (root) {
  const key = (name) => String(name || '').trim().toLowerCase();
  const group = (name) => {
    const k = key(name);
    const at = k.indexOf(':');
    return at > 0 ? k.slice(0, at) : '';
  };
  const names = (issue) => (issue?.labels || []).map((l) => (typeof l === 'string' ? l : l?.name));

  // True when the issue has, for every group in the selection, at least one of its labels.
  function matchesLabels(issue, selected) {
    if (!selected?.length) return true;
    const have = new Set(names(issue).map(key));
    const groups = new Map();
    for (const s of selected) {
      const g = group(s);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(key(s));
    }
    return [...groups.values()].every((any) => any.some((k) => have.has(k)));
  }

  // Every label present in `all` (name and color of its first appearance), with the number of
  // `counted` issues that have it; sorted by group (unprefixed first), then name.
  function labelOptions(all, counted = all) {
    const byKey = new Map();
    for (const i of all || []) {
      for (const l of i?.labels || []) {
        const name = typeof l === 'string' ? l : l?.name;
        const k = key(name);
        if (k && !byKey.has(k)) byKey.set(k, { name: String(name).trim(), color: (typeof l === 'object' && l?.color) || '', count: 0 });
      }
    }
    for (const i of counted || []) {
      for (const k of new Set(names(i).map(key))) if (byKey.has(k)) byKey.get(k).count++;
    }
    return [...byKey.values()].sort((a, b) => group(a.name).localeCompare(group(b.name)) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  // The selection without labels no issue has any more (after a sync), without duplicates.
  function pruneLabels(selected, issues) {
    const present = new Set((issues || []).flatMap((i) => names(i).map(key)));
    const seen = new Set();
    return (selected || []).filter((s) => {
      const k = key(s);
      if (!present.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // Adds the label, or removes it when it is already selected (any case).
  function toggleLabel(selected, name) {
    const k = key(name);
    const list = selected || [];
    return list.some((s) => key(s) === k) ? list.filter((s) => key(s) !== k) : k ? [...list, String(name).trim()] : list;
  }

  const hasLabel = (selected, name) => (selected || []).some((s) => key(s) === key(name));

  // The issue tracker's triage labels (#81): `impact:1`…`impact:5`, `complexity:1`…`complexity:5`.
  // A score is null when the issue has no such label (or not a 1-5 one); with several, the highest.
  function triageScores(issue) {
    const out = { impact: null, complexity: null };
    for (const n of names(issue)) {
      const m = /^(impact|complexity):\s*([1-5])$/.exec(key(n));
      if (m) out[m[1]] = Math.max(out[m[1]] || 0, Number(m[2]));
    }
    return out;
  }

  // Issues in the order the Backlog's sort asks for, without changing the array: `updated` keeps
  // the sync's order; `impact` puts the highest impact first; `complexity` the smallest first.
  // Issues without the score go last; ties keep the sync's order.
  const SORTS = { impact: (s) => -s.impact, complexity: (s) => s.complexity };
  function sortIssues(issues, by) {
    const list = [...(issues || [])];
    const rank = SORTS[by];
    if (!rank) return list;
    const scored = list.map((issue, at) => ({ issue, at, s: triageScores(issue) }));
    const val = (x) => (x.s[by] == null ? Infinity : rank(x.s));
    return scored.sort((a, b) => val(a) - val(b) || a.at - b.at).map((x) => x.issue);
  }

  const api = { hasLabel, labelGroup: group, labelOptions, matchesLabels, pruneLabels, sortIssues, toggleLabel, triageScores };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BacklogLabels = api;
})(typeof window !== 'undefined' ? window : globalThis);
