// packages/engine/engine/server-commands.js (#853): the pure matcher of commands that never end by
// themselves (dev servers, watchers). The engine guard stops such a command when an agent runs it in
// the foreground; builds and tests end, so they must never match.
// The module is new: it is loaded inside each test so this file loads before it exists.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../engine/server-commands');

const SERVERS = [
  'next dev',
  'npx next dev --turbo',
  'next start -p 3000',
  'pnpm dev',
  'pnpm run dev',
  'npm run dev',
  'npm start',
  'npm run start',
  'yarn dev',
  'yarn start',
  'yarn serve',
  'bun dev',
  'bun run dev',
  'pnpm --filter web dev',
  // pnpm's -w is --workspace-root (no value); npm's -w is --workspace <name>
  'pnpm -w dev',
  'pnpm -w run dev',
  'npm -w web run dev',
  'vite',
  'npx vite --port 5173',
  'uvicorn app.main:app --reload',
  'nodemon server.js',
  'tsc --watch',
  'npx jest --watch',
  'npx vitest -w',
  'rails s',
  'bin/rails s -p 3001',
  'flask run',
  'php artisan serve',
  'python -m http.server 8000',
  'python3 -m http.server',
  'cd apps/web && pnpm dev',
  'pnpm install && pnpm dev',
];

const ENDING = [
  'next build',
  'vite build',
  'npx vite build --mode production',
  'npm test',
  'npm run test',
  'pnpm build',
  'pnpm run build',
  'yarn build',
  'npm ci',
  'pnpm install',
  'node --test test/a.test.js',
  'npx vitest run',
  'npx jest',
  'git status',
  'tsc --noEmit',
  'npm run lint',
  'cat package.json',
  'python -m pytest',
  'flask --version',
  '',
];

test('recognises dev servers and watchers', () => {
  const { isServerCommand } = load();
  for (const command of SERVERS) {
    assert.equal(isServerCommand(command), true, `expected a server/watcher: ${command}`);
  }
});

test('does not match builds, tests, installs and ordinary commands', () => {
  const { isServerCommand } = load();
  for (const command of ENDING) {
    assert.equal(isServerCommand(command), false, `expected a command that ends: ${command}`);
  }
});

test('handles a missing or non-string command without throwing', () => {
  const { isServerCommand } = load();
  assert.equal(isServerCommand(undefined), false);
  assert.equal(isServerCommand(null), false);
  assert.equal(isServerCommand(42), false);
});
