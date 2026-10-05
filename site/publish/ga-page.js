// Adds the GA4 snippet right after <head> of a static page (no events), unless it is there.
const fs = require('fs');
const GA = 'G-KV5SP42JE0';
for (const file of process.argv.slice(2)) {
  let s = fs.readFileSync(file, 'utf8');
  if (s.includes(GA)) { console.log(`${file}: already has it`); continue; }
  const head = s.match(/<head[^>]*>\s*\n?/i);
  if (!head) throw new Error(`${file}: no <head>`);
  s = s.replace(head[0], `${head[0]}<!-- Google Analytics 4 (the whole edugalbs.com site) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  gtag('js', new Date());
  gtag('config', '${GA}');
</script>
`);
  fs.writeFileSync(file, s);
  console.log(`${file}: added`);
}
