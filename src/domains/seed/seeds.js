// Analysis seeds (#360): prompt-defined analyses, adapted from Kent Beck's ToolSeeds (MIT), that the
// Oracle runs read-only on any project (src/domains/oracle/oracle-seeds.js). One folder per seed,
// <workspace>/seeds/<id>/seed.md: YAML front matter (name = the folder, a one-line summary, what it
// needs, what it produces, a cost hint; SEED_SCHEMA) and a Markdown body with a VERIFY section that
// ends with a "tell me" list to report back. The bundled seeds (seeds/ in the app) are seeded into the
// workspace like skills (src/domains/seed/seed.js): an edited copy freezes like any other copy.
// How to write one: docs/agents/seeds.md.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { copyDir, seedBundle } = require('./seed');
const { parseSkill } = require('../agents/skills');
const { validateSchema } = require('../workspace/json-schema');

const BUNDLED_SEEDS_DIR = path.join(__dirname, '..', '..', '..', 'seeds');
const SEED_FILE = 'seed.md';

const LINE = { type: 'string', minLength: 1 };
const SEED_SCHEMA = {
  type: 'object',
  required: ['name', 'summary', 'needs', 'produces', 'cost'],
  properties: {
    name: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' },
    summary: LINE,
    needs: { type: 'array', items: LINE },
    produces: { type: 'array', items: LINE },
    cost: LINE,
  },
};

const VERIFY = /^#+\s*VERIFY\b/m;
// a "tell me" line after VERIFY, followed by at least one Markdown bullet
const REPORT_BACK = /tell me[^\n]*\n(\s*\n)*\s*- \S/i;

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const seedFile = (dir, id) => path.join(dir, id, SEED_FILE);

/** The problems of a seed's text; [] when it is valid. */
function validateSeed(text) {
  const { meta, body } = parseSkill(text);
  const errors = validateSchema(meta, SEED_SCHEMA, 'front matter');
  const at = body.search(VERIFY);
  if (at < 0) errors.push('no VERIFY section (a "## VERIFY" heading)');
  else if (!REPORT_BACK.test(body.slice(at))) errors.push('no report-back list after VERIFY (a "tell me" line followed by "- " bullets)');
  return errors;
}

/** { id, meta, body } or null when the seed does not exist. */
function readSeed(dir, id) {
  const safe = path.basename(String(id || ''));
  if (!safe || !fs.existsSync(seedFile(dir, safe))) return null;
  const { meta, body } = parseSkill(fs.readFileSync(seedFile(dir, safe), 'utf8'));
  return { id: safe, meta, body };
}

const listOf = (v) => (Array.isArray(v) ? v.map(String) : []);

/** The seeds of a folder, sorted by id: { id, name, summary, cost, needs, produces } (or { id, error }). */
function listSeeds(dir) {
  if (!isDir(dir)) return [];
  return fs.readdirSync(dir)
    .filter((d) => fs.existsSync(seedFile(dir, d)))
    .sort()
    .map((id) => {
      try {
        const { meta } = readSeed(dir, id);
        return { id, name: String(meta.name || id), summary: String(meta.summary || ''), cost: String(meta.cost || ''), needs: listOf(meta.needs), produces: listOf(meta.produces) };
      } catch (e) {
        return { id, name: id, summary: '', cost: '', needs: [], produces: [], error: e.message };
      }
    });
}

const SEED_KIND = {
  list: (dir) => fs.readdirSync(dir).filter((d) => fs.existsSync(seedFile(dir, d))),
  exists: (dir, id) => fs.existsSync(seedFile(dir, id)),
  hash: (dir, id) => crypto.createHash('sha256').update(fs.readFileSync(seedFile(dir, id))).digest('hex'),
  copy: (srcDir, destDir, id) => copyDir(path.join(srcDir, id), path.join(destDir, id)),
  remove: (dir, id) => fs.rmSync(path.join(dir, id), { recursive: true, force: true }),
};

/** Copies/updates the bundled seeds into the workspace; the ids copied or updated. */
const seedSeeds = (srcDir, destDir) => seedBundle(srcDir, destDir, SEED_KIND);

module.exports = {
  BUNDLED_SEEDS_DIR,
  listSeeds,
  readSeed,
  SEED_KIND,
  SEED_SCHEMA,
  seedSeeds,
  validateSeed,
};
