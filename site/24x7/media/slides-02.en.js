// Slide decks of chapter 2, in English (the same model as the "Diário do Orchestrator" decks): each
// <div class="deck" data-deck="name"> becomes a titled SVG slide with a description, arrows, dots
// and keyboard navigation. Everything is drawn here; the Markdown only places the empty divs.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const mono = 'IBM Plex Mono, ui-monospace, monospace';
  const sans = 'IBM Plex Sans, system-ui, sans-serif';
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const pen = (svg) => {
    const el = (t, a, txt) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (txt != null) e.textContent = txt; svg.appendChild(e); return e; };
    const text = (x, y, s, o = {}) => el('text', { x, y, 'font-size': o.size || 12, 'font-family': o.mono ? mono : sans, 'font-weight': o.bold ? 600 : 400, fill: o.fill || 'var(--d-ink)', 'text-anchor': o.anchor || 'start' }, s);
    const box = (x, y, w, h, o = {}) => el('rect', { x, y, width: w, height: h, rx: o.rx == null ? 6 : o.rx, fill: o.fill || 'var(--d-paper)', stroke: o.stroke || 'var(--d-rule)', 'stroke-width': o.sw || 1.2, 'stroke-dasharray': o.dash || '' });
    const arrow = (x1, y1, x2, y2, c = 'var(--d-muted)', dash = '') => {
      el('line', { x1, y1, x2, y2, stroke: c, 'stroke-width': 1.6, 'stroke-dasharray': dash });
      const a = Math.atan2(y2 - y1, x2 - x1), s = 7;
      el('path', { d: `M${x2},${y2}L${x2 - s * Math.cos(a - 0.45)},${y2 - s * Math.sin(a - 0.45)}L${x2 - s * Math.cos(a + 0.45)},${y2 - s * Math.sin(a + 0.45)}Z`, fill: c });
    };
    return { el, text, box, arrow };
  };
  const counters = (p, items) => {
    let x = 20;
    items.forEach(([k, v, c]) => { p.text(x, 288, k, { size: 11, fill: 'var(--d-muted)', mono: true }); const w = k.length * 6.8 + 8; p.text(x + w, 288, String(v), { size: 15, bold: true, fill: c || 'var(--d-ink)', mono: true }); x += w + String(v).length * 9 + 40; });
  };
  const chip = (p, x, y, w, label, bg, fg) => { p.box(x, y, w, 22, { fill: bg, stroke: fg, rx: 11 }); p.text(x + w / 2, y + 15, label, { size: 11, fill: fg, anchor: 'middle', bold: true }); };
  const file = (p, x, y, w, name, role, o = {}) => {
    p.box(x, y, w, 40, { stroke: o.stroke || 'var(--d-rule)', sw: o.stroke ? 2 : 1.2, fill: o.fill });
    p.text(x + 10, y + 17, name, { bold: true, size: 12 });
    p.text(x + 10, y + 32, role, { size: 10.5, fill: 'var(--d-muted)' });
  };
  const meter = (p, x, y, label, v, reason) => {
    p.text(x, y, label, { bold: true, size: 13 });
    for (let i = 0; i < 5; i++) p.box(x + i * 52, y + 12, 46, 22, { fill: i < v ? 'var(--d-accent)' : 'var(--d-paper)', stroke: i < v ? 'var(--d-accent)' : 'var(--d-rule)', rx: 4 });
    for (let i = 0; i < 5; i++) p.text(x + i * 52 + 23, y + 27, String(i + 1), { anchor: 'middle', mono: true, size: 11, bold: true, fill: i < v ? 'var(--d-paper)' : 'var(--d-muted)' });
    p.text(x, y + 56, reason, { size: 12, fill: 'var(--d-muted)' });
  };
  const SOFT = { accent: ['var(--d-soft-accent)', 'var(--d-accent)'], ok: ['var(--d-soft-ok)', 'var(--d-ok)'], bad: ['var(--d-soft-bad)', 'var(--d-bad)'], teal: ['var(--d-soft-teal)', 'var(--d-teal)'] };

  // ---- deck: the two validation modes
  const pipe = (p, y, stopAfter) => {
    const steps = ['develop', 'review', 'test', 'merge'];
    steps.forEach((s, i) => {
      const x = 30 + i * 160;
      p.box(x, y, 120, 44, { fill: i === 3 ? 'var(--d-soft-ok)' : 'var(--d-paper)', stroke: i === 3 ? 'var(--d-ok)' : 'var(--d-rule)' });
      p.text(x + 60, y + 27, s, { anchor: 'middle', bold: true, size: 13 });
      if (i < 3) p.arrow(x + 122, y + 22, x + 158, y + 22, stopAfter === i ? 'var(--d-rule)' : 'var(--d-muted)', stopAfter === i ? '3 3' : '');
    });
  };
  const screen = (p, x, y, label, withRepo) => {
    p.box(x, y, 250, 150, { fill: 'var(--d-paper)' });
    p.text(x + 12, y + 20, label, { bold: true, size: 12, fill: 'var(--d-muted)' });
    p.box(x + 12, y + 34, 226, 96, { fill: 'var(--d-bg)' });
    p.text(x + 24, y + 58, 'Buy coffee', { bold: true, size: 12 });
    p.text(x + 24, y + 78, 'to do', { size: 11, fill: 'var(--d-muted)' });
    if (withRepo) { p.box(x + 24, y + 92, 120, 24, { fill: 'var(--d-soft-accent)', stroke: 'var(--d-accent)', sw: 2, rx: 12 }); p.text(x + 84, y + 108, 'due: Oct 12', { anchor: 'middle', size: 11, bold: true, fill: 'var(--d-accent)' }); }
  };
  const modos = [
    { t: 'Automatic', d: 'The task goes from code to merge without stopping. It is for work with no screen: engine, tests, docs, refactoring. It is the night mode.', draw: (p) => {
      p.text(30, 70, 'A task with no screen', { bold: true, size: 13 });
      pipe(p, 100, -1);
      p.text(30, 190, 'Nobody needs to look halfway. The result is checked in the morning.', { size: 12, fill: 'var(--d-muted)' });
      counters(p, [['Stops for me:', 0, 'var(--d-ok)']]);
    } },
    { t: 'Validated', d: 'The workflow stops right after development. If the screen is not what I wanted, I find out before paying for review and tests.', draw: (p) => {
      p.text(30, 70, 'A screen change', { bold: true, size: 13 });
      pipe(p, 100, 0);
      p.box(148, 160, 120, 50, { fill: 'var(--d-soft-accent)', stroke: 'var(--d-accent)', sw: 2 });
      p.text(208, 181, 'stops here', { anchor: 'middle', bold: true, size: 12, fill: 'var(--d-accent)' });
      p.text(208, 199, 'I look at the screen', { anchor: 'middle', size: 11, fill: 'var(--d-accent)' });
      p.arrow(176, 158, 176, 148, 'var(--d-accent)');
      p.text(300, 190, 'Review and tests only run after my ok.', { size: 12, fill: 'var(--d-muted)' });
      counters(p, [['Stops for me:', 1, 'var(--d-accent)'], ['Review before the ok:', 'no']]);
    } },
    { t: 'Before and after, side by side', d: 'On the approval screen, every changed screen shows twice: how it was and how it is now. Approving becomes looking at the result.', draw: (p) => {
      screen(p, 40, 50, 'before', false);
      screen(p, 390, 50, 'after', true);
      p.arrow(296, 125, 384, 125, 'var(--d-accent)');
      counters(p, [['Changed screens:', 1], ['Lines I read:', 0, 'var(--d-ok)']]);
    } },
    { t: 'Run App', d: 'A button opens the new version of the app in one click, so I can try it right away. Then I approve it or send it back with a comment.', draw: (p) => {
      p.box(60, 40, 560, 200, { fill: 'var(--d-paper)' });
      p.text(80, 68, 'Approval: due date on tasks', { bold: true, size: 13 });
      p.text(80, 92, 'The workflow is waiting for you.', { size: 12, fill: 'var(--d-muted)' });
      p.box(80, 120, 150, 44, { fill: 'var(--d-accent)', stroke: 'var(--d-accent)' });
      p.text(155, 147, '▶  Run App', { anchor: 'middle', bold: true, size: 14, fill: 'var(--d-paper)' });
      p.box(250, 120, 120, 44); p.text(310, 147, 'Approve', { anchor: 'middle', bold: true, size: 13 });
      p.box(390, 120, 170, 44); p.text(475, 147, 'Request changes', { anchor: 'middle', bold: true, size: 13 });
      p.text(80, 200, 'It opens a copy of the app with the change, apart from the version I am using.', { size: 12, fill: 'var(--d-muted)' });
      counters(p, [['To try it:', '1 click', 'var(--d-ok)']]);
    } },
  ];

  // ---- deck: the PO's triage
  const FRASE = ['"I want to add a due date', 'to the tasks."'];
  const triagem = [
    { t: 'The sentence', d: 'I send a short sentence in the PO chat, the way I would talk to someone on the team.', draw: (p) => {
      p.text(620, 48, 'Me', { anchor: 'end', bold: true, size: 12, fill: 'var(--d-muted)' });
      p.box(150, 58, 470, 64, { fill: 'var(--d-soft-accent)', stroke: 'var(--d-accent)', rx: 14 });
      p.text(170, 85, FRASE[0], { size: 14, bold: true }); p.text(170, 106, FRASE[1], { size: 14, bold: true });
      p.box(40, 160, 300, 64, { fill: 'var(--d-soft-teal)', stroke: 'var(--d-teal)', rx: 14 });
      p.text(60, 186, 'Product Owner', { bold: true, size: 13, fill: 'var(--d-teal)' });
      p.text(60, 206, 'reading the backlog and the code…', { size: 12, fill: 'var(--d-teal)' });
      counters(p, [['Task in the backlog:', 'not yet']]);
    } },
    { t: 'Searches the code', d: 'It reads the code map, a summary of what each file does, and searches for the names the sentence uses. It reads only what it needs, because every file read costs.', draw: (p) => {
      p.text(30, 40, 'Code map', { bold: true, size: 13 });
      const rows = [['Task form', 'creates and edits a task', 1], ['Task card', 'shows the task in the list', 1], ['Tasks API', 'saves and reads tasks', 1], ['Backup', 'daily backup scheduler', 0], ['Login', 'signing in', 0]];
      rows.forEach(([n, r, hit], i) => file(p, 30, 52 + i * 44, 250, n, r, hit ? { stroke: 'var(--d-accent)', fill: 'var(--d-soft-accent)' } : {}));
      p.box(400, 70, 250, 60, { fill: 'var(--d-bg)' });
      p.text(414, 94, 'search: "task"', { mono: true, size: 12 });
      p.text(414, 114, 'search: "date"', { mono: true, size: 12 });
      p.arrow(398, 98, 284, 72, 'var(--d-accent)'); p.arrow(398, 102, 284, 116, 'var(--d-accent)'); p.arrow(398, 106, 284, 160, 'var(--d-accent)');
      counters(p, [['Files opened:', 3, 'var(--d-ok)'], ['Out of:', 'hundreds']]);
    } },
    { t: 'Measures', d: 'Complexity and impact, each from 1 to 5, with a one-line reason that points to the evidence.', draw: (p) => {
      meter(p, 40, 50, 'Complexity', 3, 'four files in two areas: screen and API');
      meter(p, 380, 50, 'Impact', 2, 'helps planning, but you can live without it');
      p.text(40, 170, '1 = one file, a few lines', { size: 11.5, fill: 'var(--d-muted)' });
      p.text(40, 188, '5 = engine, stored data or packaging', { size: 11.5, fill: 'var(--d-muted)' });
      p.text(380, 170, '1 = cosmetic', { size: 11.5, fill: 'var(--d-muted)' });
      p.text(380, 188, '5 = blocks, loses data or breaks a rule', { size: 11.5, fill: 'var(--d-muted)' });
      counters(p, [['Complexity:', 3], ['Impact:', 2]]);
    } },
    { t: 'Avoids duplicates', d: 'It searches for similar tasks, open and closed. If one already covers the request, it suggests adding to it. Here it found something else: a different task that touches the same card.', draw: (p) => {
      file(p, 30, 110, 210, 'New task', 'due date', { stroke: 'var(--d-accent)', fill: 'var(--d-soft-accent)' });
      p.text(330, 40, 'Backlog', { bold: true, size: 13 });
      const list = [['Export tasks as CSV', 'another request', 0], ['Priority on the task card', 'same card, another request', 1], ['Daily backup', 'another request', 0]];
      list.forEach(([n, r, hit], i) => file(p, 330, 52 + i * 56, 320, n, r, hit ? { stroke: 'var(--d-teal)', fill: 'var(--d-soft-teal)' } : {}));
      p.arrow(244, 130, 326, 128, 'var(--d-teal)');
      p.text(330, 236, 'Not a duplicate. A neighbor: worth running together.', { size: 12, bold: true, fill: 'var(--d-teal)' });
      counters(p, [['Duplicate:', 'no', 'var(--d-ok)'], ['Neighbor:', 'yes', 'var(--d-teal)']]);
    } },
    { t: 'Checks clarity', d: 'A score from 0 to 100%. Below 85%, the task does not go on the roadmap. It did not say whether the date is required: the PO assumes it is optional and records the question.', draw: (p) => {
      const L = 40, W = 600, y = 70, X = (v) => L + v / 100 * W;
      p.box(L, y, W, 30, { fill: 'var(--d-bg)', rx: 15 });
      p.el('rect', { x: L, y, width: X(90) - L, height: 30, rx: 15, fill: 'var(--d-ok)' });
      p.text(X(90) + 10, y + 20, '90%', { bold: true, size: 13, fill: 'var(--d-ok)' });
      p.el('line', { x1: X(85), x2: X(85), y1: y - 14, y2: y + 44, stroke: 'var(--d-ink)', 'stroke-width': 2, 'stroke-dasharray': '4 3' });
      p.text(X(85), y - 20, 'minimum to go in: 85%', { anchor: 'middle', size: 11.5, bold: true });
      p.box(40, 140, 600, 76, { fill: 'var(--d-soft-accent)', stroke: 'var(--d-accent)' });
      p.text(56, 164, 'Open question', { bold: true, size: 12, fill: 'var(--d-accent)' });
      p.text(56, 184, 'Is the due date required?', { size: 12.5 });
      p.text(56, 204, 'Assumed for now: optional.', { size: 12.5, fill: 'var(--d-muted)' });
      counters(p, [['Clarity:', '90%', 'var(--d-ok)'], ['Questions in the chat:', 'up to 2']]);
    } },
    { t: 'Estimates from data', d: 'Time and effort are not an AI guess. The app itself takes past runs of similar complexity, does the math and says how many runs it was based on.', draw: (p) => {
      const L = 60, W = 300, B = 230, X = (c) => L + (c - 1) / 4 * W;
      p.el('line', { x1: L, x2: L + W, y1: B, y2: B, stroke: 'var(--d-rule)' });
      [1, 2, 3, 4, 5].forEach((c) => p.text(X(c), B + 18, String(c), { anchor: 'middle', mono: true, size: 11, fill: 'var(--d-muted)' }));
      p.text(L, B + 36, 'complexity of past runs', { size: 11, fill: 'var(--d-muted)' });
      p.el('rect', { x: X(2) - 14, y: 40, width: X(4) - X(2) + 28, height: B - 44, rx: 8, fill: 'var(--d-soft-accent)' });
      const pts = [[1, 60], [1, 120], [2, 90], [2, 150], [2, 70], [3, 110], [3, 170], [3, 60], [4, 140], [4, 80], [5, 100], [5, 160], [2, 190], [1, 180], [3, 200]];
      pts.forEach(([c, y], i) => p.el('circle', { cx: X(c) + ((i * 7) % 15) - 7, cy: y, r: 6, fill: c >= 2 && c <= 4 ? 'var(--d-accent)' : 'var(--d-rule)' }));
      p.arrow(X(4) + 24, 130, 420, 130, 'var(--d-accent)');
      p.box(424, 90, 230, 84, { fill: 'var(--d-paper)', stroke: 'var(--d-accent)', sw: 2 });
      p.text(440, 114, 'Estimate', { bold: true, size: 13 });
      p.text(440, 136, 'based on: similar runs', { size: 12, fill: 'var(--d-muted)' });
      p.text(440, 156, '(complexity 2 to 4)', { size: 12, fill: 'var(--d-muted)' });
      counters(p, [['Who does the math:', 'the app', 'var(--d-ok)']]);
    } },
    { t: 'The finished task', d: 'It comes out written with context, acceptance criteria, the triage and the grouping advice. Nothing is saved without my click.', draw: (p) => {
      p.box(40, 24, 600, 236, { fill: 'var(--d-paper)' });
      p.text(58, 50, 'Due date on tasks', { bold: true, size: 14 });
      chip(p, 58, 62, 100, 'enhancement', ...SOFT.teal); chip(p, 166, 62, 110, 'complexity:3', ...SOFT.accent); chip(p, 284, 62, 90, 'impact:2', ...SOFT.accent); chip(p, 382, 62, 110, 'area:tasks', ...SOFT.teal);
      p.text(58, 112, 'Acceptance criteria', { bold: true, size: 12 });
      ['the form has an optional date field', 'the card shows the due date', 'a test covers tasks with and without a date'].forEach((s, i) => { p.box(58, 122 + i * 22, 12, 12, { rx: 2 }); p.text(78, 133 + i * 22, s, { size: 12 }); });
      p.text(58, 210, 'Triage: 4 files expected · run together with "Priority on the task card"', { size: 11.5, fill: 'var(--d-muted)' });
      p.box(520, 222, 104, 30, { fill: 'var(--d-accent)', stroke: 'var(--d-accent)' });
      p.text(572, 242, 'Save', { anchor: 'middle', bold: true, size: 12.5, fill: 'var(--d-paper)' });
      counters(p, [['Saved:', 'only with my click', 'var(--d-accent)']]);
    } },
  ];

  // ---- deck: placing the task on the roadmap
  const lane = (p, y, label) => { p.text(20, y + 26, label, { bold: true, size: 12 }); p.el('line', { x1: 90, x2: 670, y1: y + 56, y2: y + 56, stroke: 'var(--d-rule)' }); };
  const grp = (p, x, y, w, title, files, o = {}) => {
    p.box(x, y, w, 48, { stroke: o.stroke || 'var(--d-rule)', sw: o.stroke ? 2 : 1.2, fill: o.fill || 'var(--d-paper)', dash: o.dash || '' });
    p.text(x + 10, y + 19, title, { bold: true, size: 12, fill: o.stroke || 'var(--d-ink)' });
    p.text(x + 10, y + 36, files, { size: 10.5, fill: 'var(--d-muted)' });
  };
  const ACC = { stroke: 'var(--d-accent)', fill: 'var(--d-soft-accent)' };
  const encaixe = [
    { t: 'The roadmap before', d: 'There are tasks already planned, each with the files it should touch. The new task arrives from triage.', draw: (p) => {
      lane(p, 40, 'Stage 1'); lane(p, 140, 'Stage 2');
      grp(p, 100, 46, 230, 'Priority on the card', 'task card');
      grp(p, 340, 46, 200, 'Daily backup', 'scheduler');
      grp(p, 100, 146, 230, 'Export tasks as CSV', 'tasks API');
      grp(p, 440, 210, 230, 'New task: due date', 'form + card + API', ACC);
      counters(p, [['Stages:', 2]]);
    } },
    { t: 'Groups what belongs together', d: 'The due date and the priority touch the same card. They go into the same group and the same run: one conflict fewer and the context in one place.', draw: (p) => {
      lane(p, 40, 'Stage 1'); lane(p, 140, 'Stage 2');
      p.box(94, 34, 252, 122, { stroke: 'var(--d-teal)', sw: 2, dash: '5 3', fill: 'none' });
      p.text(104, 150, 'one group · one run', { size: 11, bold: true, fill: 'var(--d-teal)' });
      grp(p, 100, 40, 240, 'Priority on the card', 'task card');
      grp(p, 100, 84, 240, 'Due date', 'form + card + API', ACC);
      grp(p, 360, 46, 200, 'Daily backup', 'scheduler');
      grp(p, 100, 180, 230, 'Export tasks as CSV', 'tasks API');
      counters(p, [['Runs:', 2, 'var(--d-ok)'], ['If run separately:', 3, 'var(--d-muted)']]);
    } },
    { t: 'Separates what would clash', d: 'The export edits the same tasks API. It waits for stage 1 to finish, with the reason written on the roadmap.', draw: (p) => {
      lane(p, 40, 'Stage 1'); lane(p, 150, 'Stage 2');
      grp(p, 100, 40, 240, 'Card: priority + date', 'form + card + API', ACC);
      grp(p, 360, 46, 200, 'Daily backup', 'scheduler');
      grp(p, 100, 160, 240, 'Export tasks as CSV', 'tasks API', { stroke: 'var(--d-bad)', fill: 'var(--d-soft-bad)' });
      p.arrow(220, 92, 220, 156, 'var(--d-bad)', '4 3');
      p.text(232, 128, 'edits the same file: waits for stage 1', { size: 11.5, bold: true, fill: 'var(--d-bad)' });
      counters(p, [['Run together:', 'card · backup'], ['After:', 'export']]);
    } },
    { t: 'Picks the mode of each group', d: 'The card group is a screen change: it runs in Validated, so I look before paying for review and tests. The backup has no screen: it runs in Automatic.', draw: (p) => {
      lane(p, 40, 'Stage 1');
      grp(p, 100, 40, 240, 'Card: priority + date', 'form + card + API', ACC);
      grp(p, 360, 46, 200, 'Daily backup', 'scheduler');
      chip(p, 100, 120, 100, 'Validated', ...SOFT.accent); p.text(210, 136, '"it is a screen: look before paying for review and tests"', { size: 11.5, fill: 'var(--d-muted)' });
      chip(p, 100, 160, 100, 'Automatic', ...SOFT.ok); p.text(210, 176, '"no screen: runs until merged"', { size: 11.5, fill: 'var(--d-muted)' });
      counters(p, [['Each choice:', 'with its reason on the card']]);
    } },
    { t: 'The roadmap after', d: 'Stage 1 with two groups in parallel, because they share no file. Stage 2 with what had to wait. The PO proposes; I apply it in one click.', draw: (p) => {
      lane(p, 30, 'Stage 1'); lane(p, 130, 'Stage 2');
      grp(p, 100, 30, 240, 'Card: priority + date', 'Validated', ACC);
      grp(p, 360, 36, 200, 'Daily backup', 'Automatic');
      grp(p, 100, 136, 240, 'Export tasks as CSV', 'Automatic');
      p.box(500, 220, 160, 34, { fill: 'var(--d-accent)', stroke: 'var(--d-accent)' });
      p.text(580, 242, 'Add to roadmap', { anchor: 'middle', bold: true, size: 12.5, fill: 'var(--d-paper)' });
      counters(p, [['In parallel in stage 1:', 2, 'var(--d-ok)'], ['Stages:', 2]]);
    } },
  ];

  const DECKS = { modos, triagem, encaixe };

  function deck(root, slides) {
    root.innerHTML = '<div class="deck-head"><span class="deck-pos"></span><b class="deck-title"></b></div>'
      + '<svg viewBox="0 0 680 300" role="img"></svg><p class="deck-desc"></p>'
      + '<div class="deck-nav"><button type="button" class="deck-prev" aria-label="Previous slide">←</button><div class="deck-dots"></div><button type="button" class="deck-next" aria-label="Next slide">→</button></div>';
    root.tabIndex = 0; root.setAttribute('role', 'group'); root.setAttribute('aria-roledescription', 'slides');
    const svg = root.querySelector('svg'), title = root.querySelector('.deck-title'), desc = root.querySelector('.deck-desc'), pos = root.querySelector('.deck-pos'), dots = root.querySelector('.deck-dots');
    const prev = root.querySelector('.deck-prev'), next = root.querySelector('.deck-next');
    svg.setAttribute('aria-label', root.getAttribute('aria-label') || '');
    dots.innerHTML = slides.map((s, i) => `<button type="button" aria-label="Slide ${i + 1}: ${s.t}"></button>`).join('');
    let i = 0;
    function go(n) {
      i = Math.max(0, Math.min(slides.length - 1, n));
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      slides[i].draw(pen(svg));
      title.textContent = slides[i].t; desc.textContent = slides[i].d; pos.textContent = (i + 1) + ' / ' + slides.length;
      prev.disabled = i === 0; next.disabled = i === slides.length - 1;
      [...dots.children].forEach((d, k) => d.setAttribute('aria-current', k === i ? 'step' : 'false'));
      if (!reduce) { svg.classList.remove('fade'); svg.getBoundingClientRect(); svg.classList.add('fade'); }
    }
    prev.addEventListener('click', () => go(i - 1)); next.addEventListener('click', () => go(i + 1));
    [...dots.children].forEach((d, k) => d.addEventListener('click', () => go(k)));
    root.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { go(i + 1); e.preventDefault(); } if (e.key === 'ArrowLeft') { go(i - 1); e.preventDefault(); } });
    go(0);
  }
  document.querySelectorAll('.deck[data-deck]').forEach((root) => { const s = DECKS[root.dataset.deck]; if (s) deck(root, s); });
})();
