// The public page's item order by dependency (docs/work/CONVENTIONS.md `depends_on:`): an item comes
// after the items it builds on when they are in the same group (in progress, planned, shipped). Loaded
// by the pages before reader.js (window.SdlcOrder) and required by test/site-order.test.js.
//
//   dependsOn(value)               the folder names of a `depends_on:` value (a string or a list), [] when empty
//   orderByDeps(items, groupOf)    items in the same order, each moved after its same-group dependencies;
//                                  a dependency on a missing folder and a cycle are ignored
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SdlcOrder = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function dependsOn(value) {
    var list = Array.isArray(value) ? value : String(value || '').split(/[,\s]+/);
    return list.map(function (v) { return String(v).trim(); }).filter(function (v) { return /^[a-z0-9][a-z0-9._-]*$/i.test(v); });
  }
  // a stable topological order: walk the items as they are, placing an item's dependencies first
  function orderByDeps(items, groupOf) {
    var byName = {}, placed = {}, visiting = {}, out = [];
    items.forEach(function (it) { byName[it.name] = it; });
    function visit(it) {
      if (placed[it.name] || visiting[it.name]) return;   // done, or a cycle: that edge is ignored
      visiting[it.name] = true;
      (it.deps || []).forEach(function (d) {
        var dep = byName[d];
        if (dep && dep !== it && groupOf(dep) === groupOf(it)) visit(dep);
      });
      visiting[it.name] = false;
      placed[it.name] = true;
      out.push(it);
    }
    items.forEach(visit);
    return out;
  }
  return { dependsOn: dependsOn, orderByDeps: orderByDeps };
});
