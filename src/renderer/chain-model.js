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
// load: any order (read when a screen draws)
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

  const plain = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const fileOf = (w) => String(w || '').split(/[\\/]/).pop();

  /** A then as given (UI, YAML gate choice, API) → its normalized form, or null for nothing. Throws on a bad one. */
  function normalizeThen(then) {
    if (then == null || then === '' || then === 'none') return null;
    if (!plain(then)) throw new Error('then must be an object with an action.');
    const action = then.action || 'none';
    if (!ACTIONS.includes(action)) throw new Error(`then.action must be one of ${ACTIONS.join(', ')}.`);
    if (action === 'none') return null;
    if (action === 'product_owner') return { action };
    const workflow = fileOf(then.workflow);
    if (!workflow) throw new Error(`then: "${action}" needs a workflow.`);
    const inputs = plain(then.inputs) ? { ...then.inputs } : {};
    if (action === 'queue') return { action, workflow, inputs };
    const map = {};
    for (const [k, v] of Object.entries(plain(then.map) ? then.map : {})) if (v) map[k] = String(v);
    return { action, workflow, map, inputs };
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
      const value = src === RUN_SOURCE ? prev?.runDir || prev?.runId : convertValue(prev?.outputs?.[src], defs[k]);
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

  /** The workflows a then runs after the first one (file names; the PO adds roadmap items, it starts none). */
  function chainWorkflows(then) {
    return then && (then.action === 'workflow' || then.action === 'queue') ? [then.workflow] : [];
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

  const api = {
    ACTION_LABELS,
    ACTIONS,
    CHAIN_STATES,
    RUN_SOURCE,
    blockedReason,
    chainBadgesHtml,
    chainWorkflows,
    convertValue,
    defaultMap,
    estimateCost,
    estimateText,
    nextInputs,
    normalizeThen,
    producedIssues,
    queueBatches,
    thenLabel,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChainModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
