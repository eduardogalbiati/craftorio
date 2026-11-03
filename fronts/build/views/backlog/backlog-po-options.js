// Backlog › Product Owner drawer: the workflow options' two views (#431), on the "Plan with" row
// (#po-wf-row, markup in backlog.js; the options drawn by backlog-po.js with WorkflowInputs.formHtml's
// `groups`). The chevron (#po-wf-toggle) minimizes the options box (#po-workflow-options) to a one-line
// summary of the main options' values (#po-wf-summary, "Validation: Automatic · Unit tests: Write and
// run · …") and expands it again; "Show more options" (wf-more-toggle) opens the options that are not
// main. Both choices are the viewer's (localStorage, not per project). Neither changes a value: the
// hidden fields stay in the box, so a question still sends every value (backlog-po.js ask()).
// backlog-po.js calls apply() on each render and moreOpen() when it draws the options.
/* global t */
(() => {
  const MINIMIZED = 'po.wfOptions.minimized';
  const MORE = 'po.wfOptions.more';
  const memory = {}; // when localStorage is not available
  const remembered = (key) => {
    try { return localStorage.getItem(key) === '1'; } catch { return memory[key] === true; }
  };
  const remember = (key, on) => {
    memory[key] = on;
    try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* this session only */ }
  };
  const $ = (sel) => document.querySelector(sel);

  // a field's value by its label: the chosen pill(s), the select's option, On/Off, the text
  function valueText(field) {
    const input = field.querySelector('[data-wi-input]');
    if (!input) return '';
    if (input.type === 'checkbox') return t(input.checked ? 'workflow_inputs.on' : 'workflow_inputs.off');
    const pills = [...field.querySelectorAll('[data-wi-pill].active')].map((b) => b.textContent.trim());
    if (pills.length) return pills.join(' + ');
    const option = input.localName === 'select' ? [...input.querySelectorAll('option')].find((o) => o.value === input.value) : null;
    return String(option ? option.textContent : input.value ?? '').trim();
  }
  const labelText = (field) => {
    const label = field.querySelector('label[id]');
    return String(label?.childNodes?.[0]?.textContent ?? label?.textContent ?? '').trim();
  };

  /** "Automatic · Unit tests: Write and run · …": the shown fields outside "more options", by their labels. */
  function summary(box) {
    const fields = [...(box?.querySelectorAll('.wi-field[data-wi-key]') || [])]
      .filter((f) => !f.hidden && !f.closest('[data-testid="wf-more"]'));
    return fields.map((f) => {
      const value = valueText(f);
      // the run's mode leads by its value alone, as the owner reads it ("Automatic")
      return ['mode', 'validation'].includes(f.dataset.wiKey) && fields[0] === f ? value : `${labelText(f)}: ${value}`;
    }).filter(Boolean).join(' · ');
  }

  /** Minimized or expanded as the viewer left it; the chevron's state, tooltip and the summary. */
  function apply() {
    const box = $('#po-workflow-options');
    const toggle = $('#po-wf-toggle');
    const line = $('#po-wf-summary');
    if (!box || !toggle || !line) return;
    const min = remembered(MINIMIZED);
    box.hidden = min;
    toggle.hidden = !box.querySelector('[data-wi-input]');
    toggle.setAttribute('aria-expanded', String(!min));
    const tip = t(min ? 'backlog.show_the_workflow_options' : 'backlog.hide_the_workflow_options');
    toggle.title = tip;
    toggle.setAttribute('aria-label', tip);
    line.textContent = min ? summary(box) : '';
    line.title = line.textContent;
    line.hidden = !min;
  }

  document.addEventListener('click', (e) => {
    if (e.target?.closest?.('#po-wf-toggle')) {
      remember(MINIMIZED, !remembered(MINIMIZED));
      apply();
      return;
    }
    const link = e.target?.closest?.('[data-testid="wf-more-toggle"]');
    const box = link?.closest('#po-workflow-options');
    if (box) remember(MORE, window.WorkflowInputs.toggleMore(box));
  });

  window.BacklogPoOptions = {
    apply,
    moreOpen: () => remembered(MORE),
    summary,
  };
})();
