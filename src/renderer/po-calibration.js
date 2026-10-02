// The Product Owner's Speed ↔ Quality calibration (#189): five steps, 1 (Speed) to 5 (Quality), each
// mapped to the planning parameters the Product Owner follows (parallel runs per stage, the max
// complexity of a group, the mode of UI issues, where an issue is placed, review rounds). Saved in
// agents/product-owner.json (`calibration`, src/agents.js); the prompt states the step and its
// parameters (src/product-owner.js promptRules), the simulated answer follows `maxRuns` and
// `maxComplexity`, and the screens draw the same slider (sliderHtml: Agents › Product Owner, the
// Product Owner drawer's settings panel, views/backlog/backlog-po-settings.js). A question may ask
// for another step once ("plan this one for quality": fromQuestion) without changing the saved one.
// Browser: window.PoCalibration; Node: module.exports.
// load: early (views/agents/agents.js and views/backlog/backlog-po-settings.js read window.PoCalibration as they load)
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

  /** A saved or requested value as a step number (1..5); anything else is `fallback`. */
  function clamp(value, fallback = DEFAULT) {
    const n = Number(value);
    return Number.isInteger(n) && n >= MIN && n <= MAX ? n : fallback;
  }

  const step = (value) => STEPS[clamp(value) - 1];

  /** The step's parameters as lines (the slider's details, the prompt's list). */
  function params(value) {
    const s = step(value);
    return [
      ['Parallel runs per stage', s.runs],
      ['Max complexity per group', String(s.maxComplexity)],
      ['UI issues mode', s.mode],
      ['Placement', s.placement],
      ['Review rounds', s.review],
    ];
  }

  /** The slider's tooltip for one step: its name, what it prioritises and its numbers. */
  function tooltip(value) {
    const s = step(value);
    return `${s.name} (${s.level}/${MAX}): ${s.summary}\n${params(value).map(([k, v]) => `${k}: ${v}`).join('\n')}`;
  }

  /** "Speed (1/5)" */
  const label = (value) => `${step(value).name} (${clamp(value)}/${MAX})`;

  /** The prompt's section: the calibration the owner set and the parameters to follow. */
  function promptSection(value) {
    const s = step(value);
    return [
      `## Calibration: ${label(value)}`,
      `The owner calibrated the Product Owner between Speed (1) and Quality (5). Plan with these parameters; they replace the skill's defaults for the same points (parallel runs per stage, the group size, the mode of UI issues, the placement):`,
      ...params(value).map(([k, v]) => `- ${k}: ${v}`),
      `What this step prioritises: ${s.summary}`,
      `Start the summary by saying which calibration you planned with ("Planned for ${s.name}").`,
    ].join('\n');
  }

  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /**
   * The slider of both screens (Agents › Product Owner, the drawer's settings): a range input from
   * Speed to Quality, its five steps as focusable ticks (tooltip on hover and keyboard focus), and
   * what the step prioritises with its numbers (`details`, redrawn on input).
   */
  function sliderHtml({ id, value }) {
    const v = clamp(value);
    return `<div class="po-calib" data-po-calib>
      <div class="po-calib-ends"><b>Speed</b><b>Quality</b></div>
      <input type="range" id="${escape(id)}" class="po-calib-range" min="${MIN}" max="${MAX}" step="1" value="${v}" aria-label="Speed to Quality" aria-valuetext="${escape(label(v))}" title="${escape(tooltip(v))}" />
      <div class="po-calib-ticks" role="group" aria-label="Calibration steps">${STEPS.map((s) =>
        `<button type="button" class="po-calib-tick${s.level === v ? ' active' : ''}" data-calib="${s.level}" data-tip="${escape(tooltip(s.level))}" aria-label="${escape(tooltip(s.level))}" aria-pressed="${s.level === v}">${escape(s.name)}</button>`).join('')}</div>
      <div class="po-calib-details" aria-live="polite">${detailsHtml(v)}</div>
    </div>`;
  }

  function detailsHtml(value) {
    const s = step(value);
    return `<p class="small"><b>${escape(label(value))}</b>: ${escape(s.summary)}</p>
      <dl class="po-calib-params">${params(value).map(([k, x]) => `<dt>${escape(k)}</dt><dd>${escape(x)}</dd>`).join('')}</dl>`;
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

  const api = {
    bindSlider,
    clamp,
    DEFAULT,
    detailsHtml,
    fromQuestion,
    label,
    MAX,
    MIN,
    params,
    promptSection,
    sliderHtml,
    step,
    STEPS,
    syncSlider,
    tooltip,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PoCalibration = api;
})(typeof window !== 'undefined' ? window : globalThis);
