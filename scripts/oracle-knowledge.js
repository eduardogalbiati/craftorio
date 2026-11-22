#!/usr/bin/env node
// Checks or refreshes the hashes of skills/oracle/knowledge.md (#184): the Oracle's digest of the
// skills it knows (backlog-product-owner, run-supervisor, issue-writing, context-economy). Each
// digest section records the sha256 (12 hex) of its source skill's SKILL.md with LF line endings;
// test/oracle/oracle-capable-184.test.js fails when a source skill changed and its digest was not reviewed.
//   node scripts/oracle-knowledge.js           # list each source with its recorded and current hash
//   node scripts/oracle-knowledge.js --write   # after updating a digest's text: record the new hashes
const fs = require('fs');
const path = require('path');
const { digestSources, skillHash } = require('@craftorio/engine/domains/oracle/oracle-knowledge');

const ROOT = path.join(__dirname, '..');
const file = path.join(ROOT, 'skills', 'oracle', 'knowledge.md');
let text = fs.readFileSync(file, 'utf8');
let stale = 0;
for (const { id, hash } of digestSources(text)) {
  const current = skillHash(path.join(ROOT, 'skills'), id);
  const ok = current === hash;
  if (!ok) stale += 1;
  console.log(`${ok ? 'ok   ' : 'STALE'} ${id} recorded ${hash} current ${current}`);
  if (!ok && process.argv.includes('--write')) text = text.replace(`skill: ${id} sha256:${hash}`, `skill: ${id} sha256:${current}`);
}
if (process.argv.includes('--write')) fs.writeFileSync(file, text);
else if (stale) process.exitCode = 1;
