// The project's public page (site/): copies the reader, docs/work/ and CHANGELOG.md into one folder a
// static host serves as is (GitHub Pages, .github/workflows/pages.yml). It renders nothing: the page
// reads the markdown at runtime, so a changed .md needs no rebuild of the reader, only a new copy.
// What it adds is docs/work/index.json, the list of items, because a static host lists no folder.
// An item is a folder of docs/work/ with at least one stage file (intent.md … maintain.md); only
// markdown and images are copied from docs/work/, never a page or a script.
//
//   node scripts/site.js [--out build/site]      npm run site; then: npx serve build/site
//
//   workItems(root)          the item folders of root/docs/work/, sorted
//   buildSite(root, out)     writes the site into out (emptied first); returns { items, files }

const fs = require('fs');
const path = require('path');

const STAGES = ['intent', 'spec', 'plan', 'test', 'deploy', 'maintain'];
const COPIED = /\.(md|png|jpe?g|webp|gif)$/i;
const ITEM = /^[a-z0-9][a-z0-9._-]*$/i;
const ROOT_FILES = ['CHANGELOG.md', 'CHANGELOG.pt-BR.md'];

function workItems(root) {
  const dir = path.join(root, 'docs', 'work');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && ITEM.test(e.name))
    .filter((e) => STAGES.some((s) => fs.existsSync(path.join(dir, e.name, `${s}.md`))))
    .map((e) => e.name)
    .sort();
}

// copies src into dst, keeping only the files `keep` accepts; returns the copied paths, relative to dst
function copyTree(src, dst, keep, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(src, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...copyTree(src, dst, keep, r));
    else if (e.isFile() && keep(e.name)) {
      fs.mkdirSync(path.dirname(path.join(dst, r)), { recursive: true });
      fs.copyFileSync(path.join(src, r), path.join(dst, r));
      out.push(r.split(path.sep).join('/'));
    }
  }
  return out;
}

function buildSite(root, out) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const files = copyTree(path.join(root, 'site'), out, () => true);
  const work = path.join(root, 'docs', 'work');
  if (fs.existsSync(work)) files.push(...copyTree(work, path.join(out, 'docs', 'work'), (name) => COPIED.test(name)).map((f) => `docs/work/${f}`));
  for (const f of ROOT_FILES) {
    if (!fs.existsSync(path.join(root, f))) continue;
    fs.copyFileSync(path.join(root, f), path.join(out, f));
    files.push(f);
  }
  const items = workItems(root);
  fs.mkdirSync(path.join(out, 'docs', 'work'), { recursive: true });
  fs.writeFileSync(path.join(out, 'docs', 'work', 'index.json'), `${JSON.stringify(items, null, 2)}\n`);
  files.push('docs/work/index.json');
  // GitHub Pages runs Jekyll on a branch deploy; the page needs none
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  return { items, files: files.sort() };
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const i = process.argv.indexOf('--out');
  const out = path.resolve(root, i > 0 ? process.argv[i + 1] : path.join('build', 'site'));
  const { items, files } = buildSite(root, out);
  console.log(`site: ${files.length} files, ${items.length} item(s) [${items.join(', ')}] in ${path.relative(root, out) || out}`);
}

module.exports = { buildSite, workItems };
