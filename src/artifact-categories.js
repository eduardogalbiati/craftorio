// Artifact categories (#225): what a run produced comes first, its working files apart. Every
// artifact gets a category from its path (relative to the run folder) and the event that saved it:
// - result: result.md, the run's summary (src/result-summary.js);
// - screenshots: evidence captures (evidence/<step>/round-<n>/, legacy screenshots/), any image;
// - tests: e2e/ (scenarios, results JSON, Playwright traces), coverage/, test results files;
// - reports: reports/, *report*.md, a document a step saved (file.saved) that fits nowhere else;
// - process: handoff notes, decisions.tsv, the agents' logs, the evidence manifest, anything else
//   of the run folder;
// - internal: scratch/ (the run's seeded workspace, #201; a file an agent saved there on purpose is
//   not), owner.json, locks. Never listed.
// and a kind from its extension: image, markdown, json, log or other.
// filterArtifacts: "produced" (result, screenshots, tests, reports) or "all" (plus process),
// narrowed by category or kind, ordered by category. The renderer's Artifacts panel uses the same
// order and labels (artifacts-panel.js CATEGORIES).
const CATEGORIES = [
  'result',
  'screenshots',
  'tests',
  'reports',
  'process',
  'internal',
];
const PRODUCED = new Set(['result', 'screenshots', 'tests', 'reports']);

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

function relOf(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function kindOf(p) {
  const rel = relOf(p);
  if (IMAGE.test(rel)) return 'image';
  if (/\.(md|markdown)$/i.test(rel)) return 'markdown';
  if (/\.jsonl?$/i.test(rel)) return 'json';
  if (/\.log$/i.test(rel)) return 'log';
  return 'other';
}

function categoryOf(p, event) {
  const rel = relOf(p);
  const base = rel.split('/').pop();
  // a file an agent saved on purpose in the scratch workspace is an artifact (#201)
  if ((/^scratch\//i.test(rel) && event !== 'file.saved') || /^owner\.json$/i.test(rel) || /\.lock$/i.test(base) || /(^|\/)\.locks?\//i.test(rel)) return 'internal';
  if (/^result\.md$/i.test(rel)) return 'result';
  // the evidence index is bookkeeping: its screenshots are what the run produced
  if (/^(handoffs|logs)\//i.test(rel) || /^decisions\.tsv$/i.test(rel) || /\.log$/i.test(base) || /^evidence\/manifest\.json$/i.test(rel)) return 'process';
  if (/^(e2e|coverage|test-results)\//i.test(rel) || /(^|[-_.])(test-results|coverage|junit)[-_.]/i.test(base) || /\.trace\.zip$/i.test(base)) return 'tests';
  if (/^(evidence|screenshots)\//i.test(rel) || IMAGE.test(base)) return 'screenshots';
  if (/^reports\//i.test(rel) || /report/i.test(base)) return 'reports';
  // a file a step saved on purpose is something the run produced; the rest is the run's own bookkeeping
  return event === 'file.saved' ? 'reports' : 'process';
}

// { path, step?, agent?, event? } → the same fields plus category and kind
function categorizeArtifact(artifact = {}) {
  const p = artifact.rel || artifact.path;
  return { ...artifact, category: categoryOf(p, artifact.event), kind: kindOf(p) };
}

const rank = (c) => {
  const i = CATEGORIES.indexOf(c);
  return i < 0 ? CATEGORIES.length : i;
};

function filterArtifacts(list = [], { show = 'produced', category = null, kind = null } = {}) {
  const shown = (c) => c !== 'internal' && (PRODUCED.has(c) || (show === 'all' && c === 'process'));
  return (list || [])
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => shown(a.category) && (!category || a.category === category) && (!kind || a.kind === kind))
    .sort((x, y) => rank(x.a.category) - rank(y.a.category) || x.i - y.i)
    .map(({ a }) => a);
}

module.exports = {
  CATEGORIES,
  categorizeArtifact,
  categoryOf,
  filterArtifacts,
  kindOf,
};
