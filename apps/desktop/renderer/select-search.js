// The search box of a long select (#383): a select with more than 10 options opens select.js's list
// with a search box on top, and typing keeps the options whose label holds the query.
// - needsSearch(optionCount): true above 10 options.
// - matchOption(label, query): a trimmed, case- and accent-insensitive substring match; a blank
//   query matches every label.
// Browser: window.SelectSearch; Node: module.exports.
// load: early (select.js reads it when a select opens)
(function (root) {
  const SEARCH_ABOVE = 10;

  const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  function needsSearch(optionCount) {
    return Number(optionCount) > SEARCH_ABOVE;
  }

  function matchOption(label, query) {
    const q = fold(query);
    return !q || fold(label).includes(q);
  }

  const api = {
    matchOption,
    needsSearch,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SelectSearch = api;
})(typeof window !== 'undefined' ? window : globalThis);
