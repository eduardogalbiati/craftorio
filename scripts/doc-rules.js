// Rules on hand-written docs (issue #404 moved them out of their tests, so `npm run check` and the
// tests share one source of truth):
//   - the decisions log (#332): docs/agents/decisions.md keeps 3 to 16 dated entries, newest first,
//     each naming its issue(s) and why (test/decisions-log-332.test.js);
//   - the Oracle's capabilities list (#184): the README's "The Oracle" section names the skills it
//     knows and its tools, docs/agents/capabilities.md its tools (test/oracle/oracle-capable-184.test.js).
// Each check returns [{ file, message }], empty when the rule holds.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DECISIONS = 'docs/agents/decisions.md';
const CAPABILITIES = 'docs/agents/capabilities.md';
// An entry starts on a heading, list item or table row whose first text is its ISO date
// (`## 2026-10-11 ...`, `- **2026-10-11**: ...`, `| 2026-10-11 | ...`) and runs to the next one.
const ENTRY = /^\s*(?:#{2,4}\s+|[-*]\s+|\|\s*)[*_]*(\d{4}-\d{2}-\d{2})/;
const MIN_ENTRIES = 3;
const MAX_ENTRIES = 16;
// what the README's Oracle section names besides its knowledge skills (packages/engine/domains/oracle/oracle-knowledge.js)
const README_ORACLE_TOOLS = [
  'issues_search',
  'run_analysis',
];
// the Oracle's tools docs/agents/capabilities.md names
const ORACLE_TOOLS = [
  'checker',
  'issue_view',
  'issues_search',
  'labels',
  'run_analysis',
];

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

// [{ date, text }] of the decisions log, in file order
function decisionEntries(root = ROOT) {
  const out = [];
  for (const line of read(root, DECISIONS).split('\n')) {
    const m = line.match(ENTRY);
    if (m) out.push({ date: m[1], text: line });
    else if (out.length) out[out.length - 1].text += `\n${line}`;
  }
  return out;
}

function checkDecisions(root = ROOT) {
  const list = decisionEntries(root);
  const problems = [];
  const add = (message) => problems.push({ file: DECISIONS, message: `${DECISIONS}: ${message}` });
  if (list.length < MIN_ENTRIES) add(`${list.length} dated entries, at least ${MIN_ENTRIES} expected`);
  if (list.length > MAX_ENTRIES) add(`${list.length} entries: keep the log to about 15 (merge or drop the oldest)`);
  const dates = list.map((e) => e.date);
  const at = dates.findIndex((d, i) => i > 0 && d > dates[i - 1]);
  if (at > 0) add(`the entry of ${dates[at]} comes after the older one of ${dates[at - 1]}: newest first`);
  // a table carries the why in its own column; otherwise each entry says why
  const whyColumn = /^\|.*\bwhy\b.*\|/im.test(read(root, DECISIONS));
  for (const e of list) {
    if (!/#\d+/.test(e.text)) add(`the entry of ${e.date} names no issue (#<number>)`);
    if (!whyColumn && !/\bwhy\b|because/i.test(e.text)) add(`the entry of ${e.date} does not say why`);
  }
  return problems;
}

// the README's "### The Oracle" section, up to the next heading ('' when it has none)
function oracleSection(readme) {
  const start = readme.indexOf('### The Oracle');
  if (start < 0) return '';
  const next = readme.slice(start + 1).search(/\n#{2,3} /);
  return next < 0 ? readme.slice(start) : readme.slice(start, start + 1 + next);
}

function checkOracleCapabilities(root = ROOT) {
  const { KNOWLEDGE_SKILLS } = require(path.join(root, 'packages', 'engine', 'domains', 'oracle', 'oracle-knowledge'));
  const problems = [];
  const section = oracleSection(read(root, 'README.md'));
  if (!section) problems.push({ file: 'README.md', message: 'README.md has no "### The Oracle" section (docs/readme/)' });
  else {
    for (const id of [...KNOWLEDGE_SKILLS, ...README_ORACLE_TOOLS]) {
      if (!section.includes(id)) problems.push({ file: 'README.md', message: `README.md: the Oracle section does not name ${id} (docs/readme/)` });
    }
  }
  const caps = read(root, CAPABILITIES);
  for (const tool of ORACLE_TOOLS) {
    if (!caps.includes(tool)) problems.push({ file: CAPABILITIES, message: `${CAPABILITIES} does not name the Oracle tool ${tool}` });
  }
  return problems;
}

module.exports = {
  checkDecisions,
  checkOracleCapabilities,
  decisionEntries,
  ORACLE_TOOLS,
};
