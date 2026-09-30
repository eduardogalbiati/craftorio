// Shared name lists written one item per line, sorted (issue #77): `module.exports = { … }` and
// destructured requires (`const { a, b } = require('…')`). Written on one line, two runs that each
// add a name conflict on that line; one name per line with a trailing comma, sorted so additions
// spread out, lets git merge both. Short lists (up to MAX_INLINE names that fit in MAX_LINE
// characters) may stay inline.
//
//   npm run lint:lists            report, exit 1 when a list breaks the rule
//   npm run lint:lists -- --fix   rewrite them (behaviour-free: only whitespace and order change)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['src', 'scripts'];
const MAX_INLINE = 3;
const MAX_LINE = 100;
// `module.exports = { … };` and `const { … } = require('…');` on one line
const INLINE = /^(\s*)(module\.exports = |const )\{ ([^{}]*) \}( = require\([^)]*\))?;\s*$/;
const MULTI_START = /^(\s*)module\.exports = \{\s*$/;

const nameOf = (item) => item.trim().split(/[:\s]/)[0];
const sorted = (items) => [...items].sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'en', { sensitivity: 'base' }));
// only plain names and `key: name` / `name: alias` items are rewritten (no calls or literals)
const simple = (item) => /^[\w$]+(\s*:\s*[\w$.]+)?$/.test(item.trim());

function listFiles(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return listFiles(rel);
    return e.name.endsWith('.js') ? [rel] : [];
  });
}

// { problems: [{ line, message }], fixed: text }
function lintText(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const out = [];
  const problems = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = INLINE.exec(line);
    if (m && (m[2] === 'module.exports = ' || m[4])) {
      const items = m[3].split(',').map((s) => s.trim()).filter(Boolean);
      if (items.length > MAX_INLINE || line.length > MAX_LINE) {
        problems.push({ line: i + 1, message: `${items.length} names on one line: one per line, sorted` });
        if (items.every(simple)) {
          out.push(`${m[1]}${m[2]}{`, ...sorted(items).map((it) => `${m[1]}  ${it},`), `${m[1]}}${m[4] || ''};`);
          continue;
        }
      }
    }
    const s = MULTI_START.exec(line);
    if (s) {
      let j = i + 1;
      while (j < lines.length && !/^\s*\};?\s*$/.test(lines[j])) j++;
      const items = lines.slice(i + 1, j).map((l) => l.trim().replace(/,$/, '')).filter(Boolean);
      const oneEach = lines.slice(i + 1, j).every((l) => !l.trim() || simple(l.trim().replace(/,$/, '')));
      if (oneEach && items.join('\n') !== sorted(items).join('\n')) {
        problems.push({ line: i + 1, message: 'module.exports not sorted' });
        out.push(line, ...sorted(items).map((it) => `${s[1]}  ${it},`), lines[j]);
        i = j;
        continue;
      }
    }
    out.push(line);
  }
  return { problems, fixed: out.join(eol) };
}

function main(argv = process.argv.slice(2)) {
  const fix = argv.includes('--fix');
  let count = 0;
  for (const rel of DIRS.flatMap(listFiles).sort()) {
    const file = path.join(ROOT, rel);
    const text = fs.readFileSync(file, 'utf8');
    const { problems, fixed } = lintText(text);
    if (!problems.length) continue;
    count += problems.length;
    for (const p of problems) console.log(`${rel.split(path.sep).join('/')}:${p.line}: ${p.message}${fix ? ' (fixed)' : ''}`);
    if (fix && fixed !== text) fs.writeFileSync(file, fixed);
  }
  return count && !fix ? 1 : 0;
}

if (require.main === module) process.exit(main());

module.exports = {
  lintText,
  main,
};
