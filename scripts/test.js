// Suíte de testes: unitários (node:test em test/*.test.js) + fluxo completo em modo mock.
// Lista os arquivos explicitamente para funcionar em qualquer versão do Node.
//   npm test

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const run = (args, env = {}) => spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } }).status;

const files = fs.readdirSync(path.join(root, 'test'))
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => path.join('test', f));

console.log(`\n== Testes unitários (${files.length} arquivo(s)) ==`);
if (run(['--test', ...files]) !== 0) process.exit(1);

console.log('\n== Fluxo completo em modo mock ==');
const status = run(['scripts/run.js', '--mock', '--auto-approve', '--task', 'Teste do engine'], { MULTIAGENT_MOCK_DELAY_SCALE: '0.2' });
process.exit(status ?? 1);
