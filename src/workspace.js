// Workspace local do app: pasta única onde ficam os logs dos runs (runs/) e os
// repositórios clonados (repos/).
//
// Ordem de resolução:
//   1. variável de ambiente MULTIAGENT_WORKSPACE (testes/CI; não é gravada)
//   2. caminho registrado (Windows: HKCU\Software\MultiagentOrchestrator\WorkspacePath;
//      outros SOs: ~/.multiagent-orchestrator.json)
//   3. pasta padrão ~/multiagent-workspace, se já existir
// Se nada disso existir, cabe à UI perguntar ao usuário (criar a padrão ou escolher outra).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const DEFAULT_NAME = 'multiagent-workspace';
const REG_KEY = 'HKCU\\Software\\MultiagentOrchestrator';
const REG_VALUE = 'WorkspacePath';
const ENV_VAR = 'MULTIAGENT_WORKSPACE';

const defaultWorkspace = (home = os.homedir()) => path.join(home, DEFAULT_NAME);

// ---------------------------------------------------------------------------
// Onde o caminho fica registrado
// ---------------------------------------------------------------------------
const registryStore = {
  describe: `${REG_KEY}\\${REG_VALUE}`,
  get() {
    try {
      // chcp 65001: sem isso o reg.exe devolve acentos na code page OEM.
      const out = execFileSync('cmd', ['/d', '/c', `chcp 65001>nul & reg query ${REG_KEY} /v ${REG_VALUE}`],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
      const m = out.match(new RegExp(`${REG_VALUE}\\s+REG_(?:EXPAND_)?SZ\\s+(.+?)\\s*$`, 'm'));
      return m ? m[1] : null;
    } catch {
      return null; // chave ainda não existe
    }
  },
  set(dir) {
    execFileSync('reg', ['add', REG_KEY, '/v', REG_VALUE, '/t', 'REG_SZ', '/d', dir, '/f'], { windowsHide: true, stdio: 'ignore' });
  },
};

function fileStore(file = path.join(os.homedir(), '.multiagent-orchestrator.json')) {
  return {
    describe: file,
    get() {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')).workspace || null; } catch { return null; }
    },
    set(dir) {
      fs.writeFileSync(file, JSON.stringify({ workspace: dir }, null, 2));
    },
  };
}

const defaultStore = () => (process.platform === 'win32' ? registryStore : fileStore());

// ---------------------------------------------------------------------------
// Resolução
// ---------------------------------------------------------------------------
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/**
 * Descobre o workspace sem interação.
 * @returns {{ dir: string|null, source: 'env'|'registry'|'default'|null, registered: string|null, fallback: string }}
 *   dir null => a UI precisa perguntar. `registered` traz o caminho gravado mesmo
 *   quando ele não existe mais (para avisar o usuário).
 */
function resolveWorkspace({ store = defaultStore(), env = process.env, home = os.homedir() } = {}) {
  const fallback = defaultWorkspace(home);
  if (env[ENV_VAR]) return { dir: path.resolve(env[ENV_VAR]), source: 'env', registered: null, fallback };

  const registered = store.get();
  if (registered && isDir(registered)) return { dir: path.resolve(registered), source: 'registry', registered, fallback };
  if (isDir(fallback)) {
    store.set(fallback); // registra para as próximas aberturas
    return { dir: fallback, source: 'default', registered, fallback };
  }
  return { dir: null, source: null, registered, fallback };
}

/** Cria a estrutura do workspace e registra o caminho. */
function setupWorkspace(dir, { store = defaultStore(), persist = true } = {}) {
  const root = path.resolve(dir);
  const ws = layout(root);
  for (const d of [ws.root, ws.runs, ws.repos]) fs.mkdirSync(d, { recursive: true });
  if (persist) store.set(root);
  return ws;
}

function layout(root) {
  return { root, runs: path.join(root, 'runs'), repos: path.join(root, 'repos') };
}

// ---------------------------------------------------------------------------
// Clonagem de repositórios
// ---------------------------------------------------------------------------
// https://…, ssh://…, git@host:owner/repo(.git)
const isGitUrl = (s) => /^(https?|ssh|git):\/\/\S+$/i.test(s || '') || /^[\w.-]+@[\w.-]+:\S+$/.test(s || '');

function repoNameFromUrl(url) {
  const clean = String(url).trim().replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  const parts = clean.split(/[/:]/).filter(Boolean);
  const name = parts.slice(-2).join('-') || 'repo'; // owner-repo evita colisão entre forks
  return name.replace(/[^\w.-]/g, '_');
}

/**
 * Garante uma cópia local de `url` em <workspace>/repos. Se já foi clonado, só faz fetch.
 * @returns {Promise<{ dir: string, cloned: boolean }>}
 */
function cloneRepo(url, reposDir, { run = execGit } = {}) {
  const dir = path.join(reposDir, repoNameFromUrl(url));
  if (isDir(path.join(dir, '.git'))) return run(['fetch', '--all', '--prune'], dir).then(() => ({ dir, cloned: false }));
  if (isDir(dir) && fs.readdirSync(dir).length) return Promise.reject(new Error(`A pasta ${dir} já existe e não é um repositório git.`));
  fs.mkdirSync(reposDir, { recursive: true });
  return run(['clone', url, dir], reposDir).then(() => ({ dir, cloned: true }));
}

function execGit(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args[0]} falhou: ${(stderr || err.message).trim()}`));
      else resolve(stdout);
    });
  });
}

module.exports = {
  DEFAULT_NAME,
  ENV_VAR,
  defaultWorkspace,
  registryStore,
  fileStore,
  defaultStore,
  resolveWorkspace,
  setupWorkspace,
  layout,
  isGitUrl,
  repoNameFromUrl,
  cloneRepo,
};
