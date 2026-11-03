// #650 Write doc phase 5 (docs/work/write-doc/spec.md R16): Maintain from the Monitor and the Night watch,
// a front for the intents. Acceptance tests written before the code.
// Seams assumed in fronts/plan/engine/domains/docs.js (plain functions, the repository folder first):
// - recordIncident(dir, { item, date, source, error, diagnosis? }) → { commit, intent: { item, file } }:
//   one row in the ## Incidents table of docs/work/<item>/maintain.md (and its maintain.pt-BR.md when it
//   exists; maintain.md is created from the playbook's skeleton when the item has none), and a NEW item
//   docs/work/<new item>/intent.md (stage intent, status draft) whose front matter `from:` and body link
//   back to the item's maintain.md; the row's "New intent" column links to that intent; ONE commit with
//   all of it. An item that does not exist, or a name outside docs/work/<item>/, is refused before
//   anything is written.
// - writePostMortem(dir, { item, intent, text }) → { commit }: the post-mortem under ## Post-mortems of
//   the item's maintain.md, naming the incident's intent; one commit.
// - readDoc(dir, { item, doc: 'maintain' }) reads the maintain document like the others.
// - listIntents(dir) → [{ item, file, status, from }] every docs/work/<item>/intent.md (the front for the
//   intents); `from` the link back (null for an intent written by hand). acceptDoc validates one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeRepo } = require('@multiagent/engine/test/repo-workflow-fixtures-485');

const load = () => require('../engine/domains/docs');

const fm = (fields) => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`;

const INTENT = `${fm({ item: 'checkout', issue: '"#1"', stage: 'intent', status: 'accepted', approver: 'Owner', date: '2026-10-30', translation: 'intent.pt-BR.md' })}
# Intent: checkout

## Problem

People cannot pay.
`;
const MAINTAIN = `${fm({ item: 'checkout', issue: '"#1"', stage: 'maintain', status: 'no incidents', approver: 'service owner', translation: 'maintain.pt-BR.md' })}
# Maintain: incidents and post-mortems

## Incidents

| Date | Source | Error | New intent | Fix |
|---|---|---|---|---|
| — | — | — | — | no incidents |

## Post-mortems

For each resolved incident, a short post-mortem.
`;
const MAINTAIN_PT = `${fm({ item: 'checkout', issue: '"#1"', stage: 'maintain', status: 'no incidents', approver: 'service owner', source: 'maintain.md' })}
# Maintain: incidentes e post-mortems

## Incidentes

| Data | Origem | Erro | Novo intent | Fix |
|---|---|---|---|---|
| — | — | — | — | sem incidentes |

## Post-mortems

Para cada incidente resolvido, um post-mortem curto.
`;
const ERROR = "500 POST /api/checkout: TypeError: cannot read 'total' of undefined";

const FILES = {
  'docs/work/checkout/intent.md': INTENT,
  'docs/work/checkout/maintain.md': MAINTAIN,
  'docs/work/checkout/maintain.pt-BR.md': MAINTAIN_PT,
};

function repo(t, files = FILES) {
  const r = makeRepo(t, files);
  r.git('config', 'user.name', 'Test');
  r.git('config', 'user.email', 'test@example.com');
  r.git('config', 'core.autocrlf', 'false');
  return r;
}
const read = (r, rel) => fs.readFileSync(path.join(r.dir, ...rel.split('/')), 'utf8');
const exists = (r, rel) => fs.existsSync(path.join(r.dir, ...rel.split('/')));
const commitCount = (r) => Number(r.git('rev-list', '--count', 'HEAD'));
const frontMatter = (text) => {
  const lines = text.split('\n');
  const end = lines.indexOf('---', 1);
  return Object.fromEntries(lines.slice(1, end).map((l) => [l.slice(0, l.indexOf(':')), l.replace(/\s+#.*$/, '').slice(l.indexOf(':') + 1).trim()]));
};
// the lines of the section `heading` (## …) up to the next ## heading
const section = (text, heading) => {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return '';
  const next = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  return lines.slice(start + 1, next < 0 ? undefined : next).join('\n');
};
const incident = (over = {}) => ({ item: 'checkout', date: '2026-11-02', source: 'monitor', error: ERROR, ...over });

// ---- recordIncident -----------------------------------------------------------------------------

test('#650 recordIncident adds the incident to the item\'s maintain.md Incidents table, in place of "no incidents"', (t) => {
  const r = repo(t);
  load().recordIncident(r.dir, incident());
  const rows = section(read(r, 'docs/work/checkout/maintain.md'), '## Incidents').split('\n').filter((l) => l.startsWith('|'));
  const row = rows.find((l) => l.includes(ERROR));
  assert.ok(row, rows.join('\n'));
  assert.ok(row.includes('2026-11-02'), row);
  assert.ok(row.toLowerCase().includes('monitor'), row);
  assert.equal(rows.some((l) => l.includes('no incidents')), false, rows.join('\n'));
});

test('#650 recordIncident opens a new intent item, a draft whose front matter and body link back to the item\'s maintain.md', (t) => {
  const r = repo(t);
  const res = load().recordIncident(r.dir, incident());
  const newItem = res?.intent?.item;
  assert.ok(newItem && newItem !== 'checkout', JSON.stringify(res));
  assert.equal(res.intent.file, `docs/work/${newItem}/intent.md`);
  const text = read(r, `docs/work/${newItem}/intent.md`);
  const meta = frontMatter(text);
  assert.equal(meta.item, newItem);
  assert.equal(meta.stage, 'intent');
  assert.equal(meta.status, 'draft');
  assert.ok(String(meta.from || '').includes('checkout/maintain.md'), `from: ${meta.from}`);
  const body = text.split('\n').slice(text.split('\n').indexOf('---', 1) + 1).join('\n');
  assert.ok(body.includes('../checkout/maintain.md'), body);
  assert.ok(body.includes("TypeError: cannot read 'total' of undefined"), body);
});

test('#650 the incident\'s row links to the new intent', (t) => {
  const r = repo(t);
  const { intent } = load().recordIncident(r.dir, incident());
  const row = section(read(r, 'docs/work/checkout/maintain.md'), '## Incidents').split('\n').find((l) => l.includes(ERROR));
  assert.ok(row && row.includes(`../${intent.item}/intent.md`), row);
});

test('#650 recordIncident makes ONE commit with the maintain.md, its translation and the new intent', (t) => {
  const r = repo(t);
  const before = commitCount(r);
  const res = load().recordIncident(r.dir, incident({ source: 'night-watch' }));
  assert.equal(commitCount(r), before + 1);
  assert.equal(r.git('rev-parse', 'HEAD').trim(), res.commit);
  const files = r.git('show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort();
  assert.deepEqual(files, ['docs/work/checkout/maintain.md', 'docs/work/checkout/maintain.pt-BR.md', res.intent.file].sort());
  assert.equal(r.git('status', '--porcelain').trim(), '');
  assert.ok(section(read(r, 'docs/work/checkout/maintain.pt-BR.md'), '## Incidentes').includes(ERROR));
});

test('#650 an item without maintain.md gets one from the skeleton, with the incident in its Incidents table', (t) => {
  const r = repo(t, { 'docs/work/checkout/intent.md': INTENT });
  load().recordIncident(r.dir, incident());
  const text = read(r, 'docs/work/checkout/maintain.md');
  assert.equal(frontMatter(text).stage, 'maintain');
  assert.ok(section(text, '## Incidents').includes(ERROR), text);
  assert.ok(text.split('\n').some((l) => l.trim() === '## Post-mortems'), text);
});

test('#650 recordIncident refuses an item that does not exist and a name outside docs/work, writing nothing', (t) => {
  const r = repo(t);
  const before = commitCount(r);
  assert.equal(typeof load().recordIncident, 'function', 'recordIncident');
  assert.throws(() => load().recordIncident(r.dir, incident({ item: 'nope' })), /nope/);
  assert.throws(() => load().recordIncident(r.dir, incident({ item: '../checkout' })));
  assert.equal(commitCount(r), before);
  assert.equal(r.git('status', '--porcelain').trim(), '');
  assert.equal(exists(r, 'docs/work/nope'), false);
});

test('#650 the translation\'s empty row in the playbook\'s pt-BR words ("nenhum incidente") is replaced too', (t) => {
  const pt = MAINTAIN_PT.replace('| — | — | — | — | sem incidentes |', '| — | — | — | — | nenhum incidente |');
  const r = repo(t, { ...FILES, 'docs/work/checkout/maintain.pt-BR.md': pt });
  load().recordIncident(r.dir, incident());
  const rows = section(read(r, 'docs/work/checkout/maintain.pt-BR.md'), '## Incidentes').split('\n').filter((l) => l.startsWith('|'));
  assert.equal(rows.filter((l) => l.includes(ERROR)).length, 1, rows.join('\n'));
  assert.equal(rows.some((l) => l.includes('nenhum incidente')), false, rows.join('\n'));
});

test('#650 a second incident is a second row; the first one stays', (t) => {
  const r = repo(t);
  load().recordIncident(r.dir, incident());
  load().recordIncident(r.dir, incident({ date: '2026-11-03', source: 'night-watch', error: 'stalled in run r-42' }));
  const rows = section(read(r, 'docs/work/checkout/maintain.md'), '## Incidents').split('\n').filter((l) => l.startsWith('|'));
  assert.equal(rows.filter((l) => l.includes(ERROR)).length, 1, rows.join('\n'));
  assert.equal(rows.filter((l) => l.includes('stalled in run r-42')).length, 1, rows.join('\n'));
  assert.equal(load().listIntents(r.dir).length, 3);
});

test('#650 readDoc reads the maintain document with the recorded incident', (t) => {
  const r = repo(t);
  load().recordIncident(r.dir, incident());
  const doc = load().readDoc(r.dir, { item: 'checkout', doc: 'maintain' });
  assert.equal(doc.source.file, 'docs/work/checkout/maintain.md');
  assert.ok(doc.source.markdown.includes(ERROR));
});

// ---- writePostMortem ----------------------------------------------------------------------------

test('#650 writePostMortem writes the post-mortem under Post-mortems, naming the incident\'s intent, in one commit', (t) => {
  const r = repo(t);
  const { intent } = load().recordIncident(r.dir, incident());
  const before = commitCount(r);
  const TEXT = 'The cart total was read before the cart loaded; fixed in abc1234, with a new test for an empty cart.';
  load().writePostMortem(r.dir, { item: 'checkout', intent: intent.item, text: TEXT });
  assert.equal(commitCount(r), before + 1);
  const pm = section(read(r, 'docs/work/checkout/maintain.md'), '## Post-mortems');
  assert.ok(pm.includes(TEXT), pm);
  assert.ok(pm.includes(intent.item), pm);
  assert.equal(section(read(r, 'docs/work/checkout/maintain.md'), '## Incidents').includes(TEXT), false);
});

// ---- the front for the intents ------------------------------------------------------------------

test('#650 listIntents lists every item\'s intent with its status and the link back of an incident\'s intent', (t) => {
  const r = repo(t);
  const { intent } = load().recordIncident(r.dir, incident());
  const list = load().listIntents(r.dir);
  const byItem = Object.fromEntries(list.map((i) => [i.item, i]));
  assert.deepEqual(Object.keys(byItem).sort(), ['checkout', intent.item].sort());
  assert.equal(byItem.checkout.status, 'accepted');
  assert.equal(byItem.checkout.from ?? null, null);
  assert.equal(byItem[intent.item].status, 'draft');
  assert.equal(byItem[intent.item].file, intent.file);
  assert.ok(String(byItem[intent.item].from).includes('checkout/maintain.md'), JSON.stringify(byItem[intent.item]));
});

test('#650 listIntents is empty for a repository without docs/work', (t) => {
  const r = makeRepo(t, {});
  assert.deepEqual(load().listIntents(r.dir), []);
});

test('#650 an incident\'s intent validated with acceptDoc reads accepted in listIntents and keeps its link back', (t) => {
  const r = repo(t);
  const { intent } = load().recordIncident(r.dir, incident());
  load().acceptDoc(r.dir, { item: intent.item, doc: 'intent', approver: 'Owner', date: '2026-11-03' });
  const row = load().listIntents(r.dir).find((i) => i.item === intent.item);
  assert.equal(row?.status, 'accepted');
  assert.ok(String(row.from).includes('checkout/maintain.md'));
});
