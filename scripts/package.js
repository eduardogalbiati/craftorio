// Empacota o app para Windows (x64) em dist/.
// O @electron/packager exige Node >= 20. Em Node mais antigo o script se
// relança usando o Node embutido no Electron (ELECTRON_RUN_AS_NODE).
//   node scripts/package.js [pasta-de-saida]   (padrão: dist/)

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

if (+process.versions.node.split('.')[0] < 20 && !process.env.ELECTRON_RUN_AS_NODE) {
  console.log(`Node ${process.versions.node} é antigo para o packager; usando o Node do Electron.`);
  const r = spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  process.exit(r.status ?? 1);
}

(async () => {
  const { packager } = await import('@electron/packager');
  const paths = await packager({
    dir: root,
    name: 'MultiagentOrchestrator',
    platform: 'win32',
    arch: 'x64',
    out: path.resolve(process.argv[2] || path.join(root, 'dist')),
    overwrite: true,
    prune: true,
    tmpdir: false, // evita EPERM ao mover do %TEMP% no Windows
    // .claude/ pode conter worktrees de outras sessões (com node_modules próprios)
    ignore: [/^\/(runs|dist|build|scripts|test|\.github|\.claude)(\/|$)/],
  });
  console.log(`Build gerado em: ${paths.join(', ')}`);
})().catch((e) => {
  console.error('Falha no build:', e.message);
  process.exit(1);
});
