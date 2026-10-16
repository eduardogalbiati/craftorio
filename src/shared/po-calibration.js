// The Product Owner's Speed ↔ Quality calibration (#189): five steps, 1 (Speed) to 5 (Quality), each
// mapped to the planning parameters the Product Owner follows (parallel runs per stage, the max
// complexity of a group, the mode of UI issues, where an issue is placed, review rounds). Saved in
// agents/product-owner.json (`calibration`, src/agents.js); the prompt states the step and its
// parameters (src/product-owner.js promptRules), the simulated answer follows `maxRuns` and
// `maxComplexity`, and the screens draw the same slider (sliderHtml: Agents › Product Owner, the
// Product Owner drawer's settings panel, views/backlog/backlog-po-settings.js). A question may ask
// for another step once ("plan this one for quality": fromQuestion) without changing the saved one.
// The Cost axis (#205, `cost`: the same API under `PoCalibration.cost`): five steps, 1 (Economy) to 5
// (Generous), default 3, saved next to `calibration` (`cost`). Each step sets the largest group (cost
// wins over Speed ↔ Quality when it is not Balanced: `groupCap`), whether groups of the same area are
// packed into one run (`pack`), the items' test options (#203: unit_tests, e2e_tests, a test-batch
// stage), the evidence screenshots (`screenshots` input) and cheaper agents where a workflow has an
// input for it (`costInputs`, src/product-owner.js). "Plan this one cheap" asks for Economy once.
// #235: costApplies(workflow) says whether the Cost axis means anything for a workflow: not for a
// tests-first one (testsFirst: AI Development, whose tests are always written and run), nor for one
// without the inputs it sets; the drawer hides the Cost chip and the plan skips the step then.
// Browser: window.PoCalibration; Node: module.exports.
// Loaded before the renderer's files, like every src/shared/ module (views/agents/agents.js and
// views/backlog/backlog-po-settings.js read window.PoCalibration as they load).
(function (root) {
  const MIN = 1;
  const MAX = 5;
  // the owner's choice of 2026-10-02: speed now
  const DEFAULT = 2;

  // `maxRuns`: parallel runs per stage (null: as many as do not share files)
  const STEPS = Object.freeze([
    Object.freeze({
      level: 1, name: 'Speed', maxRuns: null, maxComplexity: 6,
      runs: 'as many as do not share files', mode: 'auto unless the owner asks for validated', placement: 'the earliest stage without shared files', review: 'no extra review round',
      summary: 'As many parallel runs per stage as do not share files, the earliest free stage, auto mode: more issues per night, more merge conflicts for the agents to resolve, fewer stops for you.',
    }),
    Object.freeze({
      level: 2, name: 'Speed-leaning', maxRuns: 4, maxComplexity: 6,
      runs: 'up to 4', mode: 'validated for new screens only, auto otherwise', placement: 'the earliest stage without shared files', review: 'no extra review round',
      summary: 'Up to 4 parallel runs per stage, the earliest free stage, validated mode only for new screens: many issues per night, some merge conflicts, a look at new screens only.',
    }),
    Object.freeze({
      level: 3, name: 'Balanced', maxRuns: 3, maxComplexity: 5,
      runs: 'up to 3', mode: 'validated for new screens, auto otherwise', placement: 'after the work it builds on', review: 'no extra review round',
      summary: 'Up to 3 parallel runs per stage, groups of complexity 5 at most, after the work they build on, validated mode for new screens: a steady night with fewer conflicts.',
    }),
    Object.freeze({
      level: 4, name: 'Quality-leaning', maxRuns: 2, maxComplexity: 5,
      runs: 'up to 2', mode: 'validated for any screen', placement: 'after the work it builds on', review: 'no extra review round',
      summary: 'Up to 2 parallel runs per stage, groups of complexity 5 at most, after the work they build on, validated mode for any screen: few conflicts, more of your time at the gates.',
    }),
    Object.freeze({
      level: 5, name: 'Quality', maxRuns: 2, maxComplexity: 4,
      runs: '1–2', mode: 'validated for any screen', placement: 'its own stage after the most stable base', review: 'add a developer self-review (#179) when the workflow has it',
      summary: '1–2 runs per stage, after the work it builds on, validated mode for screens: fewer conflicts and a look before review, slower nights and more of your time.',
    }),
  ]);

  // #205: `maxComplexity` the largest group (it replaces the Speed ↔ Quality step's unless Balanced),
  // `pack` groups of one area or files into one run, `unitTests`/`e2eTests` the #203 inputs,
  // `testBatch` a test-batch item after each stage with untested issues, `screenshots` the evidence
  // input, `cheapAgents` the cheaper models and efforts where the workflow has an input for them
  const COST_STEPS = Object.freeze([
    Object.freeze({
      level: 1, name: 'Economy', maxComplexity: 8, pack: true, unitTests: 'run_existing', e2eTests: 'write', testBatch: true, screenshots: 'off', cheapAgents: true,
      summary: 'Fewer, larger runs (one run overhead for a whole area), the existing suite only with the unit tests written later by a test batch, no screenshots, cheaper agents: the lowest cost per issue, less checked per run.',
    }),
    Object.freeze({
      level: 2, name: 'Economy-leaning', maxComplexity: 7, pack: true, unitTests: 'write_and_run', e2eTests: 'write', testBatch: false, screenshots: 'changed', cheapAgents: true,
      summary: 'Larger runs of one area, tests written and run, screenshots of the changed screens only, cheaper agents: most of the checks for less.',
    }),
    Object.freeze({
      level: 3, name: 'Balanced', maxComplexity: 6, pack: false, unitTests: 'write_and_run', e2eTests: 'write', testBatch: false, screenshots: 'changed', cheapAgents: false,
      summary: 'Groups as the Speed ↔ Quality step sizes them, tests written and run, E2E scenarios written, screenshots of the changed screens, the workflow\'s agents.',
    }),
    Object.freeze({
      level: 4, name: 'Generous-leaning', maxComplexity: 5, pack: false, unitTests: 'write_and_run', e2eTests: 'write', testBatch: false, screenshots: 'all', cheapAgents: false,
      summary: 'Smaller runs, tests written and run, every screenshot, the workflow\'s agents: more checked, a higher cost per issue.',
    }),
    Object.freeze({
      level: 5, name: 'Generous', maxComplexity: 4, pack: false, unitTests: 'write_and_run', e2eTests: 'write_and_run', testBatch: false, screenshots: 'all', cheapAgents: false,
      summary: 'Small runs, unit and E2E tests written and run in each run, every screenshot, the workflow\'s agents: the most checked, the highest cost per issue.',
    }),
  ]);

  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const node = typeof module === 'object' && module.exports;
  // the catalog's helper (#330), at call time: the screens show the steps in the interface language;
  // the prompts (promptSection, costPromptSection, plannedFor's plan names) ask for 'en'
  const t = (...a) => (node ? require('./i18n') : root.I18n)?.t(...a) ?? a[0];

  /**
   * One slider axis: its steps (`level`, `name`, `summary`: the English the prompts state; the
   * screens read `po.<setting>_<level>` and `po.<setting>_<level>_summary`), the ends' names, its
   * parameters as lines and the setting it saves. Both axes share the markup and the CSS (po-calibration.css).
   */
  function makeAxis({ steps, fallback, ends, aria, group, paramsOf, setting }) {
    /** A saved or requested value as a step number (1..5); anything else is `fallback`. */
    function clamp(value, def = fallback) {
      const n = Number(value);
      return Number.isInteger(n) && MIN <= n && n <= MAX ? n : def;
    }
    const step = (value) => steps[clamp(value) - 1];
    /** The step's name in `lang` (the interface language when omitted): "Speed". */
    const nameOf = (value, lang) => t(`po.${setting}_${clamp(value)}`, null, lang);
    const summaryOf = (value, lang) => t(`po.${setting}_${clamp(value)}_summary`, null, lang);
    /** The step's parameters as lines (the slider's details, the prompt's list), in `lang`. */
    const params = (value, lang) => paramsOf(step(value), (key, p) => t(key, p, lang));
    /** The slider's tooltip for one step: its name, what it prioritises and its numbers. */
    function tooltip(value, lang) {
      return `${label(value, lang)}: ${summaryOf(value, lang)}\n${params(value, lang).map(([k, v]) => `${k}: ${v}`).join('\n')}`;
    }
    /** "Speed (1/5)" */
    const label = (value, lang) => `${nameOf(value, lang)} (${clamp(value)}/${MAX})`;

    function detailsHtml(value) {
      return `<p class="small"><b>${escape(label(value))}</b>: ${escape(summaryOf(value))}</p>
      <dl class="po-calib-params">${params(value).map(([k, x]) => `<dt>${escape(k)}</dt><dd>${escape(x)}</dd>`).join('')}</dl>`;
    }

    /**
     * The slider of both screens (Agents › Product Owner, the drawer's settings): a range input from
     * one end to the other, its five steps as focusable ticks (tooltip on hover and keyboard focus), and
     * what the step prioritises with its numbers (`details`, redrawn on input).
     */
    function sliderHtml({ id, value }) {
      const v = clamp(value);
      return `<div class="po-calib" data-po-calib="${escape(setting)}">
      <div class="po-calib-ends"><b>${escape(t(ends[0]))}</b><b>${escape(t(ends[1]))}</b></div>
      <input type="range" id="${escape(id)}" class="po-calib-range" min="${MIN}" max="${MAX}" step="1" value="${v}" aria-label="${escape(t(aria))}" aria-valuetext="${escape(label(v))}" title="${escape(tooltip(v))}" />
      <div class="po-calib-ticks" role="group" aria-label="${escape(t(group))}">${steps.map((s) =>
        `<button type="button" class="po-calib-tick${s.level === v ? ' active' : ''}" data-calib="${s.level}" data-tip="${escape(tooltip(s.level))}" aria-label="${escape(tooltip(s.level))}" aria-pressed="${s.level === v}">${escape(nameOf(s.level))}</button>`).join('')}</div>
      <div class="po-calib-details" aria-live="polite">${detailsHtml(v)}</div>
    </div>`;
    }

    /** Moves a slider drawn by sliderHtml to `value` (the range, the active tick, the details). */
    function syncSlider(box, value) {
      const v = clamp(value);
      const range = box.querySelector('.po-calib-range');
      range.value = String(v);
      range.title = tooltip(v);
      range.setAttribute('aria-valuetext', label(v));
      box.querySelectorAll('[data-calib]').forEach((b) => {
        b.classList.toggle('active', Number(b.dataset.calib) === v);
        b.setAttribute('aria-pressed', String(Number(b.dataset.calib) === v));
      });
      box.querySelector('.po-calib-details').innerHTML = detailsHtml(v);
    }

    /**
     * Wires a slider drawn by sliderHtml (once per container): `onChange(level, committed)` on each
     * move; `committed` is true when the owner let go of the range (`change`) or picked a step's tick.
     */
    function bindSlider(box, onChange) {
      const set = (v, committed) => { syncSlider(box, v); onChange(clamp(v), committed); };
      box.addEventListener('input', (e) => { if (e.target.classList.contains('po-calib-range')) set(e.target.value, false); });
      box.addEventListener('change', (e) => { if (e.target.classList.contains('po-calib-range')) set(e.target.value, true); });
      box.addEventListener('click', (e) => { const b = e.target.closest('[data-calib]'); if (b) set(b.dataset.calib, true); });
    }

    return { bindSlider, clamp, DEFAULT: fallback, detailsHtml, label, MAX, MIN, nameOf, params, sliderHtml, step, STEPS: steps, syncSlider, tooltip };
  }

  // the parameters' values: each step's in the catalog (po.calibration_<field>_<level>), the tables
  // above keep the English for the code that reads a step
  const calibration = makeAxis({
    steps: STEPS, fallback: DEFAULT, ends: ['po.speed', 'po.quality'], aria: 'po.speed_to_quality', group: 'po.calibration_steps', setting: 'calibration',
    paramsOf: (s, tr) => [
      [tr('po.parallel_runs'), tr(`po.calibration_runs_${s.level}`)],
      [tr('po.max_complexity'), String(s.maxComplexity)],
      [tr('po.ui_mode'), tr(`po.calibration_mode_${s.level}`)],
      [tr('po.placement'), tr(`po.calibration_placement_${s.level}`)],
      [tr('po.review_rounds'), tr(`po.calibration_review_${s.level}`)],
    ],
  });

  const cost = makeAxis({
    steps: COST_STEPS, fallback: 3, ends: ['po.economy', 'po.generous'], aria: 'po.economy_to_generous', group: 'po.cost_steps', setting: 'cost',
    paramsOf: (s, tr) => [
      [tr('po.max_complexity'), s.level === 3 ? tr('po.cost_complexity_balanced', { n: s.maxComplexity }) : String(s.maxComplexity)],
      [tr('po.grouping'), tr(s.pack ? 'po.cost_grouping_pack' : 'po.cost_grouping_plan')],
      [tr('po.unit_tests'), tr(s.testBatch ? 'po.cost_unit_tests_batch' : 'po.cost_unit_tests', { value: tr(`po.unit_tests_${s.unitTests}`) })],
      [tr('po.e2e_tests'), tr(`po.e2e_tests_${s.e2eTests}`)],
      [tr('po.screenshots'), tr(`po.screenshots_${s.screenshots}`)],
      [tr('po.agents'), tr(s.cheapAgents ? 'po.cost_agents_cheap' : 'po.cost_agents_workflow')],
    ],
  });

  /** The prompt's section: the calibration the owner set and the parameters to follow. */
  function promptSection(value) {
    const s = calibration.step(value);
    return [
      `## Calibration: ${calibration.label(value, 'en')}`,
      `The owner calibrated the Product Owner between Speed (1) and Quality (5). Plan with these parameters; they replace the skill's defaults for the same points (parallel runs per stage, the group size, the mode of UI issues, the placement):`,
      ...calibration.params(value, 'en').map(([k, v]) => `- ${k}: ${v}`),
      `What this step prioritises: ${s.summary}`,
      `Start the summary by saying which calibration you planned with ("Planned for ${s.name}").`,
    ].join('\n');
  }

  /**
   * #205: the largest group when both sliders are set: the Cost step's, unless it is Balanced (then
   * the Speed ↔ Quality step's). Cost wins when they disagree: Speed + Economy gives fewer, larger runs.
   */
  function groupCap(level, costLevel) {
    const c = cost.step(costLevel);
    return c.level === 3 ? calibration.step(level).maxComplexity : c.maxComplexity;
  }

  /** #205: the prompt's Cost section: the step and what it sets on the groups. */
  function costPromptSection(value, level = DEFAULT) {
    const s = cost.step(value);
    return [
      `## Cost: ${cost.label(value, 'en')}`,
      `The owner also set the cost between Economy (1) and Generous (5). When it disagrees with the calibration above, cost wins. Plan with these parameters:`,
      ...cost.params(value, 'en').map(([k, v]) => `- ${k}: ${v}`),
      `- Largest group for this plan: complexity ${groupCap(level, value)}`,
      ...(s.pack ? ['Prefer grouping issues of the same area or files into one run over separate runs, and say it in the group\'s reason ("grouped to pay the run overhead once").'] : []),
      `The orchestrator sets the groups' test, screenshot and agent inputs from this step: do not set them yourself.`,
      `What this step prioritises: ${s.summary}`,
      `Start the summary with both steps ("Planned for ${calibration.step(level).name} · ${s.name}").`,
    ].join('\n');
  }

  // #235: the workflows whose acceptance tests are always written first and run by the orchestrator
  // (their test inputs do not trade cost for checks): matched on the file or name, variants included
  const TESTS_FIRST = [
    'ai-development',
  ];
  const COST_INPUTS = ['e2e_tests', 'screenshots', 'unit_tests'];
  /**
   * #235: whether the Cost axis (its inputs, the test-batch stage, the Cost chip) applies to a
   * workflow ({ file, name, inputs }): it declares an input the axis sets and is not tests-first.
   * No workflow (unknown): it applies, as before.
   */
  function costApplies(wf) {
    if (!wf) return true;
    return !testsFirst(wf) && COST_INPUTS.some((k) => wf.inputs && k in wf.inputs);
  }
  /** #235: a workflow ({ file, name }) whose acceptance tests are always written first. */
  function testsFirst(wf) {
    const slug = String(wf?.file || wf?.name || '').replace(/\.ya?ml$/i, '');
    const name = String(wf?.name || '');
    return !!wf?.testsFirst || TESTS_FIRST.some((t) => [slug, name].some((s) => s === t || s.startsWith(`${t}-`)));
  }

  /** "Speed · Economy": the plan's two steps, as each answer shows them (in `lang`, the interface language when omitted). */
  const plannedFor = (level, costLevel, lang) => `${calibration.nameOf(level, lang)}${costLevel == null ? '' : ` · ${cost.nameOf(costLevel, lang)}`}`;

  /**
   * A per-question calibration the owner wrote in the question ("plan this one for quality",
   * "balanced"), or null. Only explicit phrases count: "quality" alone is not a request.
   */
  function fromQuestion(question) {
    const q = String(question || '').toLowerCase();
    if (/\b(for|favou?r|prioriti[sz]e|calibrat\w*( to| for)?)\s+(max(imum)?\s+)?quality\b|\bquality[- ]first\b/.test(q)) return MAX;
    if (/\b(for|favou?r|prioriti[sz]e|calibrat\w*( to| for)?)\s+(max(imum)?\s+)?speed\b|\bspeed[- ]first\b/.test(q)) return MIN;
    if (/\b(for|calibrat\w*( to| for)?)\s+balance(d)?\b/.test(q)) return 3;
    return null;
  }

  /** #205: a per-question Cost step ("plan this one cheap", "economy", "generous"), or null. */
  function costFromQuestion(question) {
    const q = String(question || '').toLowerCase();
    if (/\b(plan\s+(this|it)(\s+one)?\s+cheap(ly)?|cheap(est)?\s+plan|on\s+a\s+budget|for\s+economy|economy[- ]first)\b/.test(q)) return MIN;
    if (/\b(for|be)\s+generous\b|\bgenerous(ly)?\s+plan\b|\bwhatever\s+it\s+costs\b/.test(q)) return MAX;
    return null;
  }

  const api = {
    bindSlider: calibration.bindSlider,
    clamp: calibration.clamp,
    cost,
    costApplies,
    costFromQuestion,
    costPromptSection,
    DEFAULT,
    detailsHtml: calibration.detailsHtml,
    fromQuestion,
    groupCap,
    label: calibration.label,
    MAX,
    MIN,
    nameOf: calibration.nameOf,
    params: calibration.params,
    plannedFor,
    promptSection,
    sliderHtml: calibration.sliderHtml,
    step: calibration.step,
    STEPS,
    syncSlider: calibration.syncSlider,
    testsFirst,
    tooltip: calibration.tooltip,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PoCalibration = api;
})(typeof window !== 'undefined' ? window : globalThis);
