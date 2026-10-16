// Running an analysis seed (#360, seeds in src/seeds.js) on a project: one Oracle turn, outside its
// conversation and in its daily budget (src/oracle.js oneTurn / budgetRefusal), runs the seed
// read-only (repo_read, repo_git) and answers { html, model }; or, when the project recorded a tool
// for the seed ("Make it a tool", src/seed-tool-issue.js), that command runs in the project's folder
// instead, with no model cost, and its stdout JSON is the model. Simulated (mock,
// MULTIAGENT_SIMULATION_ONLY): a result page derived from the seed, no model, no cost.
// Every result is scrubbed of token-shaped strings and secret-named keys (src/findings.js) before it
// is written. Results are saved per run as <root>/<project id>/seeds/<seed id>/<stamp>/{result.html,
// model.json, run.json} (root: <workspace>/architecture, next to #356's reports; never under the
// project's own folder). The renderer shows result.html in a sandboxed frame with no network.
// Service: src/service/channels/seeds.js.

'use strict';

const fs = require('fs');
const path = require('path');
const { redact, scrub } = require('./findings');
// The JSON of an answer: the last ```json fence, or the text's outermost object (#356's reader)
const { parseAnswer } = require('./oracle-architecture');

const RESULT_FILE = 'result.html';
const MODEL_FILE = 'model.json';
const RUN_FILE = 'run.json';

const seedRunsDir = (root, projectId, seedId) => path.join(root, path.basename(String(projectId)), 'seeds', path.basename(String(seedId)));
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The prompt of the seed's Oracle turn: the seed verbatim, the project, the read-only rules and the answer's shape. */
function seedPrompt({ project, seed }) {
  return [
    `Run the analysis seed "${seed.id}" on the project "${project.name || project.id}" (projectId "${project.id}", folder ${project.folder}).`,
    'Work read-only: read the repository with your repo_read and repo_git tools (this projectId). Never edit a file, never run a build, a test or a CI job, never cross a human gate. Use only the network reads the seed declares in its needs (the CI\'s recent runs: your ci_runs tool).',
    'Never copy a secret, a token, a password or an environment value into the result.',
    '',
    '<seed>',
    String(seed.body || '').trim(),
    '</seed>',
    '',
    'Answer in the language the Language line names for documents (English when there is none) with one JSON object in a ```json fence: { "html": the result page, "model": the JSON model the seed describes, "report": the seed\'s "tell me" list answered, as Markdown }.',
    'The html is one self-contained page: inline CSS and SVG only, no script, no external URL (it is shown in a frame with no network).',
  ].join('\n');
}

// The simulated result: no model, the seed's own description
function mockResult(project, seed) {
  const meta = seed.meta || {};
  const model = { seed: seed.id, project: project.id, simulated: true, needs: meta.needs || [], produces: meta.produces || [] };
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(seed.id)}</title><style>body{font:13px system-ui,sans-serif;margin:16px;color:#222}h1{font-size:16px}</style></head><body><h1>${escHtml(meta.name || seed.id)}: simulated result</h1><p>${escHtml(meta.summary || '')}</p><p>No model was called (simulation). A real run reads the project read-only and draws the seed's page here.</p></body></html>`;
  return { html, model, report: 'Simulated: no model was called.' };
}

// A tool's model as a page: the JSON, escaped
const toolPage = (seed, model) => `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(seed.id)}</title><style>body{font:13px system-ui,sans-serif;margin:16px}pre{white-space:pre-wrap}</style></head><body><h1>${escHtml(seed.id)}</h1><p>Output of the project's tool (no model cost).</p><pre>${escHtml(JSON.stringify(model, null, 2))}</pre></body></html>`;

// A new folder for the run: its stamp, with -n on a collision
function newRunDir(root, projectId, seedId) {
  const base = seedRunsDir(root, projectId, seedId);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let date = stamp;
  for (let n = 1; fs.existsSync(path.join(base, date)); n++) date = `${stamp}-${n}`;
  return { date, dir: path.join(base, date) };
}

function saveRun(root, project, seed, { html, model, report, meta }) {
  const { date, dir } = newRunDir(root, project.id, seed.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, RESULT_FILE), redact(html));
  fs.writeFileSync(path.join(dir, MODEL_FILE), `${JSON.stringify(scrub(model), null, 2)}\n`);
  const run = { ...meta, date, at: new Date().toISOString(), seed: seed.id, project_id: project.id, report: report ? redact(report) : null };
  fs.writeFileSync(path.join(dir, RUN_FILE), `${JSON.stringify(run, null, 2)}\n`);
  return { ...meta, date, dir };
}

/**
 * Runs a seed: { date, dir, source: 'oracle' | 'tool', costUsd, tokens, simulated }, or { refused }
 * (the Oracle's budget). `oracle`: { oneTurn, budgetRefusal }; `agent`: the Oracle's { model, effort };
 * `tool`: { command } recorded for the seed; `exec(command, { cwd })` → stdout; `head`: the project's
 * commit, kept to count the commits since. Throws on an invalid answer or tool output (nothing saved).
 */
async function runSeed({ root, project, seed, oracle, mock, exec, tool, agent = null, head = null, onItem = null }) {
  const base = { head, simulated: false };
  if (mock) return saveRun(root, project, seed, { ...mockResult(project, seed), meta: { ...base, source: tool?.command ? 'tool' : 'oracle', costUsd: 0, tokens: {}, simulated: true } });
  if (tool && tool.command) {
    const out = await exec(tool.command, { cwd: project.folder });
    let model;
    try { model = JSON.parse(String(out ?? '')); } catch (e) { throw new Error(`The tool's output is not JSON (${e.message}): ${tool.command}`); }
    return saveRun(root, project, seed, { html: toolPage(seed, model), model, meta: { ...base, source: 'tool', command: tool.command, costUsd: 0, tokens: {} } });
  }
  const refused = oracle.budgetRefusal();
  if (refused) return { refused };
  // a fresh session each time: usage.jsonl reads a null startReason as a resumed one (#280)
  const res = await oracle.oneTurn({ prompt: seedPrompt({ project, seed }), model: agent?.model, effort: agent?.effort, onItem, startReason: 'seed' });
  let value;
  try { value = parseAnswer(res.text); } catch (e) { throw new Error(`The Oracle's answer is not a JSON result (${e.message}).`); }
  if (!value || typeof value !== 'object' || typeof value.html !== 'string' || !value.html.trim()) throw new Error('The Oracle\'s answer has no html page.');
  const model = value.model && typeof value.model === 'object' ? value.model : {};
  return saveRun(root, project, seed, { html: value.html, model, report: typeof value.report === 'string' ? value.report : null, meta: { ...base, source: 'oracle', costUsd: res.costUsd ?? null, tokens: res.tokens || {} } });
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** The saved runs of a seed, newest first: { date, source, costUsd, simulated, head }. */
function listSeedRuns(root, projectId, seedId) {
  const dir = seedRunsDir(root, projectId, seedId);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const date of fs.readdirSync(dir)) {
    try {
      const run = readJson(path.join(dir, date, RUN_FILE));
      out.push({ date, at: run.at || null, source: run.source || 'oracle', costUsd: run.costUsd ?? null, simulated: !!run.simulated, head: run.head || null });
    } catch { /* a broken folder is not a run */ }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** One saved run: { html, model, ...its run.json }, or null. */
function readSeedRun(root, projectId, seedId, date) {
  const dir = path.join(seedRunsDir(root, projectId, seedId), path.basename(String(date)));
  if (!fs.existsSync(path.join(dir, RUN_FILE))) return null;
  return { ...readJson(path.join(dir, RUN_FILE)), html: fs.readFileSync(path.join(dir, RESULT_FILE), 'utf8'), model: readJson(path.join(dir, MODEL_FILE)) };
}

module.exports = {
  listSeedRuns,
  readSeedRun,
  runSeed,
  seedPrompt,
  seedRunsDir,
};
