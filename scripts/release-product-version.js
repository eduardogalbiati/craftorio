// The version command of one product (#46, .craftorio/project.yaml `version_command`): the release run
// calls it before its suites and commits what it wrote. Changesets bumps the chosen product only: the
// app is its `fixed` group (.changeset/config.json; the root package.json follows,
// release-version-sync.js), the engine is @craftorio/engine alone. The changesets of other packages are
// set aside while Changesets runs; one about the product and other packages is split: the product's part
// is consumed, the rest stays in the same file for the other releases. Then package-lock.json takes the
// versions. A failure leaves the changesets as they were.
//   node scripts/release-product-version.js app|engine
//   splitChangeset(text, names) → { own, rest }: the changeset's text for those packages and for the
//   others, null when it names none of them
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PRODUCTS } = require('./release-tags');
const { syncAppVersion } = require('./release-version-sync');

const ROOT = path.join(__dirname, '..');
const CHANGESETS = path.join(ROOT, '.changeset');
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(ROOT, ...parts), 'utf8'));

function splitChangeset(text, names) {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---[\s\S]*)$/.exec(text);
  if (!m) return { own: null, rest: text };
  const lines = m[2].split(/\r?\n/).filter((l) => l.trim());
  const mine = lines.filter((l) => names.includes(/^\s*(['"]?)(.+?)\1\s*:/.exec(l)?.[2]));
  const others = lines.filter((l) => !mine.includes(l));
  const part = (list) => (list.length ? `${m[1]}${list.join('\n')}${m[3]}` : null);
  return { own: part(mine), rest: part(others) };
}

// the packages of a product: the fixed group its folder's package is in, or that package alone
function productPackages(folder) {
  const { name } = readJson(folder, 'package.json');
  return readJson('.changeset', 'config.json').fixed.find((group) => group.includes(name)) || [name];
}

// every workspace's folder in package-lock.json, and the root (''): the version of its package.json
function syncLockfile() {
  const lock = readJson('package-lock.json');
  for (const [folder, entry] of Object.entries(lock.packages)) {
    if (folder.includes('node_modules') || !fs.existsSync(path.join(ROOT, folder, 'package.json'))) continue;
    const { version } = readJson(folder, 'package.json');
    if (version) entry.version = version;
    if (version && !folder) lock.version = version;
  }
  fs.writeFileSync(path.join(ROOT, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
}

function main(product) {
  const folder = Object.hasOwn(PRODUCTS, product || '') ? PRODUCTS[product] : null;
  if (!folder) throw new Error(`Which product: ${Object.keys(PRODUCTS).join(' or ')}?`);
  const names = productPackages(folder);
  const files = fs.readdirSync(CHANGESETS).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => {
    const file = path.join(CHANGESETS, f);
    const text = fs.readFileSync(file, 'utf8');
    return { file, text, ...splitChangeset(text, names) };
  });
  for (const c of files) {
    if (c.own) fs.writeFileSync(c.file, c.own);
    else fs.rmSync(c.file);
  }
  try {
    execFileSync(process.execPath, [require.resolve('@changesets/cli/bin.js'), 'version'], { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    for (const c of files) fs.writeFileSync(c.file, c.text);
    throw e;
  }
  for (const c of files) if (c.rest) fs.writeFileSync(c.file, c.rest);
  if (product === 'app') syncAppVersion(ROOT);
  syncLockfile();
  console.log(`${product} version: ${readJson(folder, 'package.json').version}`);
}

if (require.main === module) main(process.argv[2]);

module.exports = { splitChangeset };
