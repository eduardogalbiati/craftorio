// The mockup designer's chat turn (#625, D8): ONE agent with a persistent session per screen (project +
// slug), like the Oracle and the supervisor chats (packages/engine/domains/oracle/oracle.js realTurn), not a
// workflow run per message (the mockup-generate run stays for a new screen). The session lives in
// chat/<slug>.session.json ({ sessionId, model, lastAt }); idle for FRESH_AFTER_IDLE_MS (55 min, the
// prompt cache's lifetime) or with another model, the next turn starts a fresh session whose opening
// prompt carries the mockup-design skill and a handoff note (the chat's last messages). cwd = the
// project's mockup folder; the designer only reads (Read, Glob, Grep; the project's folder added
// read-only) and answers its reply plus the whole new screen in one ```html block
// (MockupModel.parseDesignerReply), which the domain commits (one commit per turn, D10) and lints (D11).
// Each turn's cost goes on the assistant's chat entry (costUsd, Q-8) and in chat/usage.jsonl (agent
// designer, packages/engine/domains/agents/agents-usage.js). Simulated (MULTIAGENT_SIMULATION_ONLY): the
// same session bookkeeping, a marked turn and no model call, $0.
// designerTurn({ workspace, projectId, slug, payload, projectFolder, model, skillsDirs, simulated, now, runTurn })
//   → { commit, problems, reply, costUsd, sessionId, startReason, totalUsd }.

const fs = require('fs');
const path = require('path');
const MockupModel = require('@multiagent/shared/mockup-model');
const agentsUsage = require('@multiagent/engine/domains/agents/agents-usage');
const mockups = require('./mockups');

const FRESH_AFTER_IDLE_MS = 55 * 60 * 1000;
const TIMEOUT_MS = 10 * 60 * 1000;
const HANDOFF_MESSAGES = 12;
const DEFAULT_MODEL = MockupModel.estimateCost('chat-edit').model;
const RULES = [
  'You are the designer of this project\'s mockups. The current folder is its mockup folder:',
  'kit/ (tokens.css, components.css, kit.json), screens/<slug>/index.html, refs/ (pasted references).',
  'Read what you need; never write a file and never run a command. Follow the kit: its tokens, never raw values.',
  'Answer with a short reply for the owner, then the WHOLE new screen in one ```html block (keep the',
  'data-mid attributes of the elements you keep). No ```html block means the screen does not change.',
].join('\n');

const sessionFile = (dir, slug) => path.join(dir, 'chat', `${slug}.session.json`);
function readSession(dir, slug) {
  try { return JSON.parse(fs.readFileSync(sessionFile(dir, slug), 'utf8')) || {}; } catch { return {}; }
}
function writeSession(dir, slug, st) {
  fs.writeFileSync(sessionFile(dir, slug), `${JSON.stringify(st, null, 2)}\n`);
}

// a fresh session's handoff note: the chat's last messages, oldest first (the current one excluded)
function handoffNote(history) {
  const lines = history.slice(-HANDOFF_MESSAGES).map((m) => `- ${m.role === 'user' ? 'Owner' : 'Designer'}: ${String(m.text || '').replace(/\s+/g, ' ').slice(0, 400)}`);
  return lines.length ? `## Handoff note (the conversation so far)\n${lines.join('\n')}` : '';
}

function skillBody(skillsDirs) {
  try {
    const { resolveSkill } = require('@multiagent/engine/domains/agents/skills');
    return resolveSkill((skillsDirs || []).filter(Boolean), 'mockup-design').body || '';
  } catch { return ''; }
}

function realRunTurn() {
  return require('@multiagent/engine/engine/providers').runTurn;
}

async function modelTurn({ dir, slug, prompt, sessionId, model, projectFolder, runTurn }) {
  // an injected runTurn (tests) never reaches a CLI
  if (!runTurn) require('@multiagent/engine/engine/simulation').refuseReal('the mockup designer\'s CLI (claude)');
  const { render } = require('@multiagent/engine/engine/workflow');
  const { providerArgs, dedupeFlags } = require('@multiagent/engine/engine/capabilities');
  const { PROVIDERS } = require('@multiagent/engine/domains/workflow/workflow-builder');
  const provider = PROVIDERS.claude;
  const providers = require('@multiagent/engine/engine/providers');
  // #233: a resumed session reports its cumulative cost; the turn costs its own
  if (sessionId) providers.seedClaudeTotal?.(sessionId, agentsUsage.readLines(path.join(dir, 'chat', 'usage.jsonl')).filter((u) => u.sessionId === sessionId).at(-1)?.cumulativeUsd);
  const readOnly = ['--tools', 'Read,Glob,Grep', '--allowedTools', 'Read Glob Grep'];
  const repo = projectFolder && fs.existsSync(projectFolder) ? ['--add-dir', projectFolder] : [];
  const extraArgs = dedupeFlags([...providerArgs(provider.type, { caps: null, isolated: true }).args, ...readOnly, ...repo], provider.args || []);
  return (runTurn || realRunTurn())({
    provider, model, providerSessionId: sessionId, prompt, cwd: dir, extraArgs, timeoutMs: TIMEOUT_MS, render,
    hint: { stepId: 'mockup-designer', visit: 1, agent: 'designer' },
  });
}

// the simulated designer: a marked turn, so each message is one commit (D10), no model call
function simulatedTurn({ html, payload, sessionId }) {
  const marked = html.replace(/(<\/body>|$)/i, `<!-- designer: ${payload.message.replace(/--/g, '- -')} -->$1`);
  const reply = `Simulated designer: noted "${payload.message}"${payload.selection.length ? ` for ${payload.selection.map((s) => s.mid).join(', ')}` : ''}.`;
  return { text: `${reply}\n\n\`\`\`html\n${marked}\n\`\`\``, costUsd: 0, usage: {}, providerSessionId: sessionId || `mock-designer-${Date.now().toString(36)}` };
}

async function designerTurn({ workspace, projectId, slug, payload, projectFolder = null, model = DEFAULT_MODEL, skillsDirs = [], simulated = false, now = Date.now(), runTurn = null }) {
  const dir = mockups.ensureProject(workspace, projectId);
  const history = mockups.readChat(workspace, projectId, slug);
  const st = readSession(dir, slug);
  const idle = st.lastAt != null && now - Number(st.lastAt) > FRESH_AFTER_IDLE_MS;
  const resume = !!st.sessionId && st.model === model && !idle;
  const startReason = resume ? null : !st.sessionId ? 'first' : idle ? 'idle' : 'model-change';
  const message = `## This turn\n${JSON.stringify(payload)}`;
  const prompt = resume ? message : [RULES, skillBody(skillsDirs), handoffNote(history), `The screen: screens/${slug}/index.html`, message].filter(Boolean).join('\n\n');
  mockups.appendChat(workspace, projectId, slug, { role: 'user', text: payload.message, payload });
  const res = simulated
    ? simulatedTurn({ html: mockups.screenHtml(workspace, projectId, slug), payload, sessionId: resume ? st.sessionId : null })
    : await modelTurn({ dir, slug, prompt, sessionId: resume ? st.sessionId : null, model, projectFolder, runTurn });
  const sessionId = res.providerSessionId || (resume ? st.sessionId : null);
  writeSession(dir, slug, { sessionId, model, lastAt: now });
  const costUsd = res.costUsd == null ? null : Number(res.costUsd) || 0;
  try {
    agentsUsage.appendTurn(path.join(dir, 'chat', 'usage.jsonl'), { agent: 'designer', projectId, model, tokens: res.usage || {}, costUsd, sessionId, startReason, extra: { slug, cumulativeUsd: res.cliTotalCostUsd ?? null } });
  } catch (e) { console.error('Mockup designer: the turn\'s usage was not recorded:', e.message); }
  const { reply, html } = MockupModel.parseDesignerReply(res.text);
  const turn = html ? mockups.saveTurn(workspace, projectId, { slug, html, message: payload.message }) : { commit: null, problems: [] };
  const text = reply || (html ? 'Updated the screen.' : 'No change.');
  mockups.appendChat(workspace, projectId, slug, { role: 'assistant', text, costUsd, sessionId, commit: turn.commit });
  const totalUsd = MockupModel.chatCostUsd(mockups.readChat(workspace, projectId, slug));
  return { ...turn, reply: text, costUsd, sessionId, startReason, totalUsd };
}

module.exports = {
  designerTurn,
  FRESH_AFTER_IDLE_MS,
  handoffNote,
};
