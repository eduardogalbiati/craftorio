// A spec's mockups (#670): the owner's images and HTML mockups under `docs/work/<item>/` are the
// specification of its screens. The Product Owner's plan and issue turns name them in every screen
// task, and a proposal from the spec covers each one in scope (the rest are later phases).
//   MOCKUP_EXTENSIONS                              the file kinds that are mockups (any case)
//   findMockups(projectDir, item)                  every mockup of an item, [{ file, path }], sorted by path
//   checkMockupCoverage({ mockups, issues, outOfScope }) which issue covers each mockup, what is missing
//   itemOf(question)                               the `docs/work/<item>` a question names, or ''
//   mockupSection({ folder, question })            the prompt block of the item's mockups, or ''
//   specPhases(markdown)                           the spec's `## Phases` (each with its mockups) and later ones
//   specProposal({ folder, question, issues, mock }) the spec's issues with their coverage, or null
'use strict';

const fs = require('fs');
const path = require('path');
// the same file kinds the run's UI review reads in an issue
const { MOCKUP_EXTENSIONS } = require('../../engine/ui-review-checks');

const isMockup = (name) => MOCKUP_EXTENSIONS.includes(path.extname(name).toLowerCase());

function walk(dir, rel, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const relPath = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(path.join(dir, e.name), relPath, out);
    else if (e.isFile() && isMockup(e.name)) out.push({ file: e.name, path: relPath });
  }
  return out;
}

function findMockups(projectDir, item) {
  if (!projectDir || !item) return [];
  const rel = `docs/work/${item}`;
  return walk(path.join(projectDir, 'docs', 'work', item), rel, [])
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// an issue covers a mockup when its title or body names the mockup's base name
function checkMockupCoverage({ mockups = [], issues = [], outOfScope = [] } = {}) {
  const later = new Set(outOfScope);
  const covered = [];
  const missing = [];
  const laterList = [];
  for (const m of mockups) {
    const issue = issues.find((i) => `${i?.title || ''}\n${i?.body || ''}`.includes(m.file));
    if (issue) covered.push({ mockup: m.file, issue: issue.title });
    else if (later.has(m.file)) laterList.push(m.file);
    else missing.push(m.file);
  }
  const errors = missing.map((file) => `${file} has no issue`);
  return { ok: errors.length === 0, covered, missing, later: laterList, errors };
}

const itemOf = (question) => (String(question || '').match(/docs\/work\/([\w.-]+)/) || [])[1] || '';

// the plan/issue prompt's block for a question about a spec with mockups; '' without mockups
function mockupSection({ folder, question } = {}) {
  const item = itemOf(question);
  const mockups = item ? findMockups(folder, item) : [];
  if (!mockups.length) return '';
  return [
    `The spec docs/work/${item} has mockups: they are the specification of its screens (#670):`,
    ...mockups.map((m) => `- \`${m.file}\` (${m.path})`),
    'Every task that builds or changes a screen names its mockup and embeds it in the issue (an image: `![mock-1.jpg](<url or path>)`), as "matches `mock-1.jpg`: layout, icons, texts, controls, order".',
    'What the issue\'s phase does not do yet stays "visible and disabled, as in the mockup". Requirement numbers alone ("R1, R2") are not accepted for a screen task.',
    'Every mockup in scope lands in an issue; list the ones out of scope as later phases.',
    'A plan answer proposing the spec\'s issues puts them in `spec.issues` ({ title, body }): the engine checks that every mockup in scope is named by one.',
  ].join('\n');
}

// The spec's phases: `## Phases` has one `### <phase>` per issue with its `Mockups: a, b` line;
// `## Later phases` names the mockups out of scope. [{ name, mockups }] and the later ones.
function specPhases(markdown) {
  const phases = [];
  const later = [];
  let section = '';
  let phase = null;
  for (const line of String(markdown || '').split(/\r?\n/)) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) { section = /^later phases$/i.test(h2[1]) ? 'later' : /^phases$/i.test(h2[1]) ? 'phases' : ''; phase = null; continue; }
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3 && section === 'phases') { phase = { name: h3[1], mockups: [] }; phases.push(phase); continue; }
    const named = line.match(/^Mockups:\s*(.+)$/i);
    if (!named) continue;
    const files = named[1].split(',').map((s) => s.trim().replace(/^`|`$/g, '')).filter(Boolean);
    if (section === 'later') later.push(...files);
    else if (phase) phase.mockups.push(...files);
  }
  return { phases, later };
}

// The proposal of a spec's issues with its mockup coverage, for a question naming `docs/work/<item>`
// with a spec: `issues` the model's [{ title, body }], or, simulated (`mock`), one issue per phase of
// the spec. A real answer without issues proposes none: the coverage shows what is missing.
// null when the question names no spec.
function specProposal({ folder, question, issues = null, mock = false } = {}) {
  const item = itemOf(question);
  if (!item || !folder) return null;
  let markdown;
  try { markdown = fs.readFileSync(path.join(folder, 'docs', 'work', item, 'spec.md'), 'utf8'); } catch { return null; }
  const { phases, later } = specPhases(markdown);
  const title = (String(markdown).match(/^#\s+(?:Spec:\s*)?(.+?)\s*$/m) || [])[1] || item;
  const list = Array.isArray(issues) && issues.length
    ? issues.map((i) => ({ title: String(i?.title || ''), body: String(i?.body || '') })).filter((i) => i.title)
    : !mock ? [] : phases.map((p) => ({
      title: `${title}: ${p.name}`,
      body: [`Phase of docs/work/${item}/spec.md.`, '', ...p.mockups.map((m) => `- Matches \`${m}\`: layout, icons, texts, controls, order.`)].join('\n'),
    }));
  return { item, issues: list, coverage: checkMockupCoverage({ mockups: findMockups(folder, item), issues: list, outOfScope: later }) };
}

module.exports = {
  checkMockupCoverage,
  findMockups,
  itemOf,
  MOCKUP_EXTENSIONS,
  mockupSection,
  specPhases,
  specProposal,
};
