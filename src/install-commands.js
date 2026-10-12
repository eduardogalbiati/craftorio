// Install commands suggested for the CLIs the app calls (#147): the Usage screen's provider cards,
// Settings › Agents & CLIs and Settings › General › Voice input show them next to a play button that
// runs them in a terminal (the 'command' terminal kind, src/service/areas/terminals.js, which refuses
// any command that is not suggested here or by src/actions-usage.js). Per platform; a tool without a
// one-line installer has no command, only the prose of INSTALL_TEXT. Linux has no single package
// manager (#316): gh, git and glab get prose that names the distro package instead of a command.

function installCommands(platform = process.platform) {
  const win = platform === 'win32';
  const mac = platform === 'darwin';
  return {
    claude: win ? 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"' : 'curl -fsSL https://claude.ai/install.sh | bash',
    codex: 'npm install -g @openai/codex',
    gh: win ? 'winget install --id GitHub.cli -e' : mac ? 'brew install gh' : null,
    git: win ? 'winget install --id Git.Git -e' : mac ? 'brew install git' : null,
    glab: win ? 'winget install --id GLab.GLab -e' : mac ? 'brew install glab' : null,
    grok: null,
    'whisper-cli': mac ? 'brew install whisper-cpp' : null,
  };
}

const INSTALL_TEXT = {
  gh: 'install the GitHub CLI with your distribution\'s package manager (e.g. sudo apt install gh, sudo dnf install gh); see https://cli.github.com',
  git: 'install git with your distribution\'s package manager (e.g. sudo apt install git, sudo dnf install git)',
  glab: 'install the GitLab CLI with your distribution\'s package manager or from https://gitlab.com/gitlab-org/cli/-/releases',
  grok: 'install Grok Build from x.ai (it lands in ~/.grok/bin, which must be on the PATH)',
};

// The command that installs a tool on this platform, or null when there is none.
function installCommand(id, platform = process.platform) {
  return installCommands(platform)[id] || null;
}

// What to show for a tool that is missing: its install command, else the prose.
function installHint(id, platform = process.platform) {
  return installCommand(id, platform) || INSTALL_TEXT[id] || null;
}

module.exports = {
  installCommand,
  installCommands,
  installHint,
};
