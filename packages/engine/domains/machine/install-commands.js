// Install commands suggested for the CLIs the app calls (#147): the Usage screen's provider cards,
// Settings › Agents & CLIs and Settings › General › Voice input show them next to a play button that
// runs them in a terminal (the 'command' terminal kind, packages/engine/service/areas/terminals.js, which refuses
// any command that is not suggested here or by packages/engine/domains/usage/actions-usage.js). Per platform; a tool without a
// one-line installer has no command, only the prose of INSTALL_TEXT. Linux has no single package
// manager (#316): gh, git and glab get prose that names the distro package instead of a command.
// macOS (#398): the brew commands only when `brew` resolves; without Homebrew, git installs with
// Apple's Command Line Tools and gh, glab and whisper-cli get the prose of MAC_NO_BREW_TEXT.
// A utility (#401): it never requires the engine. Whether Homebrew is installed comes from the
// callers that resolve commands (`{ brew }`); without it, from the lookup packages/engine/engine/providers.js
// registers when it loads (`setBrewLookup`), else no Homebrew.

let brewLookup = () => false;
// #401: how a call without `brew` learns whether Homebrew is installed
function setBrewLookup(fn) {
  brewLookup = typeof fn === 'function' ? fn : () => false;
}

// `brew`: whether Homebrew is installed (macOS only); looked up when not given.
function installCommands(platform = process.platform, { brew } = {}) {
  const win = platform === 'win32';
  const mac = platform === 'darwin';
  const withBrew = mac && (brew ?? !!brewLookup());
  const brewOr = (cmd, fallback = null) => (withBrew ? cmd : fallback);
  return {
    claude: win ? 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"' : 'curl -fsSL https://claude.ai/install.sh | bash',
    codex: 'npm install -g @openai/codex',
    gh: win ? 'winget install --id GitHub.cli -e' : mac ? brewOr('brew install gh') : null,
    git: win ? 'winget install --id Git.Git -e' : mac ? brewOr('brew install git', 'xcode-select --install') : null,
    glab: win ? 'winget install --id GLab.GLab -e' : mac ? brewOr('brew install glab') : null,
    grok: null,
    'whisper-cli': mac ? brewOr('brew install whisper-cpp') : null,
  };
}

const INSTALL_TEXT = {
  gh: 'install the GitHub CLI with your distribution\'s package manager (e.g. sudo apt install gh, sudo dnf install gh); see https://cli.github.com',
  git: 'install git with your distribution\'s package manager (e.g. sudo apt install git, sudo dnf install git)',
  glab: 'install the GitLab CLI with your distribution\'s package manager or from https://gitlab.com/gitlab-org/cli/-/releases',
  grok: 'install Grok Build from x.ai (it lands in ~/.grok/bin, which must be on the PATH)',
};

// #398: macOS without Homebrew: what the one-click install needs, and the official alternative.
const MAC_NO_BREW_TEXT = {
  gh: 'the one-click install needs Homebrew (https://brew.sh); without it, install the GitHub CLI with the macOS installer from https://cli.github.com',
  glab: 'the one-click install needs Homebrew (https://brew.sh); without it, download the GitLab CLI for macOS from https://gitlab.com/gitlab-org/cli/-/releases',
  'whisper-cli': 'whisper-cli installs with Homebrew: install Homebrew (https://brew.sh), then come back here for the one-click install',
};

// The options for one tool: Homebrew is only looked up for a tool that installs with it (not for
// claude, codex and grok, whose commands packages/engine/domains/usage/usage.js reads when it loads).
const needsBrew = (id) => /\bbrew\b/.test(installCommands('darwin', { brew: true })[id] || '');
const optsFor = (id, opts) => (opts.brew === undefined && !needsBrew(id) ? { brew: false } : opts);

// The command that installs a tool on this platform, or null when there is none.
function installCommand(id, platform = process.platform, opts = {}) {
  return installCommands(platform, optsFor(id, opts))[id] || null;
}

// What to show for a tool that is missing: its install command, else the prose.
function installHint(id, platform = process.platform, opts = {}) {
  return installCommand(id, platform, opts) || (platform === 'darwin' && MAC_NO_BREW_TEXT[id]) || INSTALL_TEXT[id] || null;
}

// The sign-in command of each CLI with an account (#319: the first-run Setup's ▶ Sign in, run in a
// command terminal like the install commands). Claude Code opens its interactive /login; the same
// on every platform.
function signInCommands() {
  return {
    claude: 'claude /login',
    codex: 'codex login',
    gh: 'gh auth login',
    glab: 'glab auth login',
    grok: 'grok login',
  };
}

module.exports = {
  installCommand,
  installCommands,
  installHint,
  setBrewLookup,
  signInCommands,
};
