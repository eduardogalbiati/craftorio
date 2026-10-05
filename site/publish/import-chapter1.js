// Brings the posts session's chapter 1 texts (PT with its chart on top, EN as written) and its image
// into site/24x7. The chapter list (chapters.json) is left as it is.
const fs = require('fs');
const path = require('path');
const mk = 'C:/Users/Eduardo/Desktop/multiagent/.claude/worktrees/observabilidade-monitoramento-local-ef5266/marketing';
const site = 'site/24x7';
const read = (f) => fs.readFileSync(path.join(mk, f), 'utf8').replace(/\r\n/g, '\n');
const img = '![Mensagens de IA por hora em quatro dias: a partir do dia 1, às 17h, os agentes disparados pela ferramenta passam a trabalhar mais do que eu usando a IA direto, inclusive nas noites]({{base}}/media/capitulo-01.png)\n\n';
fs.writeFileSync(path.join(site, 'posts/01.pt.md'), img + read('capitulo-01.pt.md'));
fs.writeFileSync(path.join(site, 'posts/01.en.md'), read('capitulo-01.en.md'));
fs.copyFileSync(path.join(mk, 'intro-post-imagem.png'), path.join(site, 'media/capitulo-01.png'));
console.log('ok');
