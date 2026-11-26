// One renderer for a workflow's inputs (#116), used wherever they are edited: the Backlog's Assign
// dialog, the Start drawer, the Roadmap item's Edit form. What it reads from an input definition:
// - `label` (else one derived from the key: base_branch → "Base branch"; a slug is never shown) and
//   `options` ({ value: label }, e.g. js → JavaScript; else derived from the value);
// - the control follows the input: a yes/no (`type: boolean`, or an enum of "false"/"true") is a
//   switch; an enum with `multiple: true` (#340, language "js,rust") a row of toggles (role group /
//   checkbox, the value comma-separated, the first chosen first, at least one kept on); an enum of
//   up to 5 short values is a row of pills (.seg); a longer enum a select (both show a saved value the
//   enum no longer offers but `options` names, #56); a
//   number a short box; a `*branch` input a text box with the project's local branches; text a box;
// - `show_if` ("mode == 'validated'"; `inputs.` optional, ==, !=, and, or, not, parentheses): the
//   field is hidden while it is false. A hidden input keeps its value (read() still returns it);
// - `description`: the muted help line under the control;
// - `group` and `main: true` (#431): drawn only when the host asks (formHtml's `groups`, the Product
//   Owner drawer): the fields under small group labels, the main ones before "Show more options".
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
// #785: resolved(defs, saved, runDefaults) gives each value and its source, formHtml's `sources` says
// it per field; differing / differHtml: the saved values that differ from the project's.
// #50: checksOf(given, runDefaults) is what a run's rule check runs (`check_command`, else the run defaults'
// `check_commands`) and checksHtml draws it, on the project's settings and in the Start panel; forgetHints(projectId)
// drops what hintsOf remembers (no id: all), after a save and when the Start panel opens.
// Browser: window.WorkflowInputs (pills and show_if wired once on the document); Node: module.exports.
(function (root) {
  const t = (...a) => (typeof module === 'object' && module.exports ? require('@craftorio/shared/i18n') : root.I18n)?.t(...a) ?? a[0];
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
    const defs = (workflow && localized(workflow))?.inputs || {}; // #41: labels and options in the interface language
    return Object.entries(inputs || {}).filter(([k, v]) => v != null && v !== '' && !skip.includes(k)).map(([k, v]) => {
      const def = defs[k] || {};
      const atDefault = def.default != null && String(def.default) === String(v);
      if (atDefault && !defaults) return '';
      const value = valueText(def, v);
      const tip = `${k}: ${v}${atDefault ? ' (the workflow default)' : ''}${def.description ? `\n${def.description}` : ''}`;
      return `<span class="badge wi-pill${atDefault ? ' wi-pill-default' : ''}" data-testid="input-pill" data-wi-pill="${esc(k)}" title="${esc(tip)}">${esc(label(k, def))}: ${esc(value)}</span>`;
    }).join('');
  }
  const isBoolean = (def = {}) => def.type === 'boolean' || (Array.isArray(def.enum) && def.enum.length === 2 && def.enum.map(String).sort().join() === 'false,true');
  const truthy = (v) => !['', 'false', '0', 'no', 'off', 'undefined', 'null'].includes(String(v ?? '').trim().toLowerCase());

  /** The items of a multi-value input's value: "rust, js" → ['rust', 'js']. */
  const listOf = (v) => [...new Set(String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean))];

  /** A value as people read it: On / Off, an option's label, "Rust + JavaScript"; a folder or a command as written. */
  function valueText(def = {}, v) {
    if (isBoolean(def) || typeof v === 'boolean') return t(truthy(v) ? 'workflow_inputs.on' : 'workflow_inputs.off');
    if (def.multiple) return listOf(v).map((x) => optionLabel(def, x)).join(' + ');
    if (Array.isArray(v)) return v.join(', ');
    return def.type && !Array.isArray(def.enum) ? String(v ?? '') : optionLabel(def, v);
  }

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
   * e.g. `name="k"`), context (the values show_if reads; hidden at once when false), autofocus,
   * source (#785: where the value comes from, a key of resolved()'s `sources`).
   */
  function fieldHtml(key, def = {}, { value, id = `wi-${key}`, attrs = '', context = {}, autofocus = false, source = null } = {}) {
    const k = kind(key, def);
    const val = value ?? def.default ?? '';
    const af = autofocus ? ' autofocus' : '';
    const ctl = `id="${esc(id)}" data-wi-input="${esc(key)}" data-testid="input-${esc(key)}" ${attrs}`;
    let control;
    if (k === 'switch') {
      const flag = def.type === 'boolean' ? 'bool' : 'text';
      control = `<label class="switch"><input type="checkbox" role="switch" ${ctl} data-wi-flag="${flag}" aria-labelledby="${esc(id)}-label"${truthy(val) ? ' checked' : ''}${af} /><span></span></label>`;
    } else if (k === 'pills') {
      control = `<span class="seg wi-pills" role="radiogroup" aria-labelledby="${esc(id)}-label">${choices(def, val).map((o, n) => {
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
      control = `<select ${ctl}${af}>${choices(def, val).map((o) => `<option value="${esc(o)}"${String(o) === String(val) ? ' selected' : ''}>${esc(optionLabel(def, o))}</option>`).join('')}</select>`;
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
    // outside the label: the label is the control's accessible name
    const from = sourceText(source) ? `<span class="wi-source" data-testid="workflow-input-source-${esc(key)}">${esc(sourceText(source))}</span>` : '';
    return `<div class="field wi-field wi-kind-${k}" data-wi-key="${esc(key)}"${showIf}>`
      + `<label id="${esc(id)}-label"${forAttr}>${esc(label(key, def))}${def.required ? ' <span class="req">*</span>' : ''}<span class="wi-note"></span></label>${from}`
      + `<div class="wi-control">${control}</div>${help}</div>`;
  }

  /**
   * The fields of `defs` ({ key: def }, in order). opts: values ({ key: value }; else each default),
   * id(key), attrs(key), context (values show_if reads besides these), autofocus (the first field).
   * #431 `groups: true` (the Product Owner drawer): the fields under their input's `group` label, the
   * `main: true` ones first and the rest in a .wi-more block behind a "Show more options" link (open
   * when `moreOpen`). Inputs with neither `group` nor `main`: the same markup as without `groups`.
   * #785 `sources` ({ key: source }, resolved()'s): each field says where its value comes from.
   */
  function formHtml(defs, { values = {}, id = (k) => `wi-${k}`, attrs = () => '', context = {}, autofocus = false, groups = false, moreOpen = false, sources = null } = {}) {
    const entries = Object.entries(defs || {});
    const all = { ...context };
    for (const [k, def] of entries) all[k] = values[k] ?? def?.default ?? '';
    const field = ([k, def], n) => fieldHtml(k, def || {}, { value: all[k], id: id(k), attrs: attrs(k), context: all, autofocus: autofocus && n === 0, source: sources?.[k] });
    if (!groups || !entries.some(([, d]) => d?.group || d?.main)) return entries.map(field).join('');
    const indexed = entries.map((e, n) => [e, n]);
    const main = indexed.filter(([[, d]]) => d?.main === true);
    const rest = indexed.filter(([[, d]]) => d?.main !== true);
    if (!main.length || !rest.length) return groupedHtml(indexed, field);
    return groupedHtml(main, field) + moreToggleHtml(moreOpen)
      + `<div class="wi-more" data-testid="wf-more"${moreOpen ? '' : ' hidden'}>${groupedHtml(rest, field)}</div>`;
  }
  // #431: [[entry, index]] drawn by group, the groups in the order of their first input; an input
  // without a group goes under "Other"
  function groupedHtml(list, field) {
    const byGroup = new Map();
    for (const item of list) {
      const g = String(item[0][1]?.group || '').trim() || t('workflow_inputs.other_group');
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(item);
    }
    return [...byGroup].map(([g, items]) => `<div class="wi-group-label" data-testid="wf-group-label">${esc(g)}</div>${items.map(([e, n]) => field(e, n)).join('')}`).join('');
  }
  const moreToggleHtml = (open) => `<button type="button" class="link wi-more-toggle" data-testid="wf-more-toggle" aria-expanded="${open}">${t(open ? 'workflow_inputs.show_fewer_options' : 'workflow_inputs.show_more_options')}</button>`;

  /** #431: opens or closes (`open`, else the other way) the "more options" of a grouped form under `rootEl`; returns whether open. */
  function toggleMore(rootEl, open) {
    const more = rootEl?.querySelector?.('[data-testid="wf-more"]');
    const link = rootEl?.querySelector?.('[data-testid="wf-more-toggle"]');
    if (!more) return false;
    const next = open ?? more.hasAttribute('hidden');
    more.hidden = !next;
    if (link) {
      link.setAttribute('aria-expanded', String(next));
      link.textContent = t(next ? 'workflow_inputs.show_fewer_options' : 'workflow_inputs.show_more_options');
    }
    return next;
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
  const defaultWorkflow = () => (typeof module === 'object' && module.exports ? require('@craftorio/shared/default-workflow') : root.DefaultWorkflow);
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

  // #28: a bundled workflow's own texts (an unmodified copy, origin default) in the interface language, for the Start
  // drawer: its description (projects.workflows_desc_<name>, the wizard's #23 keys), its stations
  // (workflow_texts.<name>_step_<id>) and its inputs (workflow_texts.<name>_<key>_label|_desc|_opt_<value>), names
  // snake_cased; the file's text in English or where the catalog lacks a key. A modified or custom one stays as it is.
  // #36: any workflow (a repository's own too) may name catalog keys: an input's `label_key`, `help_key` and
  // `options_key` (a prefix: <prefix>_<value>), a step's `display_key`; they win over the bundled copy's own keys, and
  // the file's text stays the English and the fallback. A workflow without bundled origin or keys stays as it is.
  const i18n = () => (typeof module === 'object' && module.exports ? require('@craftorio/shared/i18n') : root.I18n);
  const snake = (s) => String(s ?? '').replace(/\.ya?ml$/, '').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  // #41: `description_key` (metadata) names the description's key, as label_key does an input's
  const namesKeys = (wf) => !!wf.description_key || Object.values(wf.inputs || {}).some((d) => d && (d.label_key || d.help_key || d.options_key)) || (wf.steps || []).some((s) => s?.display_key);
  function localized(wf) {
    const I18n = i18n();
    const bundled = ['bundled', 'default'].includes(wf?.origin);
    if (!wf || wf.error || !I18n?.translated || !(bundled || namesKeys(wf))) return wf;
    const name = snake(wf.file || wf.name);
    const tr = (own, key, suffix) => (key ? I18n.translated(String(key), own) : bundled ? I18n.translated(`workflow_texts.${name}_${snake(suffix)}`, own) : own);
    const options = (key, def) => Object.fromEntries([...new Set([...(def.enum || []).map(String), ...Object.keys(def.options || {})])].map((v) => [v, tr(optionLabel(def, v), def.options_key && `${def.options_key}_${snake(v)}`, `${key}_opt_${v}`)]));
    return {
      ...wf,
      description: wf.description_key ? I18n.translated(String(wf.description_key), wf.description || '') : bundled ? I18n.translated(`projects.workflows_desc_${name}`, wf.description || '') : wf.description,
      steps: (wf.steps || []).map((s) => ({ ...s, display: tr(s.display || '', s.display_key, `step_${s.id}`) || s.display })),
      inputs: Object.fromEntries(Object.entries(wf.inputs || {}).map(([key, def]) => [key, {
        ...def,
        label: tr(label(key, def), def.label_key, `${key}_label`),
        ...(def.description ? { description: tr(def.description, def.help_key, `${key}_desc`) } : {}),
        ...(def.enum || def.options ? { options: options(key, def) } : {}),
      }])),
    };
  }

  /** #41: a run's step id → name (`stepNames`, recorded in English) with its workflow's localized names winning. */
  function stepNamesOf(stepNames, wf) {
    const own = Object.fromEntries((localized(wf)?.steps || []).filter((s) => s?.display).map((s) => [s.id, s.display]));
    return Object.keys(own).length ? { ...stepNames, ...own } : stepNames || null;
  }

  // ---- where a value comes from (#785) --------------------------------------------------------
  // The rule is packages/shared/run-inputs.js, the run's own, without what is typed: an item's saved
  // value (a blank one counts as not saved) > the project's run default (projects:inputHints'
  // `runDefaults`) > the workflow's default.
  const SOURCES = { project: 'workflow_inputs.from_project', roadmap: 'workflow_inputs.from_item', typed: 'workflow_inputs.from_item', workflow: 'workflow_inputs.from_workflow' };
  const sourceText = (source) => (SOURCES[source] ? t(SOURCES[source]) : '');
  const runInputs = () => (typeof module === 'object' && module.exports ? require('@craftorio/shared/run-inputs') : root.RunInputs);
  const choices = (def, v) => runInputs()?.choices(def, v) ?? def.enum; // a page without RunInputs: the enum alone
  const shownDefault = (...a) => runInputs().shownDefault(...a);
  const sameValue = (...a) => runInputs().sameValue(...a);

  /** Each input's value and where it comes from: { values, sources } for `saved` (an item's inputs). */
  const resolved = (defs, saved, runDefaults) => runInputs().resolveRunInputs({ roadmap: saved, project: runDefaults, workflow: { inputs: defs } });

  /** The saved inputs that differ from the project's value (a blank one too): what an old item's defaults hide. */
  const differing = (defs, saved, runDefaults) => Object.keys(saved || {}).filter((k) => {
    // an old `mode: validated` is the validation toggle's value, not a run mode against the project's
    if (k === 'mode' && modeInput(defs, saved).old) return false;
    const fromProject = defs?.[k] ? runInputs().projectValue(k, defs[k], runDefaults) : undefined;
    return fromProject !== undefined && !sameValue(saved[k], fromProject);
  });

  /** The notice of an item whose saved values differ from the project's, with its one action; '' with none. */
  function differHtml(keys, defs) {
    if (!keys?.length) return '';
    const list = keys.map((k) => label(k, defs?.[k])).join(', ');
    return `<div class="wi-differ small" role="note" data-testid="workflow-inputs-differ"><span>${esc(t('workflow_inputs.differ_from_project', { list }))}</span>`
      + `<button class="btn sm ghost" type="button" data-testid="workflow-inputs-use-project" data-wi-use-project>${esc(t('workflow_inputs.use_project_values'))}</button></div>`;
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

  function forgetHints(projectId) {
    if (projectId) hintsCache.delete(projectId);
    else hintsCache.clear();
  }

  // ---- the rule checks of a run (#50) ---------------------------------------------------------
  /** { off, commands, rewrites }: what the check runs for a `check_command` (blank: what was found). */
  function checksOf(given, runDefaults) {
    const own = String(given ?? '').trim();
    if (runInputs().checksOff(own)) return { off: true, commands: [], rewrites: [] };
    if (own) return { off: false, commands: [own], rewrites: [] };
    return { off: false, commands: runDefaults?.check_commands || [], rewrites: runDefaults?.check_rewrites || [] };
  }

  /** Those commands as one line (off, none found), and a line per command not run because it rewrites files. */
  function checksHtml({ off, commands, rewrites }) {
    if (off) return esc(t('workflow_inputs.checks_off'));
    const list = commands.length ? commands.map((c) => `<code class="mono">${esc(c)}</code>`).join(' · ') : esc(t('workflow_inputs.checks_none'));
    return [list, ...rewrites.map((r) => esc(t('workflow_inputs.checks_rewrites', { name: r.name, why: r.why })))].join('<br>');
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
        note(field, el.value === hint ? t('workflow_inputs.detected') : '', t('workflow_inputs.detected_title'));
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
    if (v == null || (Array.isArray(def?.enum) && !def.enum.map(String).includes(String(v)) && !runInputs()?.keptOption(def, v))) return;
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
    checksHtml,
    checksOf,
    differHtml,
    differing,
    evalCondition,
    fieldHtml,
    forgetHints,
    formHtml,
    hintsOf,
    humanize,
    inputPills,
    isBoolean,
    kind,
    label,
    localized,
    modeInput,
    optionHint,
    optionLabel,
    read,
    refresh,
    resolved,
    sameValue,
    scopeAttrs,
    set,
    shownDefault,
    sourceText,
    stepNamesOf,
    toggleMore,
    valueText,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkflowInputs = api;
})(typeof window !== 'undefined' ? window : globalThis);
