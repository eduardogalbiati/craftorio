// The Product Owner's prioritization of a project's Refactor proposals (#357): one read-only turn
// that orders the open proposals by value against risk and cost, giving each a rank, a one-line
// reason and a complexity from 1 to 5 (PRIORITY_SCHEMA, checked with src/json-schema.js). It reads
// the Danger Zone scores of the Architecture tab (value), the conflict map and its hot spots (risk)
// and the roadmap's unfinished items: a proposal on files such an item will change goes later (#150).
// `mock` (and MULTIAGENT_SIMULATION_ONLY, decided by the service) answers with mockPriority: no model
// call, no cost. Kept out of src/product-owner.js (at its size ceiling): the turn copies callAgent's
// shape and records its usage with the Product Owner's (recordUsage, checkBudget).
// rankProject assembles what the turn reads from the workspace and saves the ranking: the Refactor
// tab (refactor:prioritize) and the Refactor proposals workflow (#378) both rank through it.

'use strict';

const conflictMaps = require('./conflict-map');
const proposalsStore = require('./refactor-proposals');
const roadmaps = require('./roadmap');
const Language = require('./shared/language');
const { validateSchema } = require('./json-schema');
const { filesOf, pathOf } = require('./refactor-cadence');
const { unfinishedItems } = require('./shared/roadmap-model');

const SKILLS = ['backlog-product-owner'];
const STEP_ID = 'product-owner-refactor';
const DEFAULT_COMPLEXITY = 3;

const PRIORITY_SCHEMA = {
  type: 'object',
  required: ['ranking'],
  properties: {
    ranking: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'rank', 'reason', 'complexity'],
        properties: {
          id: { type: 'string', minLength: 1 },
          rank: { type: 'integer', minimum: 1 },
          reason: { type: 'string', minLength: 1 },
          complexity: { type: 'integer', minimum: 1, maximum: 5 },
        },
      },
    },
  },
};

const RULES = `## Prioritize the refactor proposals
Order every open refactor proposal below by value against risk and cost, as in your skill's "Prioritize the refactor proposals":
- value: a higher Danger Zone score (churn x complexity) of its files comes first; a hot spot of the conflict map adds value;
- risk: a proposal on files an unfinished roadmap item will change goes after the others (they would conflict, #150);
- cost: complexity from 1 (a rename, an extraction) to 5 (a split across modules); at equal value the cheaper goes first.
Give each proposal its id, a rank (1 is the first to do, no gaps), a one-line reason in the language the Language line names for step outputs and its complexity. Read the code when a proposal is unclear; never change a file.`;

/** The errors of an answer against PRIORITY_SCHEMA (empty when valid). */
const validatePriority = (answer) => validateSchema(answer, PRIORITY_SCHEMA);

const open = (proposals) => (proposals || []).filter((p) => p && p.status !== 'dismissed');

/** The simulated answer: open proposals by Danger Zone score, the ones on an unfinished item's files last. */
function mockPriority({ proposals, unfinished = [], dangerScores = {} }) {
  const busy = new Set(unfinished.flatMap((x) => (x.files || []).map(pathOf)));
  const scored = open(proposals).map((p, order) => {
    const files = filesOf(p);
    const score = Math.max(0, ...files.map((f) => Number(dangerScores[f]) || 0));
    return { p, order, score, files, late: files.some((f) => busy.has(f)) };
  });
  scored.sort((a, b) => a.late - b.late || b.score - a.score || a.order - b.order);
  return {
    ranking: scored.map(({ p, score, files, late }, i) => ({
      id: p.id, rank: i + 1,
      reason: late ? 'An unfinished roadmap item changes these files: later, to avoid conflicts.'
        : score > 0 ? `Danger Zone score ${score}: the hottest complex code goes first.` : 'Not in the Danger Zone: after the hotter files.',
      complexity: Math.min(5, Math.max(1, files.length || 1)),
    })),
  };
}

/** The answer kept for the open proposals: their ids only, ranks 1..n, the ones left out after the others. */
function normalizeRanking(answer, proposals) {
  const ids = new Set(open(proposals).map((p) => p.id));
  const given = (answer?.ranking || []).filter((r) => ids.has(r.id)).sort((a, b) => a.rank - b.rank);
  const seen = new Set();
  const kept = given.filter((r) => !seen.has(r.id) && seen.add(r.id));
  const missing = [...ids].filter((id) => !seen.has(id)).map((id) => ({ id, reason: 'Not ranked by the Product Owner: after the others.', complexity: DEFAULT_COMPLEXITY }));
  return { ranking: [...kept, ...missing].map((r, i) => ({ id: r.id, rank: i + 1, reason: String(r.reason), complexity: r.complexity })) };
}

// the turn's data: the proposals, their scores, the conflict map's hot spots and the unfinished items
function report({ proposals, unfinished, dangerScores, hotSpots }) {
  const lines = open(proposals).map((p) => {
    const files = filesOf(p);
    return `- id ${p.id}: ${p.title || p.improvement || p.target} (files: ${files.join(', ') || 'none'}; Danger Zone score: ${Math.max(0, ...files.map((f) => Number(dangerScores[f]) || 0))})${p.refactor || p.improvement ? `\n  improvement: ${p.refactor || p.improvement}` : ''}${p.evidence ? `\n  evidence: ${typeof p.evidence === 'string' ? p.evidence : JSON.stringify(p.evidence)}` : ''}`;
  });
  return [
    `## Open refactor proposals\n${lines.join('\n') || '(none)'}`,
    `## Conflict map hot spots\n${(hotSpots || []).map((h) => `- ${h.file}${h.line ? `:${h.line}` : ''} (${h.runs} of ${h.of} runs)`).join('\n') || '(none)'}`,
    `## Unfinished roadmap items\n${(unfinished || []).map((x) => `- #${x.issue}: ${(x.files || []).join(', ') || 'files unknown'}`).join('\n') || '(none)'}`,
  ].join('\n\n');
}

/**
 * The Product Owner's ranking of the open proposals: { ranking, model, costUsd, invalid? }.
 * `mock`: mockPriority. Otherwise one read-only Claude Code turn in `folder`, recorded in the Product
 * Owner's usage; an answer that does not validate is refused with its errors (no ranking saved).
 */
async function prioritize({ proposals, unfinished = [], dangerScores = {}, hotSpots = [], mock, backlogDir, projectId, folder, agent, skillsDirs, resolveCommand, budget, language = null }) {
  if (mock) return { ...mockPriority({ proposals, unfinished, dangerScores }), model: 'simulated', costUsd: 0 };
  const productOwner = require('./product-owner');
  productOwner.checkBudget(budget);
  const res = await runPriorityTurn({ data: report({ proposals, unfinished, dangerScores, hotSpots }), folder, agent, skillsDirs, resolveCommand, language });
  productOwner.recordUsage(backlogDir, { projectId, model: agent.model, tokens: res.usage, costUsd: res.costUsd || 0, sessionId: res.providerSessionId || null });
  const { extractJson } = require('./engine/run/outputs');
  let errs;
  let raw = null;
  try { raw = extractJson(res.text); errs = validatePriority(raw); } catch (e) { errs = [e.message]; }
  if (errs.length) throw new Error(`The Product Owner's ranking could not be read: ${errs.join('; ')}`);
  return { ...normalizeRanking(raw, proposals), model: agent.model, costUsd: res.costUsd || 0 };
}

const numbersOf = (issues) => (issues || []).map((i) => Number(typeof i === 'object' ? i?.number : i)).filter(Boolean);

/** The files each planned issue will change (Map number → files): a refactor's proposal, else the Product Owner's last plan group. */
function plannedFiles({ refactorRoot, backlogDir, projectId }) {
  const out = new Map();
  let messages = [];
  try { messages = require('./product-owner').readConversation(backlogDir, projectId).filter((m) => m.role === 'po' && m.answer); } catch { /* no conversation */ }
  for (const m of messages) for (const g of m.answer?.groups || []) for (const n of g.issues || []) if (g.files?.length) out.set(Number(n), g.files);
  for (const x of proposalsStore.listProposals(refactorRoot, projectId)) if (x.issue) out.set(Number(x.issue), filesOf(x));
  return out;
}

/** A roadmap item with the files its issues will change (`planned`: plannedFiles). */
const withFiles = (item, planned) => ({ ...item, files: numbersOf(item.issues).flatMap((n) => planned.get(n) || []) });

/**
 * The Product Owner's ranking of a project's open proposals, read and saved in the workspace:
 * the proposals (<refactorRoot>), the roadmap's unfinished items with their planned files and the
 * conflict map's hot spots (<backlogDir>), the Danger Zone scores of `model` (the architecture
 * facts, null for none). `mock`, or no open proposal: mockPriority; otherwise `options()` gives the
 * Product Owner's turn. → { list, ranking, costUsd, saved } (saved: saveRanking's answer).
 */
async function rankProject({ refactorRoot, backlogDir, projectId, model, mock, options }) {
  const list = proposalsStore.listProposals(refactorRoot, projectId);
  const planned = plannedFiles({ refactorRoot, backlogDir, projectId });
  const unfinished = unfinishedItems(roadmaps.readRoadmap(backlogDir, projectId)).map((x) => ({ issue: numbersOf(x.issues)[0] || x.number, files: withFiles(x, planned).files }));
  const dangerScores = Object.fromEntries((model?.danger_zone || []).map((r) => [r.file, r.score]));
  const hotSpots = conflictMaps.hotSpots(conflictMaps.readConflictMap(backlogDir, projectId));
  const turn = mock || !open(list).length ? { mock: true } : options();
  const answer = await prioritize({ proposals: list, unfinished, dangerScores, hotSpots, ...turn });
  const errors = validatePriority({ ranking: answer.ranking });
  if (errors.length) throw new Error(`The Product Owner's ranking is not valid: ${errors.join('; ')}`);
  const costUsd = answer.costUsd || 0;
  const saved = proposalsStore.saveRanking(refactorRoot, projectId, { ranking: answer.ranking }, { at: new Date().toISOString(), costUsd });
  return { list, ranking: answer.ranking, costUsd, saved };
}

// One read-only Claude Code turn, as product-owner.js callAgent runs them
async function runPriorityTurn({ data, folder, agent, skillsDirs, resolveCommand, language }) {
  const fs = require('fs');
  const { render } = require('./engine/run/templates');
  const { runTurn } = require('./engine/providers');
  const { resolveSkill, skillPrompt } = require('./skills');
  const { providerArgs, normalize, dedupeFlags } = require('./engine/capabilities');
  const { PROVIDERS } = require('./workflow-builder');
  const provider = PROVIDERS.claude;
  if (!resolveCommand(provider.command)) throw new Error(`The Product Owner needs ${provider.command}, which is not installed.`);
  if (!folder || !fs.existsSync(folder)) throw new Error('The project has no folder on this machine: the Product Owner reads its code there.');
  const skills = SKILLS.map((s) => resolveSkill(skillsDirs, s));
  const readOnly = providerArgs(provider.type, { caps: normalize({ tools: ['read'] }) }).args;
  const extraArgs = dedupeFlags([...readOnly, ...skills.flatMap((skill) => (provider.skill_args || []).map((x) => render(x, { skill_dir: skill.path })))], provider.args || []);
  const prompt = [
    ...skills.map(skillPrompt),
    Language.languageLine({ language }), // #327
    RULES,
    data,
    `\n---\nAt the end of your response you MUST include a \`\`\`json block with an object that validates against this JSON Schema:\n\`\`\`json\n${JSON.stringify(PRIORITY_SCHEMA, null, 2)}\n\`\`\``,
  ].join('\n\n');
  return runTurn({
    provider, model: agent.model, effort: agent.effort && agent.effort !== 'default' ? agent.effort : undefined, prompt, cwd: folder, extraArgs,
    timeoutMs: 15 * 60e3, render, hint: { stepId: STEP_ID, visit: 1, agent: 'product-owner', schema: PRIORITY_SCHEMA },
  });
}

module.exports = {
  mockPriority,
  normalizeRanking,
  plannedFiles,
  prioritize,
  PRIORITY_SCHEMA,
  rankProject,
  validatePriority,
  withFiles,
};
