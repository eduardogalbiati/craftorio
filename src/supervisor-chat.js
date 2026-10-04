// The app-wide Supervisor chat (#28): the person's companion on every screen (the drawer) and on the
// Supervisor page (the whole conversation). One conversation per workspace, resumed turn after turn
// (claude --resume), kept in <workspace>/supervisor/chat.jsonl (messages) and chat.json (the CLI
// session and model); the images attached to questions in attachments/ (#129).
//
// Each question carries the screen the person is on ("Builder, editing workflow X"), so requests need
// not repeat it. The supervisor reads the app's data through its read-only MCP tools
// (src/supervisor-tools.js, served by src/supervisor-mcp.js over src/supervisor-bridge.js) and has no
// built-in tool: no file reads, no commands, so no access to the repositories' code. It never crosses a
// human gate and never prescribes code fixes (it routes them to the workflow's agents).
// `mock` (and MULTIAGENT_SIMULATION_ONLY) answers from the simulated supervisor: no model call, no
// cost, but the same tools, called in-process.
// Live progress (#180, src/chat-progress.js): ask's `onItem` and `signal` stream and stop a question.
// Its inbox (#240, src/agent-inbox.js): handleRequest takes another agent's request (the Oracle's) of
// a kind in REQUEST_KINDS, all mechanical: the code of the app's own buttons, given by the service
// (`perform`), no model call, US$ 0. The request and its result are messages of this chat.
// #241: a kind that starts a run (CLICK_KINDS), or one the Night watch does not allow, is a card here
// that runs on the owner's Do it (actRequest), never in the Oracle's chat.

const fs = require('fs');
const path = require('path');
const agentInbox = require('./agent-inbox');
const { mockSteps, partialText } = require('./chat-progress');

// the kinds another agent may ask the Supervisor for (#240)
const REQUEST_KINDS = [
  'dispatch.restart',
  'run.resume',
  'run.retry',
  'run.stop',
  'skill.restore',
  'workflow.commit',
  'workflow.restore',
];
// #241: the kinds that start a run (a real one costs money): a card in this chat until the owner's click
const CLICK_KINDS = [
  'run.resume',
  'run.retry',
];

const DEFAULT_MODEL = 'claude-opus-5-5';
const MCP_NAME = 'orchestrator';
const TIMEOUT_MS = 10 * 60e3;
// #180: the fake steps a simulated turn streams to the live view before its answer
const MOCK_STEPS = [
  { name: `mcp__${MCP_NAME}__list_runs`, input: { limit: 200 } },
  { name: `mcp__${MCP_NAME}__list_workflows`, input: {} },
  { name: `mcp__${MCP_NAME}__list_projects`, input: {} },
];

const RULES = [
  'You are the Supervisor of the Multiagent Orchestrator, a desktop app that runs multi-agent workflows defined in YAML. You are the person\'s companion on every screen of the app, in a chat.',
  `Read the app's data with your tools (mcp__${MCP_NAME}__*): workflows, projects, runs, skills, agents, usage and analytics. Call them instead of guessing; you have no other tool and no access to the repositories' code.`,
  'Each message starts with "[Screen] ...": what the person is looking at. Use it to resolve "this workflow", "this run", "this range" without asking.',
  'You can explain and recommend; you cannot change anything yet. When the person asks for a change (a workflow, an agent, a skill, a project), say exactly what to change and where in the app to do it.',
  'Never approve, reject or answer a human gate: say that the gate waits for the person and what they should weigh. Never prescribe a code fix: say which step or agent of the workflow should handle it, with the evidence and your hypotheses.',
  'Starting a real run costs the person money: never suggest one without saying so.',
  'Answer briefly, in plain language, in English.',
].join('\n');

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

/** The text sent for one question: the screen first, then the question. */
function questionText(text, screen) {
  const s = String(screen || '').trim();
  return s ? `[Screen] ${s}\n\n${text}` : text;
}

/**
 * The chat of a workspace. `dir()` is the workspace's supervisor folder (read at call time);
 * `tools()` the read-only tools; `bridge` the loopback bridge (src/supervisor-bridge.js);
 * `mcpCommand()` how to start src/supervisor-mcp.js ({ command, args, env }).
 */
function createSupervisorChat({ dir, tools, bridge, mcpCommand, skillsDirs, resolveCommand, refuseReal }) {
  let busy = false;
  const files = () => ({ log: path.join(dir(), 'chat.jsonl'), state: path.join(dir(), 'chat.json') });

  function history() {
    try {
      return fs.readFileSync(files().log, 'utf8').split('\n')
        .map((l) => { try { return l ? JSON.parse(l) : null; } catch { return null; } }).filter(Boolean);
    } catch { return []; }
  }
  function post(message) {
    const m = { ts: new Date().toISOString(), ...message };
    fs.mkdirSync(dir(), { recursive: true });
    fs.appendFileSync(files().log, `${JSON.stringify(m)}\n`);
    return m;
  }
  const state = () => readJson(files().state, {});
  const saveState = (s) => { fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(files().state, JSON.stringify(s, null, 2)); };

  // The simulated supervisor: what the tools see, and the screen it was given.
  async function mockAnswer(screen) {
    const { callTool } = require('./supervisor-tools');
    const count = async (name, pick = (x) => x) => {
      const out = await callTool(tools(), name, {});
      try { return out.isError ? '?' : pick(JSON.parse(out.text)).length; } catch { return '?'; }
    };
    const runs = await callTool(tools(), 'list_runs', { limit: 200 });
    let active = '?';
    let total = '?';
    try { const r = JSON.parse(runs.text); active = r.active.length; total = r.runs.length; } catch { /* counted as unknown */ }
    return [
      'Simulated supervisor: no model was called.',
      screen ? `You are on: ${screen}.` : 'I was not told which screen you are on.',
      `Through my tools I see ${await count('list_workflows')} workflows, ${await count('list_projects')} projects, ${total} runs (${active} in progress), ${await count('list_skills')} skills and ${await count('list_agents')} agents.`,
      'Outside developer mode, the real supervisor reads them and answers (one model call per message).',
    ].join('\n\n');
  }

  // attachments: this question's images (#129), already stored in the chat's attachments/ folder
  async function realTurn(text, model, attachments = [], { onItem = () => {}, signal = null } = {}) {
    refuseReal('the supervisor\'s CLI (claude)');
    const { runTurn } = require('./engine/providers');
    const { render } = require('./engine/workflow');
    const { providerArgs, dedupeFlags } = require('./engine/capabilities');
    const { PROVIDERS } = require('./workflow-builder');
    const { resolveSkill } = require('./skills');
    const provider = Object.values(PROVIDERS).find((p) => p.type === 'claude-code');
    if (!resolveCommand(provider.command)) throw new Error(`The supervisor needs ${provider.command}, which is not installed.`);
    const { url, token } = await bridge.start();
    const mcp = mcpCommand();
    const server = { command: mcp.command, args: mcp.args, env: { ...mcp.env, SUPERVISOR_BRIDGE_URL: url, SUPERVISOR_BRIDGE_TOKEN: token } };
    // isolated, its MCP server only, no built-in tool (no file reads, no commands); with attached
    // images, runTurn offers Read and the attachments folder only (providers.js, #129)
    const extraArgs = dedupeFlags([
      ...providerArgs(provider.type, { caps: null, isolated: true }).args,
      '--mcp-config', JSON.stringify({ mcpServers: { [MCP_NAME]: server } }),
      '--tools', '',
      '--allowedTools', `mcp__${MCP_NAME}`,
    ], provider.args || []);
    const st = state();
    const sessionId = st.model === model ? st.sessionId || null : null;
    let prompt = text;
    if (!sessionId) {
      let method = '';
      try { method = resolveSkill(skillsDirs(), 'run-supervisor').body || ''; } catch { /* the rules suffice */ }
      prompt = [RULES, method && `## How you supervise a run\n${method}`, text].filter(Boolean).join('\n\n');
    }
    fs.mkdirSync(dir(), { recursive: true });
    const res = await runTurn({
      provider, model, providerSessionId: sessionId, prompt, cwd: dir(), extraArgs, timeoutMs: TIMEOUT_MS, render, attachments,
      hint: { stepId: 'supervisor-chat', visit: 1, agent: 'supervisor' }, onItem, signal,
    });
    saveState({ sessionId: res.providerSessionId || sessionId, model });
    return res;
  }

  return {
    history,

    /**
     * { question, screen, mock, model, attachments } → { message, messages } (the answer and the whole
     * conversation). attachments: images for this question only (#129, paths or { path, name }), copied
     * into the chat's attachments/ folder first; the simulated supervisor lists them without opening them.
     * #180: `onItem` gets the turn's items as they arrive (a simulated turn streams fake steps);
     * `signal` stops it: the prose written so far is posted as the answer, marked `stopped`.
     */
    async ask({ question, screen, mock, model, attachments = [], onItem = null, signal = null } = {}) {
      const q = String(question || '').trim();
      if (!q) throw new Error('Type a message for the supervisor.');
      if (busy) throw new Error('The supervisor is still answering the previous message.');
      const { storeAttachments } = require('./engine/providers');
      const images = storeAttachments(attachments, path.join(dir(), 'attachments'));
      busy = true;
      try {
        post({ role: 'user', text: q, screen: String(screen || '').trim() || null, ...(images.length ? { attachments: images } : {}) });
        let message;
        // #180: the prose written so far, kept when the turn fails or is stopped
        const written = [];
        const seen = (it) => { if (it?.kind === 'text') written.push(String(it.text || '')); onItem?.(it); };
        try {
          if (mock) {
            const opened = images.length ? `\n\nAttached images (simulated: not opened): ${images.map((f) => f.name).join(', ')}.` : '';
            const text = `${await mockAnswer(String(screen || '').trim())}${opened}`;
            if (onItem) await mockSteps(seen, { steps: MOCK_STEPS, text, signal });
            message = post({ role: 'supervisor', text, simulated: true, costUsd: 0 });
          } else {
            const m = String(model || state().model || DEFAULT_MODEL);
            const res = await realTurn(questionText(q, screen), m, images, { onItem: seen, signal });
            message = post({ role: 'supervisor', text: String(res.text || '').trim() || '(no answer)', model: m, costUsd: res.costUsd ?? null });
          }
        } catch (e) {
          const partial = partialText(written);
          message = signal?.aborted
            ? post({ role: 'supervisor', text: partial || 'Stopped before answering.', stopped: true })
            : post({ role: 'system', text: `The supervisor could not answer: ${e.message || e}${partial ? `\n\nWritten before the error:\n\n${partial}` : ''}`, error: true });
        }
        return { message, messages: history() };
      } finally {
        busy = false;
      }
    },

    /**
     * Another agent's request (#240): { kind, params, reason, from, ref } → { ok, text, costUsd, error?, pending?, ownerTs }.
     * `perform(kind, params)` runs it with the app's own code (→ { text }); never a model call.
     * #241: `wait`, `check` and `after` as in agent-inbox.js handle (a pending card waits for act()).
     */
    handleRequest(request, { perform, wait, check, after } = {}) {
      return agentInbox.handle(request, { kinds: REQUEST_KINDS, role: 'supervisor', record: post, perform, wait, check, after });
    },

    /** The owner's Do it / Dismiss / Undo on a request card (#241, agent-inbox.js act): { ref, action } → { ok, text, ... }. */
    actRequest(input, { perform, restore, after } = {}) {
      return agentInbox.act(input, { history, role: 'supervisor', record: post, perform, restore, after });
    },

    /** A new conversation: the messages and the CLI session are forgotten. */
    clear() {
      fs.rmSync(files().log, { force: true });
      fs.rmSync(files().state, { force: true });
      return [];
    },
  };
}

module.exports = {
  CLICK_KINDS,
  createSupervisorChat,
  DEFAULT_MODEL,
  questionText,
  REQUEST_KINDS,
  RULES,
};
