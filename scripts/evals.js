// Evals of the bundled skills and workflows (#633, spec R9: the Full work model evaluates them, in CI).
//   npm run evals            exit 0 when every eval passes, 1 with a report of the failures
// No model and no network: deterministic checks a change to a skill or a workflow can break.
// - every workflows/*.yaml loads with the engine's loader (packages/engine/engine/run/load.js
//   loadWorkflow: its schema, fragments, field rules and templates) and is named after its file
//   (in any case: release.yaml is "Release");
// - every skills/*/SKILL.md has a frontmatter whose name is its folder and a description;
// - every skill a workflow's agent names literally (no template) is a bundled skill.
// Run by .github/workflows/ci.yml ("Evals (skills and workflows)").

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');

function frontmatter(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  try { return yaml.load(m[1]) || {}; } catch { return null; }
}

function skillEvals(root = ROOT) {
  const dir = path.join(root, 'skills');
  const names = new Set();
  const failures = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name, 'SKILL.md');
    if (!e.isDirectory() || !fs.existsSync(file)) continue;
    names.add(e.name);
    const meta = frontmatter(fs.readFileSync(file, 'utf8'));
    const where = `skills/${e.name}/SKILL.md`;
    if (!meta) { failures.push(`${where}: no frontmatter`); continue; }
    if (String(meta.name || '') !== e.name) failures.push(`${where}: name "${meta.name || ''}" is not its folder "${e.name}"`);
    if (!String(meta.description || '').trim()) failures.push(`${where}: no description`);
  }
  return { names, failures };
}

function workflowEvals(skills, root = ROOT) {
  const { loadWorkflow } = require('../packages/engine/engine/run/load');
  const dir = path.join(root, 'workflows');
  const failures = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.yaml')).sort()) {
    const where = `workflows/${f}`;
    let wf;
    try { wf = loadWorkflow(path.join(dir, f)); } catch (err) { failures.push(`${where}: does not load: ${err.message}`); continue; }
    if (String(wf.metadata?.name || '').toLowerCase() !== f.replace(/\.yaml$/, '')) failures.push(`${where}: metadata.name "${wf.metadata?.name || ''}" is not its file name`);
    for (const [id, agent] of Object.entries(wf.agents || {})) {
      for (const s of Array.isArray(agent?.skills) ? agent.skills : []) {
        const name = String(s);
        if (!name.includes('{') && !skills.has(name)) failures.push(`${where}: agent ${id} names the skill "${name}", not in skills/`);
      }
    }
  }
  return failures;
}

function runEvals(root = ROOT) {
  const skills = skillEvals(root);
  return [...skills.failures, ...workflowEvals(skills.names, root)];
}

if (require.main === module) {
  const failures = runEvals();
  if (failures.length) {
    console.error(`evals: ${failures.length} failed`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('evals: skills and workflows pass');
}

module.exports = {
  runEvals,
  skillEvals,
  workflowEvals,
};
