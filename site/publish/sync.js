// Copies site/ into the edugalbs repo: the full page at public/<full>/ (with img/) and the 24x7 page
// at public/<diary>/ (no media of its own: it uses the full page's img/). Asset paths become absolute.
// Usage: node sync-site2.js <site dir> <edugalbs public dir> [full=ai-next-level] [diary=fabrica-24x7]
const fs = require('fs');
const path = require('path');
const [src, pub, full = 'ai-next-level', diary = 'fabrica-24x7'] = process.argv.slice(2);

function fresh(dir) { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); }
const refs = (html) => [...html.matchAll(/(?:src|href|poster)="(\/[^"]+)"/g)].map((m) => m[1]);

// the full page
const fullDir = path.join(pub, full);
fresh(path.join(fullDir, 'img'));
for (const f of ['styles.css', 'main.js']) fs.copyFileSync(path.join(src, f), path.join(fullDir, f));
for (const f of fs.readdirSync(path.join(src, 'img'))) fs.copyFileSync(path.join(src, 'img', f), path.join(fullDir, 'img', f));
// the cover's 3D scene and its still
fs.cpSync(path.join(src, 'run-3d'), path.join(fullDir, 'run-3d'), { recursive: true });
const fullHtml = fs.readFileSync(path.join(src, 'index.html'), 'utf8')
  .replace(/(href|src|poster)="(styles\.css|main\.js|img\/|run-3d\/)/g, `$1="/${full}/$2`)
  .replace(/href="24x7\/index\.html"/g, `href="/${diary}"`);
fs.writeFileSync(path.join(fullDir, 'index.html'), fullHtml);

// the 24x7 site: its own build (homes and chapters, both languages)
const diaryDir = path.join(pub, diary);
const { build } = require(path.resolve(src, '24x7', 'build.js'));
const pages = build({ out: diaryDir, base: `/${diary}`, media: `/${full}/img`, full: `/${full}` });
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const diaryHtml = walk(diaryDir).filter((f) => f.endsWith('.html')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
console.log(`24x7 pages: ${pages.join(', ')}`);

// every absolute reference to this site's own files must exist
const missing = [...refs(fullHtml), ...refs(diaryHtml)]
  .filter((r) => r.startsWith(`/${full}/`) || r.startsWith(`/${diary}/`))
  .filter((r) => !fs.existsSync(path.join(pub, r)));
const left = (fullHtml + diaryHtml).match(/(?:src|href|poster)="(?:\.\.\/|img\/|style\.css|styles\.css|main\.js|24x7\/)/g) || [];
const size = (dir, re) => fs.readdirSync(dir).filter((f) => re.test(f)).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
console.log(JSON.stringify({ missing, relativeLeft: left.length, stillsMB: +(size(path.join(fullDir, 'img'), /\.png$/) / 1048576).toFixed(1) }));
