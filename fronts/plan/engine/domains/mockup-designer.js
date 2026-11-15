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
// reviewTurn({ workspace, projectId, slug, axe, projectFolder, model, simulated, runTurn }) → { findings, costUsd,
//   model } (#836 Review this screen, on demand: never called by a designer turn).

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

// #836 Review this screen (D11, on demand only, never on a designer turn): the free findings (kit lint, the
// given axe violations, mockups.reviewScreen) and, real only, ONE fresh read-only Sonnet turn (no session
// kept) that answers more findings (kit conformance, layout) in a ```json block; its cost goes in
// chat/usage.jsonl (agent reviewer). → { findings, costUsd, model }
const REVIEW_RULES = [
  'You review one mockup screen of this project. The current folder is its mockup folder: kit/ (tokens.css,',
  'components.css, kit.json) and screens/<slug>/index.html. Read; never write a file, never run a command.',
  'Check kit conformance (tokens and kit classes, never raw values) and layout (alignment, spacing, overflow,',
  'controls at least 24 x 24 px). Answer ONLY a ```json block: {"findings":[{"kind":"kit"|"layout","rule":"...",',
  '"mid":"<data-mid or empty>","message":"one sentence"}]}. No problem: {"findings":[]}.',
].join('\n');
const REVIEW_KINDS = new Set(['kit', 'axe', 'layout']);

function parseFindings(text) {
  const blocks = [...String(text || '').matchAll(/```json\s*([\s\S]*?)```/g)];
  let doc = null;
  try { doc = JSON.parse(blocks.length ? blocks.at(-1)[1] : String(text || '')); } catch { doc = null; }
  return (Array.isArray(doc?.findings) ? doc.findings : []).filter((f) => f && REVIEW_KINDS.has(f.kind) && f.message).map((f) => ({
    kind: f.kind, rule: String(f.rule || f.kind), ...(f.mid ? { mid: String(f.mid) } : {}), message: String(f.message),
  }));
}

async function reviewTurn({ workspace, projectId, slug, axe = [], projectFolder = null, model = MockupModel.estimateCost('review-screen').model, simulated = false, runTurn = null }) {
  const free = mockups.reviewScreen(workspace, projectId, { slug, axe });
  if (simulated) return { findings: free, costUsd: 0, model: 'simulated' };
  const dir = mockups.ensureProject(workspace, projectId);
  const known = free.length ? `## Already found (do not repeat)\n${JSON.stringify(free)}` : '';
  const prompt = [REVIEW_RULES, `The screen: screens/${slug}/index.html`, known].filter(Boolean).join('\n\n');
  const res = await modelTurn({ dir, slug, prompt, sessionId: null, model, projectFolder, runTurn });
  const costUsd = res.costUsd == null ? null : Number(res.costUsd) || 0;
  try {
    agentsUsage.appendTurn(path.join(dir, 'chat', 'usage.jsonl'), { agent: 'reviewer', projectId, model, tokens: res.usage || {}, costUsd, sessionId: res.providerSessionId || null, startReason: 'first', extra: { slug } });
  } catch (e) { console.error('Mockup review: the turn\'s usage was not recorded:', e.message); }
  return { findings: [...free, ...parseFindings(res.text)], costUsd, model };
}

module.exports = {
  designerTurn,
  FRESH_AFTER_IDLE_MS,
  handoffNote,
  reviewTurn,
};
