// @ts-check
// Step outputs and their validation (#250, from src/engine/workflow.js): `extractJson` reads the
// ```json block of an answer, `validateSchema` (src/domains/workspace/json-schema.js) checks it against the step's `output` schema (the
// retry prompt `retryPrompt` asks for a fix), `parseTestRequest` reads a ```run-tests block,
// `takeHandoff` splits the answer from its ```handoff note; `stepOutputSchema` gives one agent's
// schema (a fan-out agent's `agent_output_schema` extension, #387); the repeat keys of an output the stall
// check compares (`decisionKey`, `answeredKey`, `repeatKey`).
// Methods: the run's declared `outputs:` (`computeOutputs`, #134), `save_as` files (`saveOutput`),
// `preexisting_failures` reported by a step (#101) and the decision log `decisions.tsv`
// (`recordDecisions`, `logDecisions`).

'use strict';

const fs = require('fs');
const path = require('path');
const { render } = require('./templates');
const { isUnder } = require('../worktree');
const Language = require('@multiagent/shared/language');

// ---------------------------------------------------------------------------
// Structured output
// ---------------------------------------------------------------------------
function extractJson(text) {
  const src = String(text || '');
  const blocks = [...src.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]).reverse();
  const first = src.indexOf('{');
  const last = src.lastIndexOf('}');
  if (first >= 0 && last > first) blocks.push(src.slice(first, last + 1));
  for (const b of blocks) {
    try { return JSON.parse(b); } catch { /* try the next one */ }
  }
  throw new Error('No valid JSON block found in the response.');
}

// A test request at the end of an agent's answer (#212): a ```run-tests block with one test file per
// line (project-relative) or `affected`. → { affected, files } or null. A path with `..`, an absolute
// path or a character a shell would read is dropped (the files go on a command line).
const MAX_TEST_REQUESTS = 3;
function parseTestRequest(text) {
  const m = [...String(text || '').matchAll(/```run-tests[^\n]*\n([\s\S]*?)```/g)].pop();
  if (!m) return null;
  const items = m[1].split('\n').map((l) => l.trim().replace(/^[-*]\s+/, '').replace(/^`|`$/g, '').replace(/\\/g, '/')).filter(Boolean);
  const affected = items.some((l) => /^affected$/i.test(l));
  const files = [...new Set(items.filter((l) => !/^affected$/i.test(l) && /^[\w@][\w./@+-]*$/.test(l) && !l.split('/').includes('..')))];
  return affected || files.length ? { affected, files } : null;
}

// the shared validator (#338, src/domains/workspace/json-schema.js): its paths start at `output`
const { validateSchema } = require('../../domains/workspace/json-schema');

// The schema one agent of a step answers with (#387): the step's `output_schema`, extended for a
// fan-out agent by `agent_output_schema: { <agent>: { properties, required } }` (its properties
// added, its required fields appended). The ui_reviewer of code_review adds its per-screen lines.
function stepOutputSchema(step, agentName) {
  const base = step?.output_schema;
  const extra = agentName ? step?.agent_output_schema?.[agentName] : null;
  if (!base || !extra) return base;
  return {
    ...base,
    ...extra,
    properties: { ...(base.properties || {}), ...(extra.properties || {}) },
    required: [...new Set([...(base.required || []), ...(extra.required || [])])],
  };
}

// What the transitions decide on: enum, boolean and number fields of the schema (not the
// free text, which an LLM rewords on every call). Without a schema, the whole answer.
function decisionKey(output, schema) {
  const props = schema?.properties;
  if (!props || !output || typeof output !== 'object') return JSON.stringify(output ?? null);
  const keys = Object.keys(props).filter((k) => props[k].enum || ['boolean', 'integer', 'number'].includes(props[k].type));
  return JSON.stringify(keys.length ? keys.map((k) => output[k] ?? null) : output);
}

// Output fields that show an author's progress (#121): a new commit, summary or set of changed files is
// never "the same answer", even when the decision fields (committed: true) are.
const PROGRESS_FIELDS = ['commit_sha', 'files_changed', 'notes', 'summary'];

// A list of findings by what identifies each one (its enum, boolean and number fields, and its file),
// not by its description, which an LLM rewords on every call.
function findingsKey(findings, itemSchema) {
  if (!Array.isArray(findings)) return findings ?? null;
  const props = itemSchema?.properties;
  if (!props) return findings;
  const keys = Object.keys(props).filter((k) => k === 'file' || props[k].enum || ['boolean', 'integer', 'number'].includes(props[k].type));
  return keys.length ? findings.map((f) => (f && typeof f === 'object' ? keys.map((k) => f[k] ?? null) : f)) : findings;
}

// The findings a fix round answers, from the output of the step it came from (a review): its
// `findings`, or for a fan-out each agent's `findings` and `ui_findings`. null: none to answer.
function answeredKey(from, output) {
  const props = from.output_schema?.properties || {};
  if (!(from.agents && output?.results && typeof output.results === 'object')) {
    return output?.findings == null ? null : findingsKey(output.findings, props.findings?.items);
  }
  const per = Object.keys(output.results).sort().map((a) => {
    const r = output.results[a] || {};
    return [a, findingsKey(r.findings, props.findings?.items), findingsKey(r.ui_findings, props.ui_findings?.items)];
  });
  return per.some(([, f, u]) => f != null || u != null) ? per : null;
}

// What `same_output` compares between visits of a step: the fields of `stall.same_output_fields` when
// the step declares them; otherwise its decision fields plus its findings (and ui_findings) and, for an author step, its
// progress fields (with the worktree's head when it reports no commit_sha). `answered`: the findings of
// the step it came from (a review), so a fix round answering new findings never repeats the last one.
/**
 * @param {any} step
 * @param {any} output
 * @param {{ head?: () => string | null, answered?: any }} [options]
 */
function repeatKey(step, output, { head, answered } = {}) {
  // a fan-out (agents: [...]) answers { results: { agent: output } }: each agent's answer, keyed alone
  if (step.agents && output?.results && typeof output.results === 'object') {
    const per = Object.keys(output.results).sort().map((a) => [a, repeatKey({ ...step, agents: null }, output.results[a], { head })]);
    return JSON.stringify([per, ...(answered == null ? [] : [{ answered }])]);
  }
  const props = step.output_schema?.properties || {};
  const value = (k) => {
    if (k === 'commit_sha') return output?.commit_sha || head?.() || null;
    if (k === 'findings' || k === 'ui_findings') return findingsKey(output?.[k], props[k]?.items);
    return output?.[k] ?? null;
  };
  let fields = step.stall?.same_output_fields;
  if (!fields) {
    const progress = PROGRESS_FIELDS.filter((k) => props[k]);
    if (progress.length && !progress.includes('commit_sha')) progress.unshift('commit_sha');
    fields = [...progress, ...['findings', 'ui_findings'].filter((k) => props[k])];
  }
  const own = step.stall?.same_output_fields ? [] : [decisionKey(output, step.output_schema)];
  if (!fields.length && answered == null) return own[0];
  return JSON.stringify([...own, ...fields.map(value), ...(answered == null ? [] : [{ answered }])]);
}

// [answer without its last ```handoff block, the note | null]
function takeHandoff(text) {
  const src = String(text || '');
  const all = [...src.matchAll(/```handoff[^\n]*\n([\s\S]*?)```/g)];
  if (!all.length) return [src, null];
  const m = all[all.length - 1];
  const note = m[1].trim();
  return [(src.slice(0, m.index) + src.slice(m.index + m[0].length)).replace(/\n{3,}/g, '\n\n').trim(), note || null];
}

const methods = {
  // The declared `outputs:` filled from the run (#134): each value template rendered over the context
  // plus `run`, parsed as JSON for a type other than string; empty or unparsable → null (logged).
  computeOutputs() {
    const defs = this.wf.outputs;
    if (!defs) return undefined;
    const scope = { ...this.ctx, run: { issues: this.issues || [], local_merge: this.ctx.local_merge || null } };
    const out = {};
    for (const [name, def] of Object.entries(defs)) {
      let value = null;
      try {
        const text = render(def.value, scope).trim();
        const type = def.type || 'string';
        if (text && text !== 'null') {
          value = type === 'string' ? text : JSON.parse(text);
          if (type === 'array' && !Array.isArray(value)) value = [value];
          if ((type === 'number' || type === 'integer') && typeof value !== 'number') value = Number(value);
        }
      } catch (e) {
        this.emitEvent('log', { level: 'warn', message: `Output ${name} could not be filled: ${e.message}` });
        value = null;
      }
      out[name] = value;
    }
    return out;
  },

  // Asks the agent to fix an answer that did not validate. The schema always goes along; an
  // ephemeral or handoff agent answers in a fresh session that has not seen the task nor its previous
  // answer, so those go along too (otherwise it answers "{}" or describes the errors).
  retryPrompt(agentName, prompt, previous, schema, errs) {
    const fix = `Your last response did not validate against the JSON Schema:\n- ${errs.join('\n- ')}\n`
      + `Reply again with only a \`\`\`json block that validates against this schema, keeping the content of your answer, ${Language.retryLanguage(this.agentsLanguageCode())}:\n`
      + `\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``;
    const def = { ...(this.wf.defaults || {}), ...this.wf.agents[agentName] };
    if ((def.session || 'persistent') === 'persistent') return fix;
    return `${prompt}\n\n---\nYou already answered this task:\n<previous_answer>\n${String(previous).slice(-20000)}\n</previous_answer>\n\n${fix}`;
  },

  // `save_as`: writes the agent's response to a file (a path or a list;
  // templates have access to `agent`). Relative paths go in the run folder.
  // An entry can also be `{ path, content }`: `content` is a template with the step's `output`,
  // e.g. { path: document.md, content: "{{ output.document }}" } saves one field of a JSON answer.
  // #473 (SEC-8): the target's real path (links resolved) must stay under the run folder, the run's
  // worktree or the project folder; anything else is refused with a `log` event and fails the step.
  saveOutput(step, scope, text, output) {
    for (const t of step.save_as ? [step.save_as].flat() : []) {
      const rel = render(typeof t === 'object' ? t.path : t, scope).trim();
      if (!rel) continue;
      const content = typeof t === 'object' && t.content != null ? render(t.content, { ...scope, output }) : text;
      const file = path.resolve(this.runDir, rel);
      if (!this.saveAsAllowed(file)) {
        const reason = `save_as refused: ${file} is outside the run folder, the run's worktree and the project folder`;
        this.emitEvent('log', { level: 'error', step_id: step.id, message: reason });
        throw new Error(`Step "${step.id}": ${reason}`);
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, String(content ?? ''));
      this.emitEvent('file.saved', { step_id: step.id, agent: scope.agent, path: file });
    }
  },

  // #473: true when `file` (real path of its deepest existing parent) is under one of the roots
  // save_as may write to: the run folder, the worktree (and the base worktree), the project folder
  saveAsAllowed(file) {
    const roots = [this.runDir, this.ctx.worktree_dir, this.ctx.base_worktree_dir, this.worktree?.repo,
      this.ctx.inputs?.project_path, this.ctx.inputs?.repo_path].filter((r) => typeof r === 'string' && r);
    return roots.some((root) => isUnder(root, file));
  },

  // A step's output may list `preexisting_failures` ([{ test, file, reason }]): tests that also fail
  // on the base, so they are not this run's to fix (#101). They don't block the step; the owner gets
  // them in the run (a warning in the log and the run chat) and in summary.preexisting_failures.
  notePreexistingFailures(stepId, output) {
    const list = Array.isArray(output?.preexisting_failures) ? output.preexisting_failures.filter((f) => f && typeof f === 'object') : [];
    if (!list.length) return;
    const known = new Set(this.preexisting.map((f) => `${f.file}\n${f.test}`));
    const fresh = list.filter((f) => !known.has(`${f.file}\n${f.test}`)).map((f) => ({ step: stepId, test: String(f.test ?? ''), file: String(f.file ?? ''), reason: String(f.reason ?? '') }));
    if (!fresh.length) return;
    this.preexisting.push(...fresh);
    this.emitEvent('log', {
      level: 'warn', kind: 'preexisting_failures', step_id: stepId, failures: fresh,
      message: `${stepId}: ${fresh.length} test${fresh.length === 1 ? '' : 's'} also failing on the base, not chased in this run (worth a follow-up issue): ${fresh.map((f) => `${f.test || '?'} (${f.file || '?'})`).join(' · ')}`,
    });
  },

  // Decision log (decision-log skill): agents end their answer with a ```decisions block of
  // "phase | decision | why | evidence | result" lines; the engine appends them, stamped with
  // time, agent and step, to <run>/decisions.tsv. Works the same for every provider and needs
  // no write access outside the repository.
  recordDecisions(agentName, stepId, text) {
    const rows = [...String(text || '').matchAll(/```decisions[^\n]*\n([\s\S]*?)```/g)]
      .flatMap((m) => m[1].split('\n'))
      .map((l) => l.trim().replace(/^[-*]\s+/, ''))
      .filter(Boolean)
      .map((l) => (l.includes('\t') ? l.split('\t') : l.split('|')));
    this.logDecisions(agentName, stepId, rows);
  },

  // Appends rows of [phase, decision, why, evidence, result] to decisions.tsv (also used by the
  // engine itself, as agent "orchestrator", for decisions like stopping a blocked /loop).
  logDecisions(agentName, stepId, rows) {
    rows = rows.map((r) => r.map((c) => String(c).trim().replace(/\s+/g, ' ')));
    if (!rows.length) return;
    const file = path.join(this.runDir, 'decisions.tsv');
    fs.mkdirSync(this.runDir, { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, 'ts\tagent\tstep\tphase\tdecision\twhy\tevidence\tresult\n');
    const ts = new Date().toISOString();
    fs.appendFileSync(file, rows.map((c) => [ts, agentName, stepId, ...[...c, '', '', '', '', ''].slice(0, 5)].join('\t')).join('\n') + '\n');
    this.emitEvent('decision.logged', { agent: agentName, step_id: stepId, count: rows.length, path: file });
  },
};

module.exports = {
  answeredKey,
  decisionKey,
  extractJson,
  MAX_TEST_REQUESTS,
  methods,
  parseTestRequest,
  repeatKey,
  stepOutputSchema,
  takeHandoff,
  validateSchema,
};
