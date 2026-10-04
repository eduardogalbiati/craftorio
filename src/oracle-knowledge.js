// The Oracle's knowledge (#184): besides its own skill, a new Oracle session gets a digest of the
// skills the outside planning session works with (backlog-product-owner, run-supervisor,
// issue-writing, context-economy), kept in skills/oracle/knowledge.md. The whole skills would cost
// ~25k tokens of context on every call; the digest keeps their rules and lessons in a few lines.
// Each section of the digest starts with `<!-- skill: <id> sha256:<12 hex> -->`, the hash of its
// source SKILL.md (LF line endings): a source edited without reviewing its digest fails
// test/oracle-capable-184.test.js; scripts/oracle-knowledge.js lists and refreshes the hashes.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KNOWLEDGE_SKILLS = [
  'backlog-product-owner',
  'context-economy',
  'issue-writing',
  'run-supervisor',
];
const KNOWLEDGE_FILE = 'knowledge.md';
const SOURCE_RE = /<!-- skill: ([a-z0-9-]+) sha256:([0-9a-f]{12}) -->/g;

// sha256 (12 hex) of a skill's SKILL.md with LF line endings; null when the skill is missing
function skillHash(skillsDir, id) {
  try {
    const text = fs.readFileSync(path.join(skillsDir, id, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
    return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
  } catch {
    return null;
  }
}

// the sources a digest records: [{ id, hash }]
function digestSources(text) {
  return [...String(text || '').matchAll(SOURCE_RE)].map((m) => ({ id: m[1], hash: m[2] }));
}

// the digest's text for the session prompt (without the hash comments), from the oracle skill's
// folder (the workspace copy first, then the bundled one); '' when none has it
function knowledgeDigest(oracleSkillDirs) {
  for (const dir of oracleSkillDirs) {
    let text;
    try {
      text = fs.readFileSync(path.join(dir, KNOWLEDGE_FILE), 'utf8');
    } catch {
      continue;
    }
    return text.replace(/\r\n/g, '\n').replace(SOURCE_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  }
  return '';
}

// The owner's standing decisions, written to oracle/memory.md on the first start only (a memory the
// owner saved, even an emptied one, is never written again: src/oracle.js memory()).
const SEED_MEMORY = `${[
  '- Chat replies in the owner\'s language (Portuguese); everything that goes into the product is in English: UI, issues, skills, commits, handoff notes.',
  '- Issues that touch a screen carry UI criteria (what leads, controls, states, screenshots).',
  '- Only the test writer writes tests; the developer never edits the acceptance tests.',
  '- One app per workspace: close the old app before opening a new version on the same workspace.',
  '- A workflow or skill edited in the workspace is a frozen copy: it stops receiving the app\'s updates.',
  '- Real runs cost money: say so with the expected cost, prefer a simulated run to check a workflow.',
  '- Branch + PR, never commit to main; the owner merges and pushes.',
  '- Never cross a human gate.',
].join('\n')}\n`;

// One standing decision per line of a pasted text (e.g. a Claude Code memory index
// "- [Title](file.md) - description"): headings and empty lines dropped, the links to memory files
// replaced by their title and description. → ['- Title: description', ...]
function memoryEntries(pasted) {
  const out = [];
  for (const raw of String(pasted || '').replace(/\r\n/g, '\n').split('\n')) {
    let line = raw.trim().replace(/^([-*+]|\d+[.)])\s+/, '').replace(/^\[[ xX]\]\s+/, '');
    if (!line || /^#/.test(line) || /^-{3,}$/.test(line)) continue;
    const link = line.match(/^\[([^\]]+)\]\([^)]*\)\s*(?:[-–—:]\s*)?(.*)$/);
    if (link) line = link[2] ? `${link[1]}: ${link[2]}` : link[1];
    line = line.replace(/\[([^\]]+)\]\([^)]*\.md\)/g, '$1').trim();
    if (line) out.push(`- ${line}`);
  }
  return out;
}

// `base` (the memory, or the owner's draft) with the pasted decisions it does not hold yet appended
function importMemory(base, pasted) {
  const text = String(base || '').replace(/\r\n/g, '\n');
  const key = (l) => l.replace(/^[-*+]\s+/, '').trim().toLowerCase();
  const seen = new Set(text.split('\n').map(key).filter(Boolean));
  const added = memoryEntries(pasted).filter((l) => !seen.has(key(l)) && seen.add(key(l)));
  if (!added.length) return text;
  return `${text.replace(/\s+$/, '')}${text.trim() ? '\n' : ''}${added.join('\n')}\n`;
}

module.exports = {
  digestSources,
  importMemory,
  KNOWLEDGE_FILE,
  KNOWLEDGE_SKILLS,
  knowledgeDigest,
  memoryEntries,
  SEED_MEMORY,
  skillHash,
};
