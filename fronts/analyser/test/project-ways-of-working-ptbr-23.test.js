// #23 acceptance, written before the code: the Ways of working drawer (fronts/analyser/views/project/
// project-ways-of-working.js) in pt-BR shows its evidence lines (data-testid="ways-of-working-evidence") in words,
// never the engine's raw keys: no "authors 7", "identities", "mergeCommits", "ownerStraightCommits", "release tags".
// The evidence is what packages/engine/service/areas/workflow-interview.js answers today (team / merge / mode /
// release with their numbers). Same mini DOM and fake window.api as project-ways-of-working-844-847.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const I18n = require('@craftorio/shared/i18n.js');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');
const { createDom } = require('@craftorio/ui-kit/test/mini-dom');

const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const FILE = pageFileOf('views/project/project-ways-of-working.js');
const clone = (x) => JSON.parse(JSON.stringify(x));

const PROFILE = { mode: 'local', release: 'milestone', testCommand: 'npm test', checkCommand: null, e2eCommand: null, ci: 'none', tests: 'unit', languages: ['javascript'] };
const EVIDENCE = {
  team: { numbers: { authors: 7, identities: 9, commits: 120 }, commits: ['a1b2c3d4e5'] },
  merge: { numbers: { mergeCommits: 4 }, commits: ['a1b2c3d4e5'] },
  mode: { numbers: { authors: 7, mergeCommits: 4, ownerStraightCommits: 30 }, commits: ['a1b2c3d4e5'] },
  release: { numbers: { tags: 3 }, commits: [] },
};
const LAST = { profile: PROFILE, evidence: EVIDENCE, questions: [], simulated: true, date: '2026-11-20T10:00:00.000Z', costUsd: 0 };
const PROJECT = { id: 'p1', name: 'shop' };

function loadDrawer() {
  const api = {
    seedEstimate: async () => ({ costUsd: 0, free: true }),
    workflowInterview: async () => clone(LAST),
    workflowInterviewLast: async () => clone(LAST),
    workflowInterviewState: async () => ({ running: null, error: null }),
    workflowCompose: async () => ({ workflows: [], manifest: { path: '.multiagent/project.yaml', yaml: '' } }),
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Promise, Date,
    api,
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e), showToast: () => {},
    fmtUsd: (n) => `$${Number(n).toFixed(2)}`,
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  withI18n(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: 'project-ways-of-working.js' });
  return { WOW: sandbox.ProjectWaysOfWorking, doc: dom.document };
}

const settle = async () => { for (let i = 0; i < 15; i++) await new Promise((r) => setImmediate(r)); };
const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function evidenceLines(t, lang) {
  const was = I18n.getLanguage();
  I18n.setLanguage(lang);
  const w = loadDrawer();
  t.after(() => { w.WOW.close(); I18n.setLanguage(was); });
  await w.WOW.open(clone(PROJECT));
  await settle();
  return Array.from(w.doc.querySelectorAll('[data-testid="ways-of-working-evidence"]')).map(text);
}

const RAW = ['authors 7', 'identities', 'mergeCommits', 'ownerStraightCommits', 'release tags'];

test('#23 Ways of working in pt-BR: the evidence lines carry no raw key', async (t) => {
  const lines = await evidenceLines(t, 'pt-BR');
  assert.equal(lines.length, 4, `one line per fact: ${JSON.stringify(lines)}`);
  const all = lines.join(' | ');
  assert.deepEqual(RAW.filter((s) => all.includes(s)), [], all);
});

test('#23 Ways of working in pt-BR: the evidence keeps its numbers', async (t) => {
  const all = (await evidenceLines(t, 'pt-BR')).join(' | ');
  for (const n of ['7', '9', '120', '4', '30', '3']) assert.match(all, new RegExp(`\\b${n}\\b`), `${n} in ${all}`);
});

test('#23 Ways of working in English: the evidence lines are words too, no camelCase key', async (t) => {
  const all = (await evidenceLines(t, 'en')).join(' | ');
  assert.equal(/mergeCommits|ownerStraightCommits/.test(all), false, all);
});
