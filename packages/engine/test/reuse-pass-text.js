// Helper (no tests at load): where the reuse pass is written and what an agent's skills bring.
// #756: the reuse pass is written once (one section under skills/) and used by both the reviewer's
// code-review skill and the developer's self-review; it may live in code-review/SKILL.md, in a shared
// skill pulled with `uses:`, or in a support file a skill lists. These helpers find it wherever it is.
const fs = require('fs');
const path = require('path');
const { resolveSkill, skillPrompt } = require('../domains/agents/skills');

const ROOT = path.join(__dirname, '..', '..', '..');
const SKILLS = path.join(ROOT, 'skills');
const flat = (s) => s.replace(/\s+/g, ' ');

function mdFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return mdFiles(p);
    return e.name.endsWith('.md') ? [p] : [];
  });
}

// The sections (a heading naming "reuse" up to the next heading) that spell out the reuse pass:
// the search by name, by the literal values it maps and by the rule, for each new mapping table.
function reusePassSections() {
  const found = [];
  for (const file of mdFiles(SKILLS)) {
    const text = fs.readFileSync(file, 'utf8');
    const re = /^(#{1,4}) .*$/gm;
    const heads = [...text.matchAll(re)];
    heads.forEach((h, i) => {
      if (!/reuse/i.test(h[0])) return;
      const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
      const body = text.slice(h.index + h[0].length, end);
      if (/literal values/i.test(body) && /mapping table/i.test(body)) {
        found.push({ file, rel: path.relative(ROOT, file).split(path.sep).join('/'), heading: h[0], body: flat(body).trim() });
      }
    });
  }
  return found;
}

// The skills a list of names brings into a prompt, `uses:` expanded (dependencies first, each once).
function expandSkills(names) {
  const out = [];
  const seen = new Set();
  const visit = (name) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    const skill = resolveSkill([SKILLS], name);
    for (const dep of skill.uses || []) visit(dep);
    out.push(skill);
  };
  for (const n of names) visit(n);
  return out;
}

// The text those skills put in the prompt of `reader` (developer, reviewer...).
function skillsPrompt(names, reader) {
  return expandSkills(names).map((s) => skillPrompt(s, reader)).join('\n');
}

// Whether that prompt carries the reuse pass section: inline, or by the path of the file holding it.
function reaches(prompt, section) {
  if (flat(prompt).includes(section.body.slice(0, 200))) return true;
  if (prompt.includes(section.file)) return true;
  // a skill folder listed by `reads:` (its SKILL.md), or a support file named next to its folder
  const base = path.basename(section.file);
  return prompt.includes(path.dirname(section.file)) && (base === 'SKILL.md' || prompt.includes(base));
}

module.exports = { ROOT, SKILLS, flat, mdFiles, reusePassSections, expandSkills, skillsPrompt, reaches };
