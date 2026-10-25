// #330 catalog keys built at runtime (t(`live_turn.listing_${what}`)): test/i18n-catalog-check-329.test.js
// only finds literal keys, so a key a screen builds from a value is checked here, in English and pt-BR:
// - every template key family in apps/desktop/renderer has at least one entry in en.json;
// - the families whose values are known (the live turn's gh/glab and git labels, apps/desktop/renderer/live-turn.js
//   commandLabel; the Arena's dropped-out rows, views/arena/arena.js; the conflict map's recommendation
//   badges, views/project/project-conflict-map.js REC_LABEL) have an entry for each value.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const RENDERER = path.join(ROOT, 'apps', 'desktop', 'renderer');
const en = require('@multiagent/shared/i18n/en.json');
const pt = require('@multiagent/shared/i18n/pt-BR.json');

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'vendor' ? [] : jsFiles(p);
    return /\.js$/.test(e.name) ? [p] : [];
  });
}

test('#330 every key a renderer file builds with t(`<prefix>${…}`) has catalog entries under its prefix', () => {
  const keys = Object.keys(en);
  const missing = [];
  for (const file of jsFiles(RENDERER)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:\bI18n\.t|(?<![\w$.])t)\(\s*`([a-z][\w.-]*)\$\{/g)) {
      const prefix = m[1];
      if (!prefix.includes('.') && !prefix.endsWith('_')) continue; // a whole key from a value: not a family
      if (!keys.some((k) => k.startsWith(prefix))) missing.push(`${path.relative(ROOT, file)}: ${prefix}…`);
    }
  }
  assert.deepEqual(missing, []);
});

const FAMILIES = {
  // live-turn.js commandLabel: gh/glab issue|pr|mr|repo|run (view / list / other verb), git log|diff|…
  'live_turn.reading_one_': ['issue', 'pr', 'mr', 'repo', 'run'],
  'live_turn.listing_': ['issue', 'pr', 'mr', 'repo', 'run'],
  'live_turn.reading_': ['issue', 'pr', 'mr', 'repo', 'run'],
  'live_turn.git_': ['log', 'diff', 'show', 'status', 'blame', 'grep'],
  // arena.js: "[compete] <agent> failed: …" / "[critique] …"
  'arena.dropped_out_of_': ['compete', 'critique'],
  // project-conflict-map.js REC_LABEL
  'project_conflict_map.rec_': ['generated', 'registry', 'large', 'stylesheet', 'doc', 'test', 'hotspot'],
};

test('#330 the live turn\'s, the Arena\'s and the conflict map\'s runtime keys exist for every value, in en and pt-BR', () => {
  const missing = [];
  for (const [prefix, values] of Object.entries(FAMILIES)) {
    for (const v of values) {
      const key = `${prefix}${v}`;
      if (!(key in en)) missing.push(`en: ${key}`);
      if (!(key in pt)) missing.push(`pt-BR: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('#330 the conflict map\'s recommendation badges use exactly the rec_ keys of the catalog', () => {
  const src = fs.readFileSync(path.join(RENDERER, 'views', 'project', 'project-conflict-map.js'), 'utf8');
  const table = /const REC_LABEL = \{([^}]*)\}/.exec(src);
  assert.ok(table, 'REC_LABEL not found in project-conflict-map.js: the source moved');
  const labels = [...table[1].matchAll(/'(rec_\w+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(labels, FAMILIES['project_conflict_map.rec_'].map((k) => `rec_${k}`).sort());
});
