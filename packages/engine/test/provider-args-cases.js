// The command lines the engine builds for every provider × capability set × session mode (#348),
// through the public seams that stay after the provider registry: capabilities.providerArgs (the
// isolation flags) and providers.cliInvocation (the workflow's provider definition, effort, resume,
// images). test/provider-args-snapshot-348.test.js compares them with the snapshot recorded before
// the registry (test/fixtures/provider-args-348.json). Helper module: no test() at load.
const path = require('path');

// The provider definitions of the bundled workflows (workflows/writer-reviewer.yaml), inline so the
// snapshot does not move when a workflow is edited.
const PROVIDERS = {
  claude: { type: 'claude-code', command: 'claude', args: ['-p', '--output-format', 'stream-json', '--verbose', '--model', '{{ model }}'], effort_args: ['--effort', '{{ effort }}'], resume_args: ['--resume', '{{ session_id }}'], skill_args: ['--add-dir', '{{ skill_dir }}'] },
  codex: { type: 'codex-cli', command: 'codex', args: ['exec', '--json', '--skip-git-repo-check', '-m', '{{ model }}'], effort_args: ['-c', 'model_reasoning_effort={{ effort }}'], resume_args: ['resume', '{{ session_id }}'], stdin_arg: '-' },
  grok: { type: 'grok-cli', command: 'grok', args: ['--output-format', 'streaming-json', '-m', '{{ model }}'], effort_args: ['--reasoning-effort', '{{ effort }}'], resume_args: ['--resume', '{{ session_id }}'], prompt_file_arg: ['--prompt-file', '{{ prompt_file }}'] },
};
const MODELS = { claude: 'claude-opus-5-5', codex: 'gpt-6-luna', grok: 'grok-4.7' };

// Capability sets used by today's tests (test/capabilities.test.js and the bundled agents).
const CAPS = {
  'cli-args-only': { caps: null },
  'not-isolated': { caps: null, isolated: false },
  'read': { caps: { tools: ['read'] } },
  'read-web': { caps: { tools: ['read'], web: true } },
  'read-git': { caps: { tools: ['read', 'bash:git'] } },
  'read-bash': { caps: { tools: ['read', 'bash'] } },
  'write-web': { caps: { tools: ['read', 'write'], web: true } },
  'edit-bash-npm-deny': { caps: { tools: ['read', 'edit', 'bash:npm'] }, denyCommands: ['npm ci'], denyEdits: ['test/**'] },
  'subagents': { caps: { tools: ['read'], subagents: true } },
  'mcp': { caps: { tools: ['read'], mcp: ['docs'] }, mcpServers: { docs: { command: 'npx', args: ['-y', 'docs-mcp'] }, other: { url: 'https://x' } } },
};

const IMG_DIR = path.join(__dirname, 'fixtures', 'images-348');
const MODES = {
  'new': {},
  'effort': { effort: 'high' },
  'resume': { providerSessionId: 'sess-123' },
  'resume-effort': { providerSessionId: 'sess-123', effort: 'low' },
  'images': { attachments: [{ name: 'a.png', path: path.join(IMG_DIR, 'a.png') }, { name: 'b.jpg', path: path.join(IMG_DIR, 'b.jpg') }] },
};

const render = (s, vars) => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
// machine-dependent parts of a command line, replaced by placeholders
const portable = (s, promptFile) => {
  let out = String(s);
  if (promptFile) out = out.split(promptFile).join('<PROMPT_FILE>');
  return out.split(IMG_DIR).join('<IMG_DIR>').replace(/\\/g, '/');
};

/** { '<provider>|<caps>|<mode>': { command, args, notes, prompt } } for every combination. */
function buildCases() {
  const caps = require('../engine/capabilities');
  const { cliInvocation } = require('../engine/providers');
  const out = {};
  for (const [name, provider] of Object.entries(PROVIDERS)) {
    for (const [capName, capOpts] of Object.entries(CAPS)) {
      const opts = { ...capOpts, caps: capOpts.caps && caps.normalize(capOpts.caps) };
      const { args: extraArgs, notes } = caps.providerArgs(provider.type, opts);
      for (const [modeName, mode] of Object.entries(MODES)) {
        const inv = cliInvocation({ provider, model: MODELS[name], prompt: 'Do the task.', extraArgs, render, ...mode });
        out[`${name}|${capName}|${modeName}`] = {
          command: provider.command,
          args: inv.args.map((a) => portable(a, inv.promptFile)),
          notes: (notes || []).map((n) => portable(n)),
          prompt: portable(inv.prompt),
        };
      }
    }
  }
  // the simulated provider builds no CLI flags
  for (const [capName, capOpts] of Object.entries(CAPS)) {
    const opts = { ...capOpts, caps: capOpts.caps && caps.normalize(capOpts.caps) };
    const { args, notes } = caps.providerArgs('mock', opts);
    out[`mock|${capName}|new`] = { command: null, args, notes: (notes || []).map((n) => portable(n)), prompt: null };
  }
  return out;
}

module.exports = { buildCases };
