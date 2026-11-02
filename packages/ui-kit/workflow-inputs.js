// One renderer for a workflow's inputs (#116), used wherever they are edited: the Backlog's Assign
// dialog, the Start drawer, the Roadmap item's Edit form. What it reads from an input definition:
// - `label` (else one derived from the key: base_branch → "Base branch"; a slug is never shown) and
//   `options` ({ value: label }, e.g. js → JavaScript; else derived from the value);
// - the control follows the input: a yes/no (`type: boolean`, or an enum of "false"/"true") is a
//   switch; an enum with `multiple: true` (#340, language "js,rust") a row of toggles (role group /
//   checkbox, the value comma-separated, the first chosen first, at least one kept on); an enum of
//   up to 5 short values is a row of pills (.seg); a longer enum a select; a
//   number a short box; a `*branch` input a text box with the project's local branches; text a box;
// - `show_if` ("mode == 'validated'"; `inputs.` optional, ==, !=, and, or, not, parentheses): the
//   field is hidden while it is false. A hidden input keeps its value (read() still returns it);
// - `description`: the muted help line under the control.
// formHtml / fieldHtml return markup; every control carries data-wi-input="<key>" plus the host's
// own attributes (id, name, data-…). read(root) returns the values as the YAML takes them (an enum's
// value, a boolean as true/false, a "false"/"true" enum as its string); set(root, key, value) sets
// one (pills and switches included). applyHints(root, defs, projectId) prefills what the app knows
// about the project (api.projectInputHints: `language` detected from its files, shown "detected";
// `*branch` inputs get the local branches and the default branch) without overriding what the
// owner set. A container with data-wi-scope (or the form) is where show_if reads the other values;
// its data-wi-context (JSON) adds values that are not in it (the Roadmap item's mode).
// inputPills(workflow, inputs) shows a run's inputs as read-only pills ("Unit tests: Run existing",
// #216) on the cards that list them.
// Browser: window.WorkflowInputs (pills and show_if wired once on the document); Node: module.exports.
(function (root) {
  const t = (...a) => (typeof module === 'object' && module.exports ? require('@multiagent/shared/i18n') : root.I18n)?.t(...a) ?? a[0];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const cssEsc = (s) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
  const MAX_PILLS = 5;
  const MAX_PILL_LABEL = 14;

  /** A key or a value as words: base_branch → "Base branch", validateEveryRound → "Validate every round". */
  function humanize(s) {
    const t = String(s ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.\s]+/g, ' ').trim().toLowerCase();
    return t ? t[0].toUpperCase() + t.slice(1) : '';
  }
  const label = (key, def = {}) => (def.label ? String(def.label) : humanize(key));
  /** An enum value's label: the workflow's `options`, else derived (a 2-3 letter slug in capitals: gh → GH). */
  function optionLabel(def = {}, value) {
    const v = String(value ?? '');
    const named = def.options && typeof def.options === 'object' ? def.options[v] : undefined;
    if (named != null && named !== '') return String(named);
    return /^[a-z]{2,3}$/.test(v) && !WORDS.has(v) ? v.toUpperCase() : humanize(v);
  }
  // short values that are words, not slugs (off → "Off", not "OFF")
  const WORDS = new Set(['all', 'any', 'no', 'off', 'on', 'yes']);

  /**
   * A run's inputs as friendly pills (#216), the same on every card (the roadmap item, the Product
   * Owner's proposal and its Cost step, the Assign dialog's summary, the run header): one pill
   * "<label>: <option label>" per input, the raw key and value and the description in the tooltip.
   * `workflow`: its definition (inputs from api.listWorkflows), or null (labels from the keys).
   * An input at its workflow default is left out, unless `defaults: true` (then dimmed, wi-pill-default);
   * `skip`: keys never shown (e.g. the mode, which has its own toggle).
   */
  function inputPills(workflow, inputs, { skip = [], defaults = false } = {}) {
    const defs = workflow?.inputs || {};
    return Object.entries(inputs || {}).filter(([k, v]) => v != null && v !== '' && !skip.includes(k)).map(([k, v]) => {
      const def = defs[k] || {};
      const atDefault = def.default != null && String(def.default) === String(v);
      if (atDefault && !defaults) return '';
      const value = isBoolean(def) || typeof v === 'boolean' ? (truthy(v) ? 'On' : 'Off')
        : def.multiple ? listOf(v).map((x) => optionLabel(def, x)).join(' + ') : optionLabel(def, v);
      const tip = `${k}: ${v}${atDefault ? ' (the workflow default)' : ''}${def.description ? `\n${def.description}` : ''}`;
      return `<span class="badge wi-pill${atDefault ? ' wi-pill-default' : ''}" data-testid="input-pill" data-wi-pill="${esc(k)}" title="${esc(tip)}">${esc(label(k, def))}: ${esc(value)}</span>`;
    }).join('');
  }
  const isBoolean = (def = {}) => def.type === 'boolean' || (Array.isArray(def.enum) && def.enum.length === 2 && def.enum.map(String).sort().join() === 'false,true');
  const truthy = (v) => !['', 'false', '0', 'no', 'off', 'undefined', 'null'].includes(String(v ?? '').trim().toLowerCase());

  /** The items of a multi-value input's value: "rust, js" → ['rust', 'js']. */
  const listOf = (v) => [...new Set(String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean))];

  /** The control of an input: switch | multi | pills | select | number | branch | run | textarea | text. */
  function kind(key, def = {}) {
    if (isBoolean(def)) return 'switch';
    if (Array.isArray(def.enum) && def.multiple) return 'multi';
    if (Array.isArray(def.enum)) {
      const short = def.enum.length <= MAX_PILLS && def.enum.every((v) => optionLabel(def, v).length <= MAX_PILL_LABEL);
      return short ? 'pills' : 'select';
    }
    if (def.type === 'run') return 'run';
    if (def.type === 'integer' || def.type === 'number') return 'number';
    if (def.multiline) return 'textarea';
    if ((def.type || 'string') === 'string' && /(^|_)branch$/i.test(key)) return 'branch';
    return 'text';
  }

  // ---- show_if: a small expression language over the other inputs' values -------------------
  function tokenize(src) {
    const re = /\s*(?:('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(==|!=|\(|\))|([\w.-]+))/y;
    const out = [];
    let pos = 0;
    while (src.slice(pos).trim()) {
      re.lastIndex = pos;
      const m = re.exec(src);
      if (!m) throw new Error(`show_if: cannot read "${src}"`);
      pos = re.lastIndex;
      if (m[1]) out.push({ t: 'str', v: m[1].slice(1, -1).replace(/\\(.)/g, '$1') });
      else if (m[2]) out.push({ t: m[2] });
      else out.push({ t: 'word', v: m[3] });
    }
    return out;
  }
  /** Whether `expr` holds for `values` (true when empty or unreadable: an input is never lost by a typo). */
  function evalCondition(expr, values = {}) {
    const src = String(expr ?? '').trim();
    if (!src) return true;
    try {
      const toks = tokenize(src);
      let i = 0;
      const peek = () => toks[i];
      const isWord = (w) => peek()?.t === 'word' && peek().v === w;
      const atom = () => {
        const tk = toks[i++];
        if (!tk) throw new Error('show_if: unexpected end');
        if (tk.t === '(') { const v = or(); if (toks[i++]?.t !== ')') throw new Error('show_if: missing )'); return v; }
        if (tk.t === 'str') return tk.v;
        if (tk.t !== 'word') throw new Error('show_if: unexpected token');
        if (tk.v === 'true' || tk.v === 'True') return true;
        if (tk.v === 'false' || tk.v === 'False') return false;
        if (/^-?\d+(\.\d+)?$/.test(tk.v)) return Number(tk.v);
        return values[tk.v.replace(/^inputs\./, '')];
      };
      const cmp = () => {
        const a = atom();
        const op = peek()?.t;
        if (op !== '==' && op !== '!=') return a;
        i++;
        const same = String(a ?? '') === String(atom() ?? '');
        return op === '==' ? same : !same;
      };
      const not = () => { if (isWord('not')) { i++; return !truthy(not()); } return cmp(); };
      const and = () => { let v = not(); while (isWord('and')) { i++; const r = not(); v = truthy(v) && truthy(r); } return v; };
      function or() { let v = and(); while (isWord('or')) { i++; const r = and(); v = truthy(v) || truthy(r); } return v; }
      const v = or();
      if (i < toks.length) throw new Error('show_if: unexpected token');
      return truthy(v);
    } catch {
      return true;
    }
  }

  // ---- markup ----------------------------------------------------------------------------
  /**
   * One input's field. opts: value, id (the control's id), attrs (extra attributes of the control,
   * e.g. `name="k"`), context (the values show_if reads; hidden at once when false), autofocus.
   */
  function fieldHtml(key, def = {}, { value, id = `wi-${key}`, attrs = '', context = {}, autofocus = false } = {}) {
    const k = kind(key, def);
    const val = value ?? def.default ?? '';
    const af = autofocus ? ' autofocus' : '';
    const ctl = `id="${esc(id)}" data-wi-input="${esc(key)}" data-testid="input-${esc(key)}" ${attrs}`;
    let control;
    if (k === 'switch') {
      const flag = def.type === 'boolean' ? 'bool' : 'text';
      control = `<label class="switch"><input type="checkbox" role="switch" ${ctl} data-wi-flag="${flag}" aria-labelledby="${esc(id)}-label"${truthy(val) ? ' checked' : ''}${af} /><span></span></label>`;
    } else if (k === 'pills') {
      control = `<span class="seg wi-pills" role="radiogroup" aria-labelledby="${esc(id)}-label">${def.enum.map((o, n) => {
        const on = String(o) === String(val);
        return `<button type="button" role="radio" data-wi-pill="${esc(o)}" class="${on ? 'active' : ''}" aria-checked="${on}" title="${esc(optionLabel(def, o))}"${af && n === 0 ? ' autofocus' : ''}>${esc(optionLabel(def, o))}</button>`;
      }).join('')}</span><input type="hidden" ${ctl} value="${esc(val)}" />`;
    } else if (k === 'multi') {
      // several values (#340, language "js,rust"): one toggle per value, the first chosen is the main one
      const chosen = listOf(val);
      control = `<span class="seg wi-pills wi-multi" role="group" aria-label="${esc(label(key, def))}">${def.enum.map((o, n) => {
        const on = chosen.includes(String(o));
        return `<button type="button" role="checkbox" data-wi-pill="${esc(o)}" class="${on ? 'active' : ''}" aria-checked="${on}" title="${esc(optionLabel(def, o))}"${af && n === 0 ? ' autofocus' : ''}>${esc(optionLabel(def, o))}</button>`;
      }).join('')}</span><input type="hidden" ${ctl} data-wi-multi="1" value="${esc(chosen.join(','))}" />`;
    } else if (k === 'select') {
      control = `<select ${ctl}${af}>${def.enum.map((o) => `<option value="${esc(o)}"${String(o) === String(val) ? ' selected' : ''}>${esc(optionLabel(def, o))}</option>`).join('')}</select>`;
    } else if (k === 'run') {
      control = `<input type="text" ${ctl} class="mono wi-compact" value="${esc(val)}" placeholder="${t('workflow_inputs.latest')}" spellcheck="false"${af} />`;
    } else if (k === 'number') {
      control = `<input type="number" ${ctl} class="wi-number" value="${esc(val)}"${af} />`;
    } else if (k === 'textarea') {
      control = `<textarea ${ctl} rows="4"${af}>${esc(val)}</textarea>`;
    } else if (k === 'branch') {
      control = `<input type="text" ${ctl} class="wi-compact" list="${esc(id)}-branches" value="${esc(val)}" spellcheck="false" autocomplete="off"${af} /><datalist id="${esc(id)}-branches"></datalist>`;
    } else {
      control = `<input type="text" ${ctl} class="wi-compact" value="${esc(val)}"${af} />`;
    }
    const showIf = def.show_if ? ` data-wi-show-if="${esc(def.show_if)}"${evalCondition(def.show_if, context) ? '' : ' hidden'}` : '';
    const forAttr = k === 'pills' || k === 'multi' ? '' : ` for="${esc(id)}"`;
    const help = def.description ? `<div class="hint">${esc(def.description)}</div>` : '';
    return `<div class="field wi-field wi-kind-${k}" data-wi-key="${esc(key)}"${showIf}>`
      + `<label id="${esc(id)}-label"${forAttr}>${esc(label(key, def))}${def.required ? ' <span class="req">*</span>' : ''}<span class="wi-note"></span></label>`
      + `<div class="wi-control">${control}</div>${help}</div>`;
  }

  /**
   * The fields of `defs` ({ key: def }, in order). opts: values ({ key: value }; else each default),
   * id(key), attrs(key), context (values show_if reads besides these), autofocus (the first field).
   */
  function formHtml(defs, { values = {}, id = (k) => `wi-${k}`, attrs = () => '', context = {}, autofocus = false } = {}) {
    const entries = Object.entries(defs || {});
    const all = { ...context };
    for (const [k, def] of entries) all[k] = values[k] ?? def?.default ?? '';
    return entries.map(([k, def], n) => fieldHtml(k, def || {}, { value: all[k], id: id(k), attrs: attrs(k), context: all, autofocus: autofocus && n === 0 })).join('');
  }

  // ---- values ------------------------------------------------------------------------------
  /** The values of the fields under `root`: empty text left out (unless `all`), switches as booleans. */
  function read(rootEl, { all = false } = {}) {
    const out = {};
    if (!rootEl) return out;
    for (const el of rootEl.querySelectorAll('[data-wi-input]')) {
      const k = el.dataset.wiInput;
      if (el.type === 'checkbox') out[k] = el.dataset.wiFlag === 'text' ? String(el.checked) : el.checked;
      else {
        const v = String(el.value ?? '').trim();
        if (v !== '' || all) out[k] = v;
      }
    }
    return out;
  }

  const scopeOf = (el) => el?.closest?.('[data-wi-scope]') || el?.closest?.('form') || (typeof document !== 'undefined' ? document.body : null);

  /** Shows or hides the show_if fields under `scope` from the values in it (and its data-wi-context). */
  function refresh(scope) {
    if (!scope?.querySelectorAll) return;
    let context = {};
    try { context = JSON.parse(scope.dataset?.wiContext || '{}'); } catch { /* none */ }
    const values = { ...context, ...read(scope, { all: true }) };
    for (const f of scope.querySelectorAll('[data-wi-show-if]')) f.hidden = !evalCondition(f.dataset.wiShowIf, values);
  }

  /** Sets one input under `root` (a switch, the pills, a select or a box); `touched: false` for a prefill the owner did not make. */
  function set(rootEl, key, value, { touched = true } = {}) {
    const el = rootEl?.querySelector?.(`[data-wi-input="${cssEsc(key)}"]`);
    if (!el || value == null) return false;
    if (el.type === 'checkbox') el.checked = truthy(value);
    else el.value = String(value);
    const field = el.closest('.wi-field');
    if (field) {
      const chosen = el.dataset.wiMulti ? listOf(el.value) : [el.value];
      for (const b of field.querySelectorAll('[data-wi-pill]')) {
        const on = chosen.includes(b.dataset.wiPill);
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', String(on));
      }
      if (touched) field.dataset.wiTouched = '1';
    }
    refresh(scopeOf(el));
    return true;
  }

  /** The scope attributes of a container: show_if there also reads `context` (values not shown in it). */
  const scopeAttrs = (context = {}) => ` data-wi-scope data-wi-context="${esc(JSON.stringify(context))}"`;

  // #630: a workflow's auto | validated toggle: its `validation` input when it has one (feature, whose
  // `mode` is local | remote), else `mode`. `old`: an item saved before still says `mode: validated`,
  // read as that value. `context`: the toggle's value (or default) for show_if.
  const defaultWorkflow = () => (typeof module === 'object' && module.exports ? require('@multiagent/shared/default-workflow') : root.DefaultWorkflow);
  function modeInput(defs = {}, inputs = {}) {
    const key = defs.validation ? 'validation' : 'mode';
    const old = key === 'validation' && defaultWorkflow().VALIDATION.includes(inputs?.mode);
    const value = inputs?.[key] ?? (old ? inputs.mode : undefined);
    return { key, def: defs[key], value, old, context: { [key]: value ?? defs[key]?.default } };
  }

  /** The sentence an input's description gives one of its values ("Automatic: … . Validated: … ."), or ''. */
  function optionHint(def, value) {
    const name = optionLabel(def || {}, value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = String(def?.description || '').match(new RegExp(`(?:^|[.\\s])${name}:\\s*([^.]+)\\.`, 'i'));
    return m ? m[1].trim().replace(/^./, (c) => c.toUpperCase()) : '';
  }

  // ---- what the app knows about the project ---------------------------------------------------
  const HINTS_TTL = 30000;
  const hintsCache = new Map(); // project id -> { at, promise }
  function hintsOf(projectId) {
    const hit = hintsCache.get(projectId);
    if (hit && Date.now() - hit.at < HINTS_TTL) return hit.promise;
    const promise = root.api.projectInputHints(projectId);
    hintsCache.set(projectId, { at: Date.now(), promise });
    promise.catch(() => hintsCache.delete(projectId));
    return promise;
  }

  function note(field, text, title) {
    const slot = field.querySelector('.wi-note');
    if (slot) slot.innerHTML = text ? ` <span class="badge wi-badge" title="${esc(title)}">${esc(text)}</span>` : '';
  }

  /**
   * Prefills the fields under `rootEl` with the project's hints: `language` (when the workflow knows
   * the detected value) marked "detected", the local branches offered in `*branch` inputs and the
   * default branch set when the value is still empty or the workflow's default. Fields the owner
   * changed, and the keys in `keep` (remembered values), are left alone.
   */
  async function applyHints(rootEl, defs, projectId, { keep = [] } = {}) {
    if (!rootEl || !projectId || typeof root.api?.projectInputHints !== 'function') return;
    let h;
    try { h = await hintsOf(projectId); } catch { return; }
    if (!h) return;
    for (const [k, def = {}] of Object.entries(defs || {})) {
      const field = rootEl.querySelector(`.wi-field[data-wi-key="${cssEsc(k)}"]`);
      const el = field?.querySelector('[data-wi-input]');
      if (!el) continue;
      // several detected languages ("rust,js", #340): all of them for a multi-value input, else the main one
      const known = (def?.enum || []).map(String);
      const detected = listOf(h.language).filter((l) => known.includes(l));
      const hint = def?.multiple ? detected.join(',') : detected[0];
      if (k === 'language' && hint) {
        if (!field.dataset.wiTouched && !keep.includes(k)) set(rootEl, k, hint, { touched: false });
        note(field, el.value === hint ? 'detected' : '', "Detected from the project's files");
      }
      if (kind(k, def || {}) === 'branch') {
        const list = field.querySelector('datalist');
        if (list) list.innerHTML = (h.branches || []).map((b) => `<option value="${esc(b)}"></option>`).join('');
        const cur = String(el.value || '').trim();
        if (h.defaultBranch && !field.dataset.wiTouched && !keep.includes(k) && (cur === '' || cur === String(def?.default ?? ''))) set(rootEl, k, h.defaultBranch, { touched: false });
      }
      applyProjectDefault(rootEl, field, el, k, def, h.runDefaults, keep);
    }
  }

  // #735: the project's run defaults (projects:inputHints' `runDefaults`) come before the workflow's
  // own, after what the owner typed and the remembered values (`keep`); the field says "from the project".
  function applyProjectDefault(rootEl, field, el, k, def, defaults, keep) {
    if (!defaults || typeof defaults !== 'object' || !Object.prototype.hasOwnProperty.call(defaults, k)) return;
    const v = defaults[k];
    if (v == null || (Array.isArray(def?.enum) && !def.enum.map(String).includes(String(v)))) return;
    // a list in a one-line box: comma-separated (a text input drops line breaks; the engine splits on both)
    const value = Array.isArray(v) ? v.join(',') : v;
    if (!field.dataset.wiTouched && !keep.includes(k)) set(rootEl, k, value, { touched: false });
    const same = el.type === 'checkbox' ? el.checked === truthy(value) : String(el.value ?? '').trim() === String(value).trim();
    if (k !== 'language') note(field, same ? t('workflow_inputs.from_project') : '', t('workflow_inputs.from_project_title'));
  }

  // Pills and show_if work on every form, wired once (forms are redrawn with innerHTML).
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('click', (e) => {
      const b = e.target?.closest?.('[data-wi-pill]');
      const field = b?.closest('.wi-field');
      const input = field?.querySelector('[data-wi-input]');
      if (!input) return;
      if (input.dataset.wiMulti) {
        // a toggle adds its value at the end (the main one stays first); the last one stays on
        const chosen = listOf(input.value);
        const next = chosen.includes(b.dataset.wiPill) ? chosen.filter((v) => v !== b.dataset.wiPill) : [...chosen, b.dataset.wiPill];
        if (!next.length) return;
        set(field, input.dataset.wiInput, next.join(','));
      } else set(field, input.dataset.wiInput, b.dataset.wiPill);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    document.addEventListener('change', (e) => {
      const el = e.target?.closest?.('[data-wi-input]');
      if (!el) return;
      const field = el.closest('.wi-field');
      if (field) field.dataset.wiTouched = '1';
      refresh(scopeOf(el));
    });
  }

  const api = {
    applyHints,
    evalCondition,
    fieldHtml,
    formHtml,
    humanize,
    inputPills,
    isBoolean,
    kind,
    label,
    modeInput,
    optionHint,
    optionLabel,
    read,
    refresh,
    scopeAttrs,
    set,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkflowInputs = api;
})(typeof window !== 'undefined' ? window : globalThis);
