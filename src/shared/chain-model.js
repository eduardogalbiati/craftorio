// Workflow chaining (#134): what happens with a run's result when it finishes, its `then`. Pure (no
// DOM, no files): the service (src/service/areas/chain.js) acts with it, the Start drawer, the
// Backlog's Assign dialog and the roadmap item editor (chain-picker.js) build it, the run lists
// draw its badges, and it loads in node for tests.
//
// A `then` is one of
//   { action: 'workflow', workflow: '<file>', map: { <next input>: <source> }, inputs: { <next input>: value } }
//   { action: 'product_owner' }                 the PO places the produced issues in the roadmap (planned)
//   { action: 'queue', workflow: '<file>', inputs } the produced issues are queued (the Backlog's Assign)
// A source is the name of one of the previous run's declared `outputs:`, or RUN_SOURCE (the previous
// run itself, for a `type: run` input). Nothing (`action: 'none'`, or no then) is null.
// A saved pipeline (#135, src/domains/workflow/pipelines.js) is the same chain, longer: a `workflow` then carries the
// rest in its own `then`, and each then of a pipeline its `pipeline: { id, file, name, stage, stages }`
// (`stage`: the index of the stage it starts; `id`: the pipeline run's, its first run's id). The runs
// it starts get it in `from.pipeline`.
// Any load order: read only when a screen draws or an event comes in.
(function (root) {
  const ACTIONS = ['none', 'workflow', 'product_owner', 'queue'];
  const ACTION_LABELS = {
    none: 'Nothing',
    product_owner: 'Ask the Product Owner to place it in the roadmap',
    queue: 'Queue the issues (Backlog)',
    workflow: 'Start a workflow with it',
  };
  const RUN_SOURCE = '@run';
  // inputs a next run takes from the previous run's own inputs when it has one with the same name
  const CARRIED = /path|dir|branch|language|platform/i;
  // inputs that take the previous run's text result when no output has their name
  const TEXT_INPUTS = ['task', 'prompt', 'request'];
  const TEXT_SOURCES = ['document', 'issues', 'issue', 'findings'];

  // the most stages a chain carries (a pipeline nests one then per stage)
  const MAX_DEPTH = 20;

  const plain = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const fileOf = (w) => String(w || '').split(/[\\/]/).pop();

  /** A then's or a run's pipeline ({ id, file, name, stage, stages }), or null when it has none. */
  function normalizePipeline(p) {
    if (!plain(p) || !p.file) return null;
    const out = { file: fileOf(p.file), name: String(p.name || fileOf(p.file)), stage: Math.max(0, Number(p.stage) || 0), stages: Math.max(0, Number(p.stages) || 0) };
    return p.id ? { id: String(p.id), ...out } : out;
  }

  /** A then as given (UI, YAML gate choice, API) → its normalized form, or null for nothing. Throws on a bad one. */
  function normalizeThen(then, depth = 0) {
    if (then == null || then === '' || then === 'none') return null;
    if (!plain(then)) throw new Error('then must be an object with an action.');
    if (depth >= MAX_DEPTH) throw new Error(`A chain carries at most ${MAX_DEPTH} stages.`);
    const action = then.action || 'none';
    if (!ACTIONS.includes(action)) throw new Error(`then.action must be one of ${ACTIONS.join(', ')}.`);
    if (action === 'none') return null;
    const pipeline = normalizePipeline(then.pipeline);
    const withPipeline = (t) => (pipeline ? { ...t, pipeline } : t);
    if (action === 'product_owner') return withPipeline({ action });
    const workflow = fileOf(then.workflow);
    if (!workflow) throw new Error(`then: "${action}" needs a workflow.`);
    const inputs = plain(then.inputs) ? { ...then.inputs } : {};
    if (action === 'queue') return withPipeline({ action, workflow, inputs });
    const map = {};
    for (const [k, v] of Object.entries(plain(then.map) ? then.map : {})) if (v) map[k] = String(v);
    const rest = normalizeThen(then.then, depth + 1);
    return { ...withPipeline({ action, workflow, map, inputs }), ...(rest ? { then: rest } : {}) };
  }

  /** The then with the pipeline run's id stamped on it and on the rest of the chain it carries. */
  function withPipelineId(then, id) {
    if (!then || !then.pipeline || !id) return then;
    return { ...then, pipeline: { ...then.pipeline, id: then.pipeline.id || String(id) }, ...(then.then ? { then: withPipelineId(then.then, id) } : {}) };
  }

  /**
   * The pipeline a run belongs to (#135), from its chain: the one that started it (`from.pipeline`),
   * else, for a pipeline's first run, its then's (stage 1 → this run is stage 0, its id the run's).
   */
  function pipelineOf(chain, runId) {
    const from = normalizePipeline(chain?.from?.pipeline);
    if (from) return from;
    const p = normalizePipeline(chain?.then?.pipeline);
    if (p && p.stage === 1) return { ...p, id: p.id || (runId ? String(runId) : undefined), stage: 0 };
    return null;
  }

  /**
   * The mapping proposed for a pair of workflows: each input of the next one ← the output of the
   * previous one with the same name, a text input (task, prompt, request) ← the previous run's text
   * result (document, issues, issue or findings), a `type: run` input ← the previous run.
   * @param {object} outputs the previous workflow's `outputs:` contract
   * @param {object} inputs the next workflow's `inputs:`
   */
  function defaultMap(outputs, inputs) {
    const outs = outputs || {};
    const map = {};
    for (const [k, def] of Object.entries(inputs || {})) {
      if (def?.type === 'run') map[k] = RUN_SOURCE;
      else if (outs[k]) map[k] = k;
      else if (TEXT_INPUTS.includes(k)) {
        const src = TEXT_SOURCES.find((s) => outs[s]);
        if (src) map[k] = src;
      }
    }
    return map;
  }

  // An issue output item ({ number, url, title }) as a line of a task.
  const issueLine = (i) => [i.number ? `#${i.number}` : '', i.title || '', i.url ? `(${i.url})` : ''].filter(Boolean).join(' ');
  const isIssue = (v) => plain(v) && (v.url || v.number);

  /** An output value as the value of an input of the next workflow (its definition `def`). */
  function convertValue(value, def = {}) {
    if (value == null) return undefined;
    const type = def.type || 'string';
    if (type === 'array') {
      const list = Array.isArray(value) ? value : String(value).split('\n').map((l) => l.trim()).filter(Boolean);
      return list.map((v) => (isIssue(v) ? v.url || String(v.number) : plain(v) ? JSON.stringify(v) : v));
    }
    if (type === 'integer' || type === 'number') return Number(value);
    if (type === 'boolean') return !!value;
    if (Array.isArray(value)) {
      if (value.every(isIssue)) return value.length === 1 ? `Implement ${issueLine(value[0])}` : ['Implement these issues together:', ...value.map((i) => `- ${issueLine(i)}`)].join('\n');
      return value.map((v) => (plain(v) ? JSON.stringify(v) : String(v))).join('\n');
    }
    if (isIssue(value)) return `Implement ${issueLine(value)}`;
    if (plain(value)) return value.text != null ? String(value.text) : JSON.stringify(value, null, 2);
    return String(value);
  }

  /**
   * The inputs of the next run: the then's own values first, then the mapped outputs, then the
   * previous run's inputs with the same name that say where the work is (paths, branch, language,
   * platform). The rest is left to the next workflow's defaults.
   * @param {object} then normalized (action 'workflow' or 'queue')
   * @param {{ outputs?: object, inputs?: object, runDir?: string, runId?: string }} prev the previous run
   * @param {object} defs the next workflow's `inputs:`
   */
  function nextInputs(then, prev, defs) {
    const out = {};
    const prevInputs = prev?.inputs || {};
    const given = (v) => v != null && v !== '';
    // the folder the previous run worked in (project_path, repo_path...), for a path input of another name
    const folder = Object.entries(prevInputs).find(([k, v]) => /path|dir/i.test(k) && typeof v === 'string' && given(v))?.[1];
    for (const [k, def] of Object.entries(defs || {})) {
      if (!CARRIED.test(k) || (def?.type || 'string') !== 'string') continue;
      if (given(prevInputs[k])) out[k] = prevInputs[k];
      else if (folder && /path|dir/i.test(k)) out[k] = folder;
    }
    for (const [k, src] of Object.entries(then?.map || {})) {
      if (!defs?.[k]) continue;
      // a `type: run` input takes a run id (the engine refuses a folder path)
      const value = src === RUN_SOURCE ? prev?.runId || fileOf(prev?.runDir) || undefined : convertValue(prev?.outputs?.[src], defs[k]);
      if (value !== undefined && value !== '') out[k] = value;
    }
    for (const [k, v] of Object.entries(then?.inputs || {})) if (v !== undefined && v !== '') out[k] = v;
    return out;
  }

  /** The issues a run produced ({ number, url, title }), from its `issues` or `issue` output. */
  function producedIssues(outputs) {
    const list = [].concat(outputs?.issues || [], outputs?.issue || []);
    const seen = new Set();
    return list.filter((i) => isIssue(i) && Number.isInteger(Number(i.number)) && Number(i.number) > 0 && !seen.has(Number(i.number)) && seen.add(Number(i.number)))
      .map((i) => ({ ...i, number: Number(i.number), url: String(i.url || ''), title: String(i.title || '') }));
  }

  /**
   * The assign calls a `queue` then makes with the produced issues, as the issue tracker's "Create
   * and queue" always did: one assign of every issue (each its own run), or, when the analysis
   * advised grouping (an issue's `grouping: 'group'`), group runs where the open issues it advised to
   * group with (`group_with`) fill the room the produced ones leave, at most `maxGroup` issues per run
   * (created issues beyond it go in further groups).
   * @returns {{ numbers: number[], group: boolean }[]}
   */
  function queueBatches(outputs, maxGroup = 5) {
    const issues = producedIssues(outputs);
    if (!issues.length) return [];
    const created = issues.map((i) => i.number);
    const size = Math.max(2, Number(maxGroup) || 5);
    const advised = issues.some((i) => i.grouping === 'group');
    const nearby = advised ? [...new Set(issues.flatMap((i) => i.group_with || []).map(Number))].filter((n) => Number.isInteger(n) && n > 0 && !created.includes(n)) : [];
    const numbers = [...created, ...nearby.slice(0, Math.max(0, size - created.length))];
    if (!advised || numbers.length < 2) return [{ numbers, group: false }];
    const batches = [];
    for (let i = 0; i < numbers.length; i += size) {
      const part = numbers.slice(i, i + size);
      batches.push({ numbers: part, group: part.length > 1 });
    }
    return batches;
  }

  /**
   * Why a finished run's chain does not go on ('' = it goes on): only a success continues, and a
   * workflow that declares `merged_commit` (a development workflow) must have merged. Simulated runs
   * never touch git: the merge is not required of them.
   */
  function blockedReason({ status, outputs, outputDefs, mock } = {}) {
    if (status !== 'success') return `the run ended ${status || 'without a status'}`;
    if (!mock && outputDefs?.merged_commit && !outputs?.merged_commit) return 'the run succeeded but nothing was merged';
    return '';
  }

  /** The workflows a then runs after the first one (file names; the PO adds roadmap items, it starts none), a pipeline's rest included. */
  function chainWorkflows(then, depth = 0) {
    if (!then || depth >= MAX_DEPTH || (then.action !== 'workflow' && then.action !== 'queue')) return [];
    return [then.workflow, ...chainWorkflows(then.then, depth + 1)];
  }

  /**
   * A rough cost of the workflows from past runs: the average cost and duration of each one's
   * finished, real runs (simulations cost nothing). `basis` is how many runs it comes from (0: no
   * estimate). Always an estimate: the owner sees it marked so.
   * @param {string[]} files workflow file names
   * @param {{ file?: string, workflow?: string, status?: string, mock?: boolean, costUsd?: number, durationMs?: number }[]} runs
   */
  function estimateCost(files, runs) {
    const items = (files || []).filter(Boolean).map((f) => {
      const file = fileOf(f);
      const name = file.replace(/\.ya?ml$/i, '');
      const past = (runs || []).filter((r) => !r.mock && r.finishedAt !== null && ['success', 'failed', 'cancelled'].includes(r.status)
        && (fileOf(r.file) === file || r.workflow === name));
      const n = past.length;
      const avg = (k) => (n ? past.reduce((a, r) => a + (Number(r[k]) || 0), 0) / n : null);
      return { workflow: file, basis: n, costUsd: avg('costUsd'), minutes: n ? Math.round(avg('durationMs') / 60000) : null };
    });
    const known = items.filter((i) => i.basis);
    return { items, costUsd: known.length ? known.reduce((a, i) => a + i.costUsd, 0) : null, complete: known.length === items.length };
  }

  /** One line for the UI: "≈ US$ 1.20, ~25 min (estimate from 4 past runs)". */
  function estimateText(est) {
    if (!est?.items?.length) return '';
    const parts = est.items.map((i) => (i.basis
      ? `${i.workflow}: ≈ US$ ${i.costUsd.toFixed(2)}, ~${i.minutes} min (estimate from ${i.basis} past run${i.basis === 1 ? '' : 's'})`
      : `${i.workflow}: no past runs to estimate from`));
    return parts.join(' · ');
  }

  /** The words of a then for badges and notices: "then: software-development" / "then: Product Owner". */
  function thenLabel(then) {
    if (!then) return '';
    if (then.action === 'product_owner') return 'Product Owner (roadmap)';
    const name = fileOf(then.workflow).replace(/\.ya?ml$/i, '');
    return then.action === 'queue' ? `queue for ${name}` : name;
  }

  const CHAIN_STATES = {
    done: 'chain done',
    dropped: 'chain dropped',
    paused: 'chain paused',
    started: 'chain started',
    waiting: 'chain waiting',
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /**
   * The badges of a run's chain for the run lists, the Run screen and the run chat: "→ then: <workflow>"
   * on the first run (with its state once it finished), "← from <run>" on the next one.
   * @param {{ then?: object, from?: { run_id?: string, runId?: string, workflow?: string }, state?: string, reason?: string, nextRunId?: string }} chain
   */
  function chainBadgesHtml(chain) {
    if (!chain) return '';
    const out = [];
    const pipe = pipelineOf(chain);
    if (pipe) out.push(`<span class="badge chain-badge pipe" title="${esc(`Pipeline ${pipe.name} (${pipe.file})${pipe.id ? `\npipeline run: ${pipe.id}` : ''}`)}">⛓ ${esc(pipe.name)}${pipe.stages ? ` · ${pipe.stage + 1}/${pipe.stages}` : ''}</span>`);
    if (chain.then) {
      const state = chain.state && chain.state !== 'waiting' ? ` · ${CHAIN_STATES[chain.state] || chain.state}` : '';
      const tip = [`When it finishes: ${ACTION_LABELS[chain.then.action] || chain.then.action}`, chain.then.workflow ? fileOf(chain.then.workflow) : '', chain.reason || '', chain.nextRunId ? `next run: ${chain.nextRunId}` : ''].filter(Boolean).join('\n');
      const tone = chain.state === 'paused' ? ' warn' : chain.state === 'dropped' ? ' muted' : '';
      out.push(`<span class="badge chain-badge${tone}" title="${esc(tip)}">→ then: ${esc(thenLabel(chain.then))}${esc(state)}</span>`);
    }
    const from = chain.from;
    if (from && (from.run_id || from.runId)) {
      const id = from.run_id || from.runId;
      out.push(`<span class="badge chain-badge from" title="${esc(`Started by the chain of run ${id}${from.workflow ? ` (${from.workflow})` : ''}`)}" data-run-link="${esc(id)}">← from ${esc(from.workflow || id)}</span>`);
    }
    return out.join(' ');
  }

  // A run's chain for the UI's run lists: runs:active's `chain`, or workflow.started's then/from.
  function runChain(x) {
    if (x.chain) return x.chain;
    return x.then || x.from ? { then: x.then || null, from: x.from || null, state: x.then ? 'waiting' : undefined } : null;
  }

  // The chain once its then was edited while the run goes (a run.then event).
  function withThen(chain, then) {
    return { ...(chain || {}), then: then || null, state: then ? 'waiting' : undefined };
  }

  const STAGE_TARGETS = { product_owner: 'Product Owner (roadmap)', queue: 'Queue (Backlog)' };

  /**
   * A pipeline's stages as a strip (#135): the Start drawer and the Assign dialog before it starts
   * (each arrow with its mapping), the Run screen once it runs (each stage's run and its status).
   * @param {{ stages: { workflow?: string, target?: string, map?: object, inputs?: object }[] }} p
   * @param {{ names?: object, runs?: ({ runId?: string, status?: string }|null)[], current?: number }} opts
   *   names: workflow file → its name; runs: per stage, the run (a link) and its status
   */
  function pipelineStagesHtml(p, { names = {}, runs = null, current = -1 } = {}) {
    const stages = p?.stages || [];
    return `<ol class="pipe-strip">${stages.map((s, i) => {
      const label = s.target && s.target !== 'workflow' && s.target !== 'queue' ? STAGE_TARGETS[s.target] : `${s.target === 'queue' ? 'Queue for ' : ''}${names[s.workflow] || fileOf(s.workflow).replace(/\.ya?ml$/i, '')}`;
      const map = i ? Object.entries(s.map || {}).map(([input, output]) => `<span class="badge" title="${esc(`Input "${input}" ← output "${output}" of the previous stage`)}">${esc(output === RUN_SOURCE ? 'the run' : output)} → ${esc(input)}</span>`).join('') : '';
      const fixed = Object.entries(s.inputs || {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n');
      const run = runs?.[i];
      const pill = run ? StatusPill.statusPill(run.status || 'queued') : '';
      const head = run?.runId ? `<button type="button" class="link-btn pipe-stage-name" data-run-link="${esc(run.runId)}" title="${esc(`Open run ${run.runId}`)}">${esc(label)}</button>` : `<span class="pipe-stage-name" title="${esc(s.workflow || label)}">${esc(label)}</span>`;
      return `${i ? `<li class="pipe-arrow" aria-hidden="true">→${map ? `<span class="pipe-map">${map}</span>` : ''}</li>` : ''}<li class="pipe-stage${i === current ? ' current' : ''}"${fixed ? ` title="${esc(`Fixed inputs:\n${fixed}`)}"` : ''}><span class="pipe-stage-n">${i + 1}</span>${head}${pill}</li>`;
    }).join('')}</ol>`;
  }

  const api = {
    ACTION_LABELS,
    ACTIONS,
    CHAIN_STATES,
    MAX_DEPTH,
    RUN_SOURCE,
    blockedReason,
    chainBadgesHtml,
    chainWorkflows,
    convertValue,
    defaultMap,
    estimateCost,
    estimateText,
    nextInputs,
    normalizePipeline,
    normalizeThen,
    pipelineOf,
    pipelineStagesHtml,
    producedIssues,
    queueBatches,
    runChain,
    thenLabel,
    withPipelineId,
    withThen,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChainModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
