// Copies the owner's cover page into the site repo as its home (public/home/index.html), with the
// diary link relative so it also works on a local server.
const fs = require('fs');
const path = require('path');
const [src, dest] = process.argv.slice(2);
let s = fs.readFileSync(src, 'utf8');
const from = 'href="https://www.edugalbs.com/fabrica-24x7"';
if (s.split(from).length !== 2) throw new Error('the diary link was not found exactly once');
s = s.replace(from, 'href="/fabrica-24x7"');
// the site's icons (the Saturn favicon), after the title, unless the page already links them
if (!s.includes('/favicon.svg')) {
  const title = s.match(/<title>[^<]*<\/title>/);
  if (!title) throw new Error('no <title> to put the icons after');
  s = s.replace(title[0], `${title[0]}\n<link rel="icon" href="/favicon.ico" sizes="any">\n<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n<link rel="apple-touch-icon" href="/apple-touch-icon.png">`);
}
// Google Analytics 4 (the whole site), and the click on "Entrar no diário" as an event
const GA = 'G-KV5SP42JE0';
if (!s.includes(GA)) {
  const head = s.match(/<head>\s*\n/);
  if (!head) throw new Error('no <head> to put Google Analytics in');
  s = s.replace(head[0], `${head[0]}<!-- Google Analytics 4 (the whole edugalbs.com site) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  gtag('js', new Date());
  gtag('config', '${GA}');
</script>
`);
  if (s.split('</body>').length !== 2) throw new Error('</body> not found once');
  s = s.replace('</body>', `<script>
  // Google Analytics: the visitor leaves the cover for the diary
  document.querySelectorAll('a[href="/fabrica-24x7"]').forEach((a) => a.addEventListener('click', () => {
    window.gtag?.('event', 'diary_enter', { page_path: location.pathname });
  }));
</script>
</body>`);
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, s);
console.log(`ok: ${s.length} chars`);
