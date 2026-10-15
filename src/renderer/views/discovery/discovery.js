/* global api */
// Discovery board (#257, Plan & Design › Discovery): the upstream half of the kanban. The cards of
// the header's project that left the Inbox (src/discovery.js, the discovery: channels) in the
// board's columns Triage → Shape → Define → Ready (board.json), in the board's order. A card moves by
// drag and drop or with its "Move to…" menu (keyboard); its face shows the title, the type, the age
// in its column, the clarity score and the estimate when known, and its attachment and thread
// counts. Shape and Define show `n / limit` (the limit is edited in the column's header): a move
// past it asks first and the header turns amber, nothing is refused. Bug and hotfix cards run in the
// fast lane, the swimlane at the top, and may go from Triage straight to Define; another card that
// skips Shape asks first. Filters: type, tag, author, and a search over titles and documents.
// A card opens in a side panel: its document (Preview / Edit: Save / Cancel), acceptance criteria,
// attachments (drop to add), thread, version history (Open, Restore) and, in Shape, Open in
// Write & Review / AI Arena with the document as the input: the run started there is remembered
// (window.DiscoveryRuns, localStorage) and its document comes back as a new version and a thread
// entry when it finishes. Esc closes the menu, then the card.
// Clarity (#166): a card's badge is its score (`clarity 72%`, amber below the project's bar for its
// kind); the panel shows who scored it and when, and the missing points. A move to Ready below the
// bar is refused by the store: the board says why and the card offers "Grill me" (an interview in
// its thread: one question at a time, the answer written into the card) and "Move anyway" (a dialog
// that needs a reason, kept on the card). Above the columns: the ready forecast (nights of agent
// work in Ready at or above the bar, an estimate) and "Bar and night…" (the bar, one per type, the
// night's hours).
// The commitment point (#258, discovery-commit.js): a Ready card's panel offers "Commit to the
// backlog" (from 85% clarity; under it the button is disabled and the Clarity section lists the gaps
// with Grill me); the commit dialog files the issues the Product Owner proposed and the owner edited.
// The committed cards (the board's `committed`) leave the columns for the Committed list beside the
// board, each with its issues' delivery; a committed card's panel is read-only (it also opens from
// its issues' badge in the Backlog: window.DiscoveryActions.openCard) and offers "New card from this
// one": new learning is a new Inbox card linked to it, the committed card never returns to the board.
// Column automations (#259): a column with an automation (the board's columns[].on_enter: Shape
// offers AI Arena → Write & Review on the card's document, Ready the clarity check) shows it in its
// header with its mode; the button opens its settings (the pipeline, the mode Ask me / On / Off,
// saved at once). A move into an "Ask me" column opens the proposal (the pipeline, its cost estimate)
// with Run / Not now; "On" starts it with the move (a toast). A card whose automation runs shows
// Running… on its face until the result comes back (a version and a thread entry with the run and
// its cost, written by the service); the thread's run link opens the run.
// Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, state, api,
// errMsg, dateOf, confirmDialog, openModal, closeModal, showToast, selectRun), ncAgo (notification-center.js), markdownHtml (artifact-render.js),
// CurrentProject, ImageViewer, DiscoveryCardParts (views/inbox/inbox.js), DuoIssue (the document
// types' goals), openDuoForCard (views/duo/duo.js) and openArenaForCard (views/arena/arena.js).
(() => {
  const TYPES = ['idea', 'prd', 'rfc', 'bug', 'hotfix']; // the store's (discovery.TYPES)
  const FAST = ['bug', 'hotfix']; // the fast lane's types
  // the runs whose result comes back to a card, by the `source` it is recorded under
  const SOURCES = { 'ai-arena': 'AI Arena', 'write-review': 'Write & Review' };
  // the document type a card's type asks Write & Review and the AI Arena for (else free-form)
  const DOC_SKILL = { prd: 'prd-writing', rfc: 'rfc-writing' };
  const LS_RUNS = 'discovery.runs'; // run id → { projectId, cardId, source }, until the run ends
  const THREAD = '<svg class="inbox-clip" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>';
  const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>';
  const PENCIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>';
  const BOLT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 3 14h8l-1 8 10-12h-8z" /></svg>';
  // a column automation's modes (#259), as the settings dialog names them
  const AUTOMATION_MODES = { ask: 'Ask me', on: 'On', off: 'Off' };

  // menu: the card whose "Move to…" menu is open; wipEdit: the column whose limit is being edited;
  // drag: the card being dragged; open: the opened card (of the project openProject) with its
  // thread and versions; viewing: the version shown ({ name, text }); previews: "<card id>/<name>" →
  // what discovery:attachment returned; recording: the runs whose result is being recorded;
  // refused: the card whose move to Ready the clarity bar refused ({ id, text }); override: the card
  // the "Move anyway" dialog is open for ({ id, projectId }); committed: the committed cards with
  // their delivery (#258, the board's `committed`); proposal (#259): the automation proposed for a
  // moved card ({ id, title, column, kind, name, estimate, projectId }), proposing while its Run is
  // in flight; automationCol: the column whose automation settings are open
  const dv = {
    automationCol: null, proposal: null, proposing: false,
    committed: [],
    refused: null, override: null,
    projectId: null, board: null, cards: [], loadError: '', error: '', seq: 0,
    filter: { type: '', tag: '', author: '', q: '' }, searchTimer: null,
    menu: null, wipEdit: null, wipSaving: false, drag: null,
    open: null, openProject: null, thread: [], versions: [], viewing: null, tab: 'preview', editAcceptance: false,
    previews: new Map(), openSeq: 0, acting: false, recording: new Set(),
  };

  const parts = () => window.DiscoveryCardParts;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  // a textarea gives its text with \n line ends, whatever the file has
  const lines = (s) => String(s ?? '').replace(/\r\n/g, '\n');
  const isFast = (c) => FAST.includes(c.type);
  // the board's columns: the Inbox column is the Inbox screen's
  const columns = () => (dv.board?.columns || []).filter((c) => c.id !== 'inbox');
  const columnOf = (id) => columns().find((c) => c.id === id) || null;
  const cardOf = (id) => dv.cards.find((c) => c.id === id) || null;
  // #258: a committed card is off the board, in the Committed list; its panel is read-only
  const commit = () => window.DiscoveryCommit;
  const committedOf = (id) => dv.committed.find((c) => c.id === id) || null;
  const readOnly = () => dv.open?.column === 'committed';
  // the clarity bar of a card's type (#166: the board's clarity { bar, byKind }), and a card under it
  const barOf = (c) => dv.board?.clarity?.byKind?.[c.type] ?? dv.board?.clarity?.bar ?? 85;
  const belowBar = (c) => !(typeof c.clarity?.score === 'number' && c.clarity.score >= barOf(c));
  // the store's refusal of a move into Ready below the bar (src/discovery.js)
  const REFUSED = /below the clarity bar/i;

  // The cards of a column in the board's order (a card the board does not list goes last).
  function cardsIn(column) {
    const order = dv.board?.order?.[column] || [];
    const at = (c) => { const i = order.indexOf(c.id); return i < 0 ? order.length : i; };
    return dv.cards.filter((c) => c.column === column).sort((a, b) => at(a) - at(b));
  }

  // Since when the card is in its column: its last move there, or its creation.
  const since = (c) => (c.history || []).findLast((h) => h.to === c.column)?.ts || c.created;
  function age(iso) {
    const min = Math.floor(Math.max(0, Date.now() - Date.parse(iso)) / 60000);
    if (!Number.isFinite(min)) return '';
    if (min < 1) return 'now';
    if (min < 60) return `${min} min`;
    return min < 1440 ? `${Math.floor(min / 60)} h` : `${Math.floor(min / 1440)} d`;
  }

  function matches(c) {
    const f = dv.filter;
    if (f.type && c.type !== f.type) return false;
    if (f.tag && !(c.tags || []).includes(f.tag)) return false;
    if (f.author && c.author !== f.author) return false;
    const q = f.q.trim().toLowerCase();
    return !q || `${c.title}\n${c.document || ''}`.toLowerCase().includes(q);
  }

  // ---- the board ----------------------------------------------------------------------------------
  async function refresh() {
    const seq = ++dv.seq;
    const projectId = window.CurrentProject?.get() || null;
    if (projectId !== dv.projectId) {
      // another project: its own board; the open card goes with its project, unless an edit with
      // changes holds it (it is saved to its own project, openProject)
      Object.assign(dv, { board: null, cards: [], committed: [], menu: null, wipEdit: null, refused: null });
      if (dv.open && (documentDirty() || acceptanceDirty())) detailError('This card belongs to the project chosen before: save or cancel the edit first.');
      else if (dv.open) closeCard();
    }
    dv.projectId = projectId;
    let board = null;
    let cards = [];
    let error = '';
    if (projectId) {
      try { [board, cards] = await Promise.all([api.discoveryBoard(projectId), api.listDiscoveryCards(projectId)]); } catch (e) { error = errMsg(e); }
    }
    if (seq !== dv.seq) return; // a newer refresh answers
    dv.board = board;
    dv.loadError = error;
    dv.cards = (cards || []).filter((c) => columnOf(c.column));
    dv.committed = board?.committed || [];
    const here = !!dv.open && dv.openProject === projectId;
    const open = here && (cardOf(dv.open.id) || committedOf(dv.open.id));
    // the open card left the board (archived, merged, back in the Inbox)
    if (here && !open && !error) closeCard();
    if (open) {
      const was = dv.open.column;
      Object.assign(dv.open, { column: open.column, type: open.type, clarity: open.clarity, links: open.links });
      // committed meanwhile: its panel turns read-only
      if (was !== open.column && readOnly()) renderDetail();
      renderActions();
      renderClarity();
    }
    fillFilters();
    render();
  }

  // The tag and author filters list what the board's cards have; a value that is gone is dropped.
  function fillFilters() {
    const fill = (sel, key, all, values) => {
      if (!values.includes(dv.filter[key])) dv.filter[key] = '';
      $(sel).innerHTML = `<option value="">${all}</option>${values.map((v) => `<option value="${esc(v)}"${v === dv.filter[key] ? ' selected' : ''}>${esc(v)}</option>`).join('')}`;
    };
    fill('#dsc-filter-tag', 'tag', 'All tags', [...new Set(dv.cards.flatMap((c) => c.tags || []))].sort());
    fill('#dsc-filter-author', 'author', 'All authors', [...new Set(dv.cards.map((c) => c.author).filter(Boolean))].sort());
  }

  function cardHtml(c) {
    const files = c.attachments?.length || 0;
    const notes = Number(c.threadCount) || 0;
    const score = c.clarity?.score;
    const { usd, minutes } = c.estimate || {};
    // from an hour on, in hours: what the ready forecast counts in
    const time = minutes == null ? '' : minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 6) / 10} h`;
    const estimate = [usd != null ? `$${Number(usd).toFixed(2)}` : '', time].filter(Boolean).join(' · ');
    const menu = dv.menu === c.id;
    const bar = barOf(c);
    const override = c.column === 'ready' ? c.clarity?.override : null;
    return `
      <article class="dsc-card${dv.open?.id === c.id ? ' active' : ''}" data-testid="discovery-card" data-card="${esc(c.id)}" data-type="${esc(c.type)}" data-column="${esc(c.column)}" draggable="true">
        <button type="button" class="dsc-card-title" data-testid="discovery-card-title" data-open="${esc(c.id)}" title="${esc(c.title)}">${esc(c.title)}</button>
        <div class="dsc-card-foot">
          <div class="dsc-card-meta muted small">
            <span class="badge dsc-type" data-testid="discovery-card-type">${esc(c.type)}</span>
            <span data-testid="discovery-card-age" title="In ${esc(columnOf(c.column)?.title || c.column)} since ${esc(dateOf(since(c)))}">${esc(age(since(c)))}</span>
            ${score != null ? `<span class="badge${score < bar ? ' warn' : ''}" data-testid="clarity-badge" title="${esc(score < bar ? `Needs grilling: below the clarity bar of ${bar}%` : `At or above the clarity bar of ${bar}%`)}"><span data-testid="discovery-card-clarity">clarity ${esc(score)}%</span></span>` : ''}
            ${override ? `<span class="badge warn" data-testid="clarity-override" title="${esc(`Moved to Ready below the clarity bar: ${override.reason}`)}">moved anyway</span>` : ''}
            ${c.automation?.state === 'running' ? `<span class="badge live dsc-auto-badge" data-testid="discovery-card-automation" title="${esc(`${c.automation.name || 'The automation'} is running (run ${c.automation.runId || '…'}): its result comes back to the card`)}">Running…</span>` : ''}
            ${estimate ? `<span data-testid="discovery-card-estimate" title="Estimate">${esc(estimate)}</span>` : ''}
            <span class="inbox-card-files" data-testid="discovery-card-attachments" title="${esc(plural(files, 'attachment'))}">${parts().CLIP} ${files}</span>
            <span class="inbox-card-files" data-testid="discovery-card-thread" title="${esc(`${notes} in the thread`)}">${THREAD} ${notes}</span>
          </div>
          <span class="bl-menu-wrap dsc-move">
            <button type="button" class="btn sm ghost" data-testid="card-move" data-move-menu="${esc(c.id)}" aria-haspopup="menu" aria-expanded="${menu}" title="Move this card to another column">Move to…</button>
            ${menu ? `<div class="bl-menu dsc-menu" role="menu" aria-label="Move to">
              ${columns().filter((col) => col.id !== c.column).map((col) => `<button type="button" role="menuitem" data-move-to="${esc(col.id)}" data-card="${esc(c.id)}">${esc(col.title)}</button>`).join('')}
            </div>` : ''}
          </span>
        </div>
        ${dv.refused?.id === c.id ? `<div class="dsc-card-refused" role="group" aria-label="Below the clarity bar">
          <button type="button" class="btn sm" data-testid="grill-me" data-grill="${esc(c.id)}" title="An interview in the card's thread: one question at a time, each answer written into the card">Grill me</button>
          <button type="button" class="btn sm warn-ghost" data-testid="clarity-move-anyway" data-move-anyway="${esc(c.id)}" title="To Ready below the bar: needs a reason, kept on the card">Move anyway</button>
        </div>` : ''}
      </article>`;
  }

  // The ready work (#166, the board's forecast): nights and agent hours of the Ready cards at or
  // above the bar, labelled as the estimate it is, then the bar and the night it counts with.
  function forecastHtml() {
    const f = dv.board.forecast;
    const s = dv.board.clarity;
    if (!f || !s) return '';
    const loose = f.unestimated ? `; ${plural(f.unestimated, 'card')} not estimated` : '';
    const [head, detail] = !f.count ? ['Nothing ready yet', 'an estimate from the cards in Ready at or above the clarity bar']
      : !f.hours ? [`${plural(f.count, 'card')} ready`, 'no estimate of their agent work yet']
        : [`${plural(f.nights, 'night')} ready`, `about ${f.hours} h of agent work, an estimate${loose}`];
    const kinds = Object.entries(s.byKind || {}).map(([k, v]) => `${k} ${v}%`).join(', ');
    return `
        <div class="dsc-forecast">
          <span data-testid="ready-forecast" title="${esc(`${plural(f.count, 'card')} in Ready at or above the clarity bar; a night is ${f.nightHours} h`)}"><b>${esc(head)}</b> <span class="muted">(${esc(detail)})</span></span>
          <span class="muted small" data-testid="clarity-bar-summary">Clarity bar ${esc(s.bar)}%${kinds ? ` (${esc(kinds)})` : ''} · night ${esc(s.night.start)} to ${esc(s.night.end)}</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm ghost" data-testid="clarity-settings" data-clarity-settings title="Change the clarity bar, a bar per type and the night's hours">Bar and night…</button>
        </div>`;
  }

  // A column: its title, its count (every card it holds, the fast lane's too; `n / limit` with a WIP
  // limit, amber past it) and its cards outside the fast lane.
  function columnHtml(c, i, list) {
    const n = list.length;
    const over = c.wip != null && n > c.wip;
    const count = c.wip == null
      ? `<span class="badge dsc-count" data-testid="discovery-column-count" title="${esc(plural(n, 'card'))}">${n}</span>`
      : `<span class="badge dsc-count${over ? ' warn' : ''}" data-testid="discovery-column-count" title="${esc(`${plural(n, 'card')}, WIP limit ${c.wip}${over ? ': over the limit' : ''}`)}">${n} / ${esc(c.wip)}</span>
          <button type="button" class="icon-btn dsc-wip-edit" data-testid="discovery-wip-edit" data-column="${esc(c.id)}" aria-label="Change the WIP limit of ${esc(c.title)}" title="Change the WIP limit">${PENCIL}</button>`;
    const editor = `<span class="dsc-wip-form">
          <span class="muted small">${n} /</span>
          <input type="number" class="dsc-wip-input" data-wip-input="${esc(c.id)}" min="1" step="1" value="${esc(c.wip)}" aria-label="WIP limit of ${esc(c.title)}" title="Enter saves, Esc cancels" />
        </span>`;
    // the column's automation (#259): its mode on the button, the rest in its settings
    const auto = c.on_enter;
    const mode = auto ? (AUTOMATION_MODES[auto.mode] ? auto.mode : 'ask') : null;
    const automation = !auto ? '' : `<button type="button" class="btn sm ghost dsc-auto-btn" data-testid="discovery-column-automation" data-column="${esc(c.id)}" data-mode="${esc(mode)}" aria-label="${esc(`Automation of ${c.title}: ${auto.name || auto.pipeline || auto.workflow || 'automation'}, ${AUTOMATION_MODES[mode]}`)}" title="${esc(`Entering ${c.title} ${mode === 'off' ? 'runs nothing' : mode === 'on' ? 'runs' : 'proposes'} ${auto.name || auto.pipeline || auto.workflow || 'an automation'}${mode === 'off' ? ` (${auto.name || 'the automation'} is off)` : ''}: change it`)}">${BOLT}<span class="dsc-auto-mode">Automation: ${esc(AUTOMATION_MODES[mode])}</span></button>`;
    return `
      <section class="dsc-col" data-testid="discovery-column" data-column="${esc(c.id)}" data-drop="${esc(c.id)}"${over ? ' data-over-wip="true"' : ''} style="grid-column:${i + 1}" aria-label="${esc(c.title)}">
        <header class="dsc-col-head">
          <h3 data-testid="discovery-column-title">${esc(c.title)}</h3>
          ${automation}
          ${dv.wipEdit === c.id ? editor : count}
        </header>
        <div class="dsc-col-body">${list.filter((x) => !isFast(x) && matches(x)).map(cardHtml).join('')}</div>
      </section>`;
  }

  function render() {
    $('#dsc-error').textContent = [dv.loadError, dv.error].filter(Boolean).join(' ');
    $('#dsc-refused').textContent = dv.refused?.text || '';
    const box = $('#dsc-board-box');
    if (!dv.projectId) {
      box.innerHTML = '<div class="empty-state"><b>No project chosen</b><p class="muted">Choose a project in the header: each project has its own Discovery board.</p></div>';
      return;
    }
    if (!dv.board) { box.innerHTML = dv.loadError ? '' : '<p class="muted small">Loading the board…</p>'; return; }
    const cols = columns();
    const lists = cols.map((c) => cardsIn(c.id));
    const shown = dv.cards.filter(matches).length;
    const note = !dv.cards.length
      ? '<p class="muted small dsc-note" data-testid="discovery-empty">No card on the board yet. Accept an idea in the Inbox: it lands in Triage.</p>'
      : shown < dv.cards.length ? `<p class="muted small dsc-note">${shown} of ${plural(dv.cards.length, 'card')} shown: the filters hide the others.</p>` : '';
    // the Committed list sits beside the columns once a card was committed (#258)
    const committed = commit().committedHtml(dv.committed, dv.open?.id);
    box.innerHTML = `${note}
      <div data-testid="discovery-board">${forecastHtml()}
        ${committed ? '<div class="dsc-board-row">' : ''}
        <div class="dsc-board" style="--dsc-cols:${cols.length}">
          <section class="dsc-lane" data-testid="discovery-fast-lane" aria-label="Fast lane: bugs and hotfixes">
            <h3 class="dsc-lane-title">Fast lane <span class="muted">bugs and hotfixes · may skip Shape</span></h3>
            ${cols.map((c, i) => `<div class="dsc-lane-cell" data-testid="discovery-lane-cell" data-drop="${esc(c.id)}" aria-label="Fast lane, ${esc(c.title)}">${lists[i].filter((x) => isFast(x) && matches(x)).map(cardHtml).join('')}</div>`).join('')}
          </section>
          ${cols.map((c, i) => columnHtml(c, i, lists[i])).join('')}
        </div>
        ${committed ? `${committed}</div>` : ''}
      </div>`;
  }

  const focusMove = (id) => document.querySelector(`[data-move-menu="${id}"]`)?.focus({ preventScroll: true });

  function onBoardClick(e) {
    const auto = e.target.closest('[data-testid="discovery-column-automation"]');
    if (auto) { openAutomationSettings(auto.dataset.column); return; }
    const wip = e.target.closest('[data-testid="discovery-wip-edit"]');
    if (wip) {
      Object.assign(dv, { wipEdit: wip.dataset.column, menu: null });
      render();
      document.querySelector('[data-wip-input]')?.focus({ preventScroll: true });
      return;
    }
    const to = e.target.closest('[data-move-to]');
    if (to) {
      dv.menu = null;
      render();
      requestMove(to.dataset.card, to.dataset.moveTo);
      return;
    }
    const menu = e.target.closest('[data-move-menu]');
    if (menu) {
      const id = menu.dataset.moveMenu;
      dv.menu = dv.menu === id ? null : id;
      render();
      if (dv.menu) document.querySelector('.dsc-menu [role="menuitem"]')?.focus({ preventScroll: true });
      else focusMove(id);
      return;
    }
    const grill = e.target.closest('[data-grill]');
    if (grill) { grillFromBoard(grill.dataset.grill); return; }
    const anyway = e.target.closest('[data-move-anyway]');
    if (anyway) { openOverride(anyway.dataset.moveAnyway); return; }
    if (e.target.closest('[data-clarity-settings]')) { openClaritySettings(); return; }
    const open = e.target.closest('[data-open]');
    if (open) openCard(open.dataset.open);
  }

  // A click anywhere else closes the open "Move to…" menu.
  function onOutsideClick(e) {
    if (!dv.menu || e.target.closest?.('.dsc-move')) return;
    dv.menu = null;
    render();
  }

  // ---- moving a card ------------------------------------------------------------------------------
  // from before Shape to after it, without stopping there
  function skipsShape(from, to) {
    const ids = (dv.board?.columns || []).map((c) => c.id);
    const shape = ids.indexOf('shape');
    return shape >= 0 && ids.indexOf(from) < shape && ids.indexOf(to) > shape;
  }

  /**
   * Moves a card to a column (at `index` among its other cards, else last), or within its column.
   * A move past the column's WIP limit, or one that skips Shape with a card that is not in the fast
   * lane, asks first. Only the store refuses, a move into Ready below the clarity bar (#166): the
   * card stays, the board says why and the card offers "Grill me" and "Move anyway".
   */
  async function requestMove(id, column, index) {
    const card = cardOf(id);
    const col = columnOf(column);
    const projectId = dv.projectId;
    if (!card || !col) return;
    const order = dv.board.order?.[column] || [];
    if (card.column === column) {
      // dropped where it already is
      if (index === undefined || order.indexOf(id) === index) return;
    } else {
      const n = cardsIn(column).length;
      const why = [];
      if (col.wip != null && n >= col.wip) why.push(`${col.title} is at its WIP limit (${n} / ${col.wip}).`);
      if (!isFast(card) && skipsShape(card.column, column)) why.push('This card skips Shape: only bugs and hotfixes take the fast lane.');
      if (why.length && !(await confirmDialog(`Move to ${col.title}`, `${why.join(' ')} Move "${card.title}" there anyway?`, 'Move anyway'))) return;
    }
    if (projectId !== dv.projectId) return; // another project was chosen while the question was open
    Object.assign(dv, { error: '', refused: null });
    let moved = null;
    try { moved = await api.moveDiscoveryCard(projectId, id, column, index); } catch (e) {
      const msg = errMsg(e);
      if (REFUSED.test(msg)) dv.refused = { id, text: `"${card.title}" stays in ${columnOf(card.column)?.title || card.column}. ${msg}` };
      else dv.error = msg;
    }
    await refresh();
    focusMove(id);
    // the move kept a version of the open card's document
    if (dv.open?.id === id) reloadHistory();
    afterMove(moved, { id, title: card.title, column, projectId });
  }

  // ---- column automations (#259) ------------------------------------------------------------------
  // What the move started (the move's `automation`): a proposal to answer, a run to tell about, or a
  // start that failed (the move is done).
  function afterMove(moved, { id, title, column, projectId }) {
    const a = moved?.automation;
    if (!a || !a.status) return;
    const where = columnOf(column)?.title || column;
    if (a.status === 'proposed') openProposal({ id, title, column, projectId, kind: a.kind, name: a.name, estimate: a.estimate, error: a.error });
    else if (a.status === 'running') showToast(`${a.name || 'The automation'} started`, `On "${title}", entering ${where}. Its result comes back to the card.`, a.runId || null);
    else if (a.status === 'done') showToast(`${a.name || 'The automation'} done`, a.question ? `A question waits for you in the thread of "${title}".` : `On "${title}", entering ${where}.`);
    else if (a.status === 'failed') {
      dv.error = `${a.name || 'The automation'} could not start on "${title}": ${a.error || 'unknown error'}`;
      render();
    }
  }

  // "Estimated cost: ≈ $1.20 (…)" from the proposal's estimate (chain-model estimateCost's shape:
  // costUsd from past runs, null without any; a simulation costs nothing).
  function estimateLine(est) {
    const usd = typeof est?.costUsd === 'number' ? est.costUsd : typeof est?.usd === 'number' ? est.usd : null;
    if (usd == null) return `No cost estimate yet${est?.text ? `: ${est.text}` : ': no past runs to estimate from'}.`;
    const basis = (est.items || []).reduce((n, i) => n + (Number(i.basis) || 0), 0) || Number(est.runs) || 0;
    const detail = est.simulated ? 'simulated run: the mock provider costs nothing' : basis ? `an estimate from ${plural(basis, 'past run')}` : 'an estimate';
    return `Estimated cost: ≈ $${usd.toFixed(2)} (${detail}).`;
  }

  // The proposal of an "Ask me" column: the owner runs it or not; nothing runs by itself. Docked in a
  // corner, not modal: the board stays usable, and the next move's proposal replaces an ignored one.
  function openProposal(p) {
    dv.proposal = p;
    const where = columnOf(p.column)?.title || p.column;
    $('#dsc-proposal-title').textContent = `Run the automation of ${where}?`;
    $('#dsc-proposal-what').textContent = `${p.name || 'The automation'} on "${p.title}", which entered ${where}.`;
    $('#dsc-proposal-estimate').textContent = estimateLine(p.estimate);
    $('#dsc-proposal-hint').textContent = p.kind === 'check'
      ? 'It asks the card\'s next open point in its thread, one question at a time; each answer is yours and is written into the card. No model, no run.'
      : 'Its result becomes a new version of the card\'s document, with the run and its cost in the thread. Every gate of the run waits for you; the card never moves by itself.';
    $('#dsc-proposal-error').textContent = p.error || '';
    $('#btn-dsc-proposal-run').disabled = !!p.error;
    openModal('#dsc-proposal-modal');
    $('#btn-dsc-proposal-run').focus({ preventScroll: true });
  }

  function closeProposal() {
    dv.proposal = null;
    closeModal('#dsc-proposal-modal');
  }

  async function runProposal(e) {
    e?.preventDefault?.();
    const p = dv.proposal;
    if (!p || dv.proposing) return;
    dv.proposing = true;
    $('#btn-dsc-proposal-run').disabled = true;
    try {
      const out = await api.runDiscoveryAutomation(p.projectId, p.id, p.column);
      closeProposal();
      const where = columnOf(p.column)?.title || p.column;
      if (out?.runId) showToast(`${out.name || p.name || 'The automation'} started`, `On "${p.title}", entering ${where}. Its result comes back to the card.`, out.runId);
      else showToast(`${out?.name || p.name || 'The automation'} done`, out?.question ? `A question waits for you in the thread of "${p.title}".` : `On "${p.title}".`);
    } catch (err) {
      $('#dsc-proposal-error').textContent = errMsg(err);
      $('#btn-dsc-proposal-run').disabled = false;
    } finally {
      dv.proposing = false;
    }
    if (dv.proposal === null) {
      await refresh();
      if (dv.open?.id === p.id) reloadCard().catch((err) => detailError(errMsg(err)));
    }
  }

  // The column's automation settings: what runs, and the mode (saved at once).
  function openAutomationSettings(column) {
    const col = columnOf(column);
    const auto = col?.on_enter;
    if (!auto) return;
    dv.automationCol = column;
    const file = auto.pipeline || auto.workflow || '';
    const what = auto.check ? `Entering ${col.title} runs the clarity check: it asks the card's open points in its thread, one question at a time, each answer yours. No model, no run.`
      : `Entering ${col.title} runs ${auto.name || file}${file && auto.name ? ` (${file})` : ''}, a ${auto.pipeline ? 'pipeline' : 'workflow'} on the card's document. Its result becomes a new version of the document, with the run and its cost in the thread.`;
    $('#dsc-automation-title').textContent = `Automation of ${col.title}`;
    $('#dsc-automation-what').textContent = what;
    $('#dsc-automation-mode').value = AUTOMATION_MODES[auto.mode] ? auto.mode : 'ask';
    $('#dsc-automation-error').textContent = '';
    openModal('#dsc-automation-modal');
    $('#dsc-automation-mode').focus({ preventScroll: true });
  }

  function closeAutomationSettings() {
    dv.automationCol = null;
    closeModal('#dsc-automation-modal');
  }

  async function saveAutomationMode(e) {
    const column = dv.automationCol;
    const mode = e.target.value;
    if (!column || !AUTOMATION_MODES[mode]) return;
    const was = columnOf(column)?.on_enter?.mode;
    $('#dsc-automation-error').textContent = '';
    try {
      const board = await api.setDiscoveryAutomation(dv.projectId, column, mode);
      if (board?.columns && dv.automationCol === column) {
        dv.board = { ...dv.board, ...board };
        render();
      }
    } catch (err) {
      $('#dsc-automation-error').textContent = errMsg(err);
      if (was) e.target.value = was;
    }
  }

  // An automation's run ended somewhere: the service wrote its result on the card, the board shows it.
  function onRunFinished() {
    if (state.view !== 'discovery' || !dv.cards.some((c) => c.automation?.state === 'running')) return;
    setTimeout(() => {
      refresh();
      if (dv.open && !documentDirty() && !acceptanceDirty()) reloadCard().catch(() => { /* gone: the refresh closes it */ });
    }, 500);
  }

  // ---- the clarity bar (#166) ---------------------------------------------------------------------
  // "Move anyway": the owner's override of a refused move, with a reason kept on the card.
  function openOverride(id) {
    const card = cardOf(id);
    if (!card) return;
    dv.override = { id, projectId: dv.projectId };
    const score = card.clarity?.score;
    $('#dsc-override-what').textContent = `"${card.title}" goes to Ready ${score == null ? 'without a clarity score' : `at ${score}% clear`}, below the bar of ${barOf(card)}%. The reason is kept on the card with that score.`;
    $('#dsc-override-reason').value = '';
    $('#dsc-override-error').textContent = '';
    $('#btn-dsc-override-confirm').disabled = true;
    openModal('#dsc-override-modal');
    $('#dsc-override-reason').focus({ preventScroll: true });
  }

  function moveAnyway(e) {
    e.preventDefault();
    const { id, projectId } = dv.override || {};
    const reason = String($('#dsc-override-reason').value || '').trim();
    if (!id || !reason) return undefined;
    return once(async () => {
      try {
        const moved = await api.moveDiscoveryCardAnyway(projectId, id, reason);
        closeModal('#dsc-override-modal');
        Object.assign(dv, { override: null, refused: null });
        if (projectId !== dv.projectId) return;
        await refresh();
        focusMove(id);
        if (dv.open?.id === id) reloadHistory();
        // Ready's automation (#259) answers like a plain move's
        afterMove(moved, { id, title: cardOf(id)?.title || id, column: 'ready', projectId });
      } catch (err) { $('#dsc-override-error').textContent = errMsg(err); }
    });
  }

  // "Bar and night…": the project's bar, a bar of its own per type (empty: the project's) and the night.
  function openClaritySettings() {
    const s = dv.board?.clarity;
    if (!s) return;
    $('#dsc-bar').value = s.bar;
    for (const el of document.querySelectorAll('#dsc-clarity-form [data-bar-kind]')) el.value = s.byKind?.[el.dataset.barKind] ?? '';
    $('#dsc-night-start').value = s.night.start;
    $('#dsc-night-end').value = s.night.end;
    $('#dsc-clarity-error').textContent = '';
    openModal('#dsc-clarity-modal');
    $('#dsc-bar').focus({ preventScroll: true });
  }

  function saveClaritySettings(e) {
    e.preventDefault();
    const projectId = dv.projectId;
    const percent = (el) => (String(el.value).trim() === '' ? null : Number(el.value));
    const byKind = Object.fromEntries([...document.querySelectorAll('#dsc-clarity-form [data-bar-kind]')].map((el) => [el.dataset.barKind, percent(el)]));
    const night = { start: $('#dsc-night-start').value, end: $('#dsc-night-end').value };
    return once(async () => {
      try {
        const board = await api.setDiscoveryClarityBar(projectId, percent($('#dsc-bar')), byKind, night);
        closeModal('#dsc-clarity-modal');
        if (projectId !== dv.projectId) return;
        dv.board = board;
        render();
        renderClarity();
      } catch (err) { $('#dsc-clarity-error').textContent = errMsg(err); }
    });
  }

  function onDragStart(e) {
    const card = e.target.closest?.('[data-testid="discovery-card"]');
    if (!card) return;
    dv.drag = card.dataset.card;
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', dv.drag);
      e.dataTransfer.effectAllowed = 'move';
    }
    card.classList.add('dragging');
  }

  function clearDrag() {
    dv.drag = null;
    for (const el of document.querySelectorAll('#dsc-board-box .dsc-drop, #dsc-board-box .dragging')) el.classList.remove('dsc-drop', 'dragging');
  }

  function onDragOver(e) {
    const zone = dv.drag && e.target.closest?.('[data-drop]');
    if (!zone) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (zone.classList.contains('dsc-drop')) return;
    for (const el of document.querySelectorAll('#dsc-board-box .dsc-drop')) el.classList.remove('dsc-drop');
    zone.classList.add('dsc-drop');
  }

  // The place a card dropped in a column (or a fast-lane cell) takes among the column's other
  // cards: before the card under the pointer, else after the last one shown there.
  function dropIndex(zone, e, id) {
    if (typeof e.clientY !== 'number') return undefined;
    const others = [...zone.querySelectorAll('[data-testid="discovery-card"]')].filter((el) => el.dataset.card !== id);
    if (!others.length) return undefined;
    const order = (dv.board.order?.[zone.dataset.drop] || []).filter((x) => x !== id);
    const before = others.find((el) => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    const i = order.indexOf((before || others.at(-1)).dataset.card);
    if (i < 0) return undefined;
    return before ? i : i + 1;
  }

  function onDrop(e) {
    const zone = e.target.closest?.('[data-drop]');
    const id = dv.drag || e.dataTransfer?.getData('text/plain');
    clearDrag();
    if (!zone || !cardOf(id)) return;
    e.preventDefault();
    requestMove(id, zone.dataset.drop, dropIndex(zone, e, id));
  }

  // ---- WIP limits ---------------------------------------------------------------------------------
  // Saves the limit typed in a column's header (Enter, or leaving the box): once, whichever comes first.
  async function commitWip(column, value) {
    const col = columnOf(column);
    if (dv.wipEdit !== column || dv.wipSaving || !col) return;
    const limit = Number(String(value).trim() || NaN);
    dv.error = '';
    if (!Number.isInteger(limit) || limit < 1) {
      dv.error = 'A WIP limit is a whole number from 1.';
      $('#dsc-error').textContent = dv.error;
      return;
    }
    if (limit !== col.wip) {
      const projectId = dv.projectId;
      dv.wipSaving = true;
      try {
        const board = await api.setDiscoveryWip(projectId, column, limit);
        if (projectId === dv.projectId) dv.board = board;
      } catch (e) { dv.error = errMsg(e); }
      dv.wipSaving = false;
      if (projectId !== dv.projectId) return; // another project's board is shown now
    }
    if (!dv.error) dv.wipEdit = null;
    render();
  }

  function onBoardChange(e) {
    const input = e.target.closest?.('[data-wip-input]');
    if (input) commitWip(input.dataset.wipInput, input.value);
  }

  function onBoardKey(e) {
    const input = e.target.closest?.('[data-wip-input]');
    if (input && e.key === 'Enter') {
      e.preventDefault();
      commitWip(input.dataset.wipInput, input.value);
    } else if (input && e.key === 'Escape') {
      e.preventDefault(); // not the open card's Esc
      const column = dv.wipEdit;
      Object.assign(dv, { wipEdit: null, error: '' });
      render();
      document.querySelector(`[data-testid="discovery-wip-edit"][data-column="${column}"]`)?.focus({ preventScroll: true });
    } else if (e.target.matches?.('.dsc-menu [role="menuitem"]') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      // the arrows walk the open "Move to…" menu
      e.preventDefault();
      (e.key === 'ArrowDown' ? e.target.nextElementSibling : e.target.previousElementSibling)?.focus({ preventScroll: true });
    }
  }

  // ---- the open card ------------------------------------------------------------------------------
  const detailError = (msg) => { const p = $('#dsc-detail-error'); if (p) p.textContent = msg || ''; };

  // One request of the open card at a time: a second Enter or click while one is in flight does nothing.
  async function once(fn) {
    if (dv.acting) return;
    dv.acting = true;
    try { await fn(); } finally { dv.acting = false; }
  }

  function documentDirty() {
    const doc = $('#dsc-doc');
    return !!dv.open && !!doc && (lines(doc.value) !== lines(dv.open.document) || $('#dsc-title').value !== dv.open.title);
  }
  function acceptanceDirty() {
    const box = dv.editAcceptance && $('#dsc-acc');
    return !!dv.open && !!box && lines(box.value) !== lines(dv.open.acceptance);
  }

  // An edit with changes is never dropped by another action: Save or Cancel first.
  function editBlocks() {
    if (!documentDirty() && !acceptanceDirty()) return false;
    detailError('Save or cancel the edit first.');
    return true;
  }

  const readCard = (projectId, id) => Promise.all([
    api.getDiscoveryCard(projectId, id), api.discoveryConversation(projectId, id), api.discoveryVersions(projectId, id),
  ]);

  // The open card keeps its own project (openProject): every request of the panel goes there, also
  // when an edit with changes holds the panel open after another project was chosen in the header.
  async function openCard(id) {
    if (editBlocks()) return;
    const seq = ++dv.openSeq;
    const projectId = dv.projectId;
    let card;
    let thread;
    let versions;
    try {
      [card, thread, versions] = await readCard(projectId, id);
    } catch (e) {
      dv.error = errMsg(e);
      return refresh();
    }
    if (seq !== dv.openSeq || projectId !== dv.projectId) return; // another card or project was opened, or this one closed, meanwhile
    Object.assign(dv, { open: card, openProject: projectId, thread: thread || [], versions: versions || [], viewing: null, tab: 'preview', editAcceptance: false, menu: null });
    render();
    renderDetail();
    $('#dsc-detail [data-detail="close"]')?.focus({ preventScroll: true });
  }

  function closeCard() {
    const id = dv.open?.id;
    dv.openSeq++;
    Object.assign(dv, { open: null, openProject: null, thread: [], versions: [], viewing: null, editAcceptance: false });
    dv.previews.clear();
    $('#dsc-detail').innerHTML = '';
    render();
    if (id) document.querySelector(`[data-open="${id}"]`)?.focus({ preventScroll: true });
  }

  // Reads the open card again (a restored version, a run's result) and redraws its panel.
  async function reloadCard() {
    const id = dv.open?.id;
    if (!id) return;
    const [card, thread, versions] = await readCard(dv.openProject, id);
    if (dv.open?.id !== id) return;
    Object.assign(dv, { open: card, thread: thread || [], versions: versions || [], viewing: null, tab: 'preview', editAcceptance: false });
    renderDetail();
  }

  // Only the thread and the versions again: an edit in progress keeps its text.
  async function reloadHistory() {
    const id = dv.open?.id;
    if (!id) return;
    try {
      const [thread, versions] = await Promise.all([api.discoveryConversation(dv.openProject, id), api.discoveryVersions(dv.openProject, id)]);
      if (dv.open?.id !== id) return;
      Object.assign(dv, { thread: thread || [], versions: versions || [] });
      renderThread();
      renderVersions();
    } catch (e) { detailError(errMsg(e)); }
  }

  function renderDetail() {
    const c = dv.open;
    if (!c) return;
    // a committed card (#258): nothing of it is edited any more
    const ro = readOnly();
    const off = ro ? ' hidden' : '';
    $('#dsc-detail').innerHTML = `
      <aside class="drawer open dsc-detail${ro ? ' read-only' : ''}" data-testid="discovery-card-detail" aria-label="Card: ${esc(c.title)}">
        <div class="drawer-head">
          <h2 class="drawer-title dsc-detail-title" data-testid="card-document-title" title="${esc(c.title)}">${esc(c.title)}</h2>
          <button type="button" class="icon-btn" data-detail="close" title="Close (Esc)" aria-label="Close the card">${CLOSE}</button>
        </div>
        <div class="drawer-body dsc-detail-body">
          <p class="inbox-card-meta muted small">
            <span>${esc(c.author)}</span>
            <span>${esc(dateOf(c.created))}</span>
            <span class="mono" title="The card's folder in the workspace's discovery/">${esc(c.id)}</span>
            ${c.links?.from ? `<span data-testid="card-from" title="New learning from the committed card ${esc(c.links.from)}">from <span class="mono">${esc(c.links.from)}</span></span>` : ''}
            ${ro ? '<span class="badge" data-testid="card-read-only" title="Committed to the backlog: the card is kept as it was committed">committed · read-only</span>' : ''}
          </p>
          <div class="dsc-fields">
            <div class="field">
              <label for="dsc-type">Type</label>
              <select id="dsc-type" data-testid="card-type"${ro ? ' disabled' : ''}>${TYPES.map((t) => `<option value="${t}"${t === c.type ? ' selected' : ''}>${t}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label for="dsc-tags">Tags</label>
              <input type="text" id="dsc-tags" data-testid="card-tags" value="${esc((c.tags || []).join(', '))}" placeholder="Comma-separated" autocomplete="off"${ro ? ' disabled' : ''} />
            </div>
          </div>
          <div id="dsc-detail-actions"></div>
          <p id="dsc-detail-error" class="error small"></p>
          <section id="dsc-clarity" class="inbox-section dsc-clarity" aria-label="Clarity"></section>
          <section class="inbox-section">
            <div class="inbox-section-head">
              <h3>Document</h3>
              <div class="seg sm${off}" role="group" aria-label="Document">
                <button type="button" data-detail="tab" data-tab="preview">Preview</button>
                <button type="button" data-detail="tab" data-tab="edit">Edit</button>
              </div>
            </div>
            <p id="dsc-unsaved" class="muted small hidden">A preview of unsaved changes: Save or Cancel them in Edit.</p>
            <article id="dsc-preview" class="md md-compact inbox-doc" data-testid="card-document-preview"></article>
            <div id="dsc-edit" class="inbox-edit hidden">
              <div class="field">
                <label for="dsc-title">Title <span class="req">*</span></label>
                <input type="text" id="dsc-title" maxlength="200" value="${esc(c.title)}" />
              </div>
              <div class="field">
                <label for="dsc-doc">Document (Markdown)</label>
                <textarea id="dsc-doc" data-testid="card-document-editor" rows="14" class="mono"></textarea>
              </div>
              <div class="row">
                <span class="spacer"></span>
                <button type="button" class="btn sm ghost" data-detail="cancel-doc">Cancel</button>
                <button type="button" class="btn sm primary" data-detail="save-doc">Save</button>
              </div>
            </div>
          </section>
          <section class="inbox-section">
            <div class="inbox-section-head">
              <h3>Acceptance criteria</h3>
              <button type="button" id="dsc-acc-edit" class="btn sm ghost" data-detail="edit-acc">Edit</button>
            </div>
            <div id="dsc-acceptance" data-testid="card-acceptance"></div>
          </section>
          <section class="inbox-section">
            <div class="inbox-section-head">
              <h3>Attachments</h3>
              <button type="button" class="btn sm ghost${off}" data-detail="attach">Attach files</button>
              <input type="file" id="dsc-file" class="hidden" multiple aria-label="Attach files to the card" />
            </div>
            <div id="dsc-files" class="inbox-files" data-testid="card-attachments"></div>
          </section>
          <section class="inbox-section">
            <div class="inbox-section-head"><h3>Thread</h3></div>
            <div id="dsc-thread" class="inbox-thread" data-testid="card-thread"></div>
            <div id="dsc-grill"></div>
            <div class="inbox-note${off}">
              <textarea id="dsc-note" rows="2" placeholder="Add a note (Enter sends)" aria-label="Add a note"></textarea>
              <button type="button" id="dsc-note-send" class="btn sm" data-detail="note">Add note</button>
            </div>
          </section>
          <section class="inbox-section">
            <div class="inbox-section-head"><h3>Version history</h3></div>
            <div id="dsc-versions" class="dsc-versions" data-testid="card-versions"></div>
          </section>
        </div>
      </aside>`;
    // set as a value, not as markup: a first empty line of the document stays
    $('#dsc-doc').value = c.document;
    renderTab();
    renderActions();
    renderClarity();
    renderAcceptance();
    renderAttachments();
    renderThread();
    renderVersions();
    loadPreviews();
  }

  // Preview shows what the editor holds (the saved document, or the changes being written).
  function renderTab() {
    const edit = dv.tab === 'edit';
    const doc = $('#dsc-doc').value;
    $('#dsc-preview').innerHTML = doc.trim() ? markdownHtml(doc) : '<p class="muted small">No document yet. Write it in Edit.</p>';
    $('#dsc-preview').classList.toggle('hidden', edit);
    $('#dsc-edit').classList.toggle('hidden', !edit);
    $('#dsc-unsaved').classList.toggle('hidden', edit || !documentDirty());
    for (const b of document.querySelectorAll('#dsc-detail [data-tab]')) {
      b.classList.toggle('active', b.dataset.tab === dv.tab);
      b.setAttribute('aria-pressed', String(b.dataset.tab === dv.tab));
    }
  }

  // The column's actions: in Shape, the two screens that work on the document; in Ready, the commit
  // (#258); a committed card shows its delivery and starts new learning as a new card.
  function renderActions() {
    const box = $('#dsc-detail-actions');
    if (!box || !dv.open) return;
    if (dv.open.column === 'ready') { box.innerHTML = commit().actionHtml(dv.open); return; }
    if (readOnly()) {
      box.innerHTML = `
      <section class="inbox-section dsc-delivery-box" aria-label="Delivery">
        <div class="inbox-section-head"><h3>Delivery</h3></div>
        ${commit().deliveryHtml(committedOf(dv.open.id) || dv.open)}
        <div class="row dsc-actions">
          <button type="button" class="btn sm" data-testid="card-new-from" data-detail="new-from" title="A committed card never returns to the board: new learning starts a new card in the Inbox, linked to this one">New card from this one</button>
        </div>
      </section>`;
      return;
    }
    box.innerHTML = dv.open.column !== 'shape' ? '' : `
      <div class="row dsc-actions" role="group" aria-label="Shape">
        <button type="button" class="btn sm" data-testid="card-open-write-review" data-detail="open-write-review" title="A writer and a reviewer work on this card's document">Open in Write &amp; Review</button>
        <button type="button" class="btn sm" data-testid="card-open-arena" data-detail="open-arena" title="Several models write from this card's document and the best of each is merged">Open in AI Arena</button>
      </div>
      <p class="muted small dsc-actions-hint">The card's document is the input. When the run finishes, its document comes back here as a new version and a thread entry.</p>`;
  }

  // The card's clarity (#166): its score against the bar of its type, who scored it and when, the
  // override that took it to Ready below the bar, and the points still missing. Below the bar: Grill me.
  function renderClarity() {
    const c = dv.open;
    const box = $('#dsc-clarity');
    if (!c || !box) return;
    const { score, gaps, ts, by, override } = c.clarity || {};
    const bar = barOf(c);
    const below = belowBar(c);
    // in Ready at its own bar (a type's lower bar, an override) but under the commit bar (#258): the gaps still count
    const uncommittable = c.column === 'ready' && commit().underBar(c);
    const when = (iso) => (iso ? `<time datetime="${esc(iso)}" title="${esc(dateOf(iso))}">${esc(ncAgo(iso))}</time>` : '');
    const missing = Array.isArray(gaps) ? gaps : [];
    box.innerHTML = `
      <div class="inbox-section-head">
        <h3>Clarity</h3>
        ${score == null ? '<span class="badge">not scored</span>' : `<span class="badge${below ? ' warn' : ''}">${esc(score)}%</span>`}
        <span class="muted small">${below ? `needs grilling: the bar is ${esc(bar)}%` : uncommittable ? `at the bar of ${esc(bar)}%, but a commit needs ${commit().BAR}%` : `at or above the bar of ${esc(bar)}%`}</span>
        ${(below || uncommittable) && !readOnly() ? '<button type="button" class="btn sm" data-testid="card-grill-me" data-detail="grill" title="An interview in this thread: one question at a time, each answer written into the card">Grill me</button>' : ''}
      </div>
      ${score != null && (by || ts) ? `<p class="muted small" data-testid="clarity-scored">Scored by <b>${esc(by || 'unknown')}</b> ${when(ts)}</p>` : ''}
      ${override ? `<p class="small" data-testid="clarity-override"><span class="badge warn">moved anyway</span> <b>${esc(override.by)}</b> moved it to Ready ${override.score == null ? 'without a score' : `at ${esc(override.score)}%`} ${when(override.ts)}: ${esc(override.reason)}</p>` : ''}
      ${missing.length ? `<p class="muted small">Missing:</p><ul class="dsc-missing" data-testid="clarity-missing">${missing.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}`;
  }

  function renderAcceptance() {
    const c = dv.open;
    const box = $('#dsc-acceptance');
    if (!c || !box) return;
    $('#dsc-acc-edit').classList.toggle('hidden', dv.editAcceptance || readOnly());
    if (!dv.editAcceptance) {
      box.innerHTML = String(c.acceptance || '').trim()
        ? `<article class="md md-compact inbox-doc">${markdownHtml(c.acceptance)}</article>`
        : '<p class="muted small">No acceptance criteria yet.</p>';
      return;
    }
    box.innerHTML = `
      <div class="inbox-edit">
        <div class="field">
          <label for="dsc-acc">Acceptance criteria (Markdown)</label>
          <textarea id="dsc-acc" rows="6" class="mono"></textarea>
        </div>
        <div class="row">
          <span class="spacer"></span>
          <button type="button" class="btn sm ghost" data-detail="cancel-acc">Cancel</button>
          <button type="button" class="btn sm primary" data-detail="save-acc">Save</button>
        </div>
      </div>`;
    $('#dsc-acc').value = c.acceptance;
  }

  function renderAttachments() {
    const box = $('#dsc-files');
    if (dv.open && box) box.innerHTML = parts().attachmentsHtml(dv.open, dv.previews);
  }

  // The images' thumbnails, read once per card and name.
  async function loadPreviews() {
    const c = dv.open;
    const missing = c.attachments.filter((n) => parts().IMAGE.test(n) && !dv.previews.has(`${c.id}/${n}`));
    if (!missing.length) return;
    await Promise.all(missing.map(async (n) => {
      try { dv.previews.set(`${c.id}/${n}`, await api.discoveryAttachment(dv.openProject, c.id, n)); } catch { /* shown by its name only */ }
    }));
    if (dv.open?.id === c.id) renderAttachments();
  }

  // The Grill me question the thread ends with (#166): the note box answers it.
  const waitingGrill = () => { const last = dv.thread.at(-1); return last?.kind === 'question' && last.grill ? last : null; };

  function renderThread() {
    const box = $('#dsc-thread');
    if (!box) return;
    box.innerHTML = parts().threadHtml(dv.thread);
    const q = waitingGrill();
    $('#dsc-grill').innerHTML = !q ? '' : `
      <div class="dsc-grill" data-testid="grill-interview">
        <p class="small"><b>Grill me</b> waits for your answer: it is written into the card, and the card is scored again.</p>
        ${q.proposal ? `<p class="muted small">A proposed answer, from the card:</p><pre class="dsc-grill-proposal" data-testid="grill-proposal">${esc(q.proposal)}</pre>` : ''}
        <div class="row">
          ${q.proposal ? '<button type="button" class="btn sm" data-testid="grill-use-proposal" data-detail="grill-use">Use this answer</button>' : ''}
          <button type="button" class="btn sm ghost" data-testid="grill-end" data-detail="grill-end">End the interview</button>
        </div>
      </div>`;
    const note = $('#dsc-note');
    note.placeholder = q ? 'Your answer (Enter sends)' : 'Add a note (Enter sends)';
    note.setAttribute('aria-label', q ? 'Answer the question' : 'Add a note');
    $('#dsc-note-send').textContent = q ? 'Answer' : 'Add note';
  }

  // What a version is, from its reason (snapshotVersion's label in its file name).
  function versionLabel(reason) {
    const move = /^move-(.+)$/.exec(reason);
    if (move) return `Moved to ${columnOf(move[1])?.title || move[1]}`;
    const result = /^result-(.+)$/.exec(reason);
    if (result) return `${SOURCES[result[1]] || result[1]} result`;
    const automation = /^automation-(.+)$/.exec(reason);
    if (automation) return `${columnOf(automation[1])?.title || automation[1]} automation result`;
    return { merge: 'Before a merge', 'before-automation': 'Before an automation\'s result', 'before-grill': 'Before a Grill me answer', 'before-restore': 'Before a restore', 'before-result': 'Before a run\'s result' }[reason] || reason;
  }

  function renderVersions() {
    const box = $('#dsc-versions');
    if (!box) return;
    box.innerHTML = dv.versions.length ? dv.versions.map((v) => {
      const shown = dv.viewing?.name === v.name;
      return `
      <div class="dsc-version" data-testid="card-version">
        <div class="dsc-version-row">
          <span class="dsc-version-label" title="${esc(v.name)}">${esc(versionLabel(v.reason))}</span>
          <span class="muted small" title="${esc(dateOf(v.ts))}">${esc(ncAgo(v.ts))}</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm ghost" data-testid="card-version-open" data-detail="version-open" data-name="${esc(v.name)}" aria-expanded="${shown}">${shown ? 'Close' : 'Open'}</button>
          <button type="button" class="btn sm ghost" data-testid="card-version-restore" data-detail="version-restore" data-name="${esc(v.name)}" title="Make this version the document again; the current document is kept as a version">Restore</button>
        </div>
        ${shown ? `<article class="md md-compact inbox-doc dsc-version-text" data-testid="card-version-text">${dv.viewing.text.trim() ? markdownHtml(dv.viewing.text) : '<p class="muted small">An empty document.</p>'}</article>` : ''}
      </div>`;
    }).join('') : '<p class="muted small">No version yet. One is kept on each move, restore and run result.</p>';
  }

  async function openVersion(name) {
    const id = dv.open.id;
    if (dv.viewing?.name === name) {
      dv.viewing = null;
      renderVersions();
      return;
    }
    try {
      const text = await api.discoveryVersion(dv.openProject, id, name);
      if (dv.open?.id !== id) return;
      dv.viewing = { name, text: String(text ?? '') };
      renderVersions();
    } catch (e) { detailError(errMsg(e)); }
  }

  const restoreVersion = (name) => once(async () => {
    const id = dv.open?.id;
    if (!id || editBlocks()) return;
    try {
      await api.restoreDiscoveryVersion(dv.openProject, id, name);
      await reloadCard();
      refresh();
    } catch (e) { detailError(errMsg(e)); }
  });

  // The title and the document, saved together; an edit of the acceptance criteria keeps its text.
  const saveDocument = () => once(async () => {
    const id = dv.open?.id;
    if (!id) return;
    try {
      const card = await api.updateDiscoveryCard(dv.openProject, id, { title: $('#dsc-title').value, document: $('#dsc-doc').value });
      if (dv.open?.id !== id) return;
      Object.assign(dv.open, { title: card.title, document: card.document, clarity: card.clarity });
      renderClarity();
      const title = $('#dsc-detail .dsc-detail-title');
      title.textContent = card.title;
      title.title = card.title;
      resetDocument();
      detailError('');
      refresh();
    } catch (e) { detailError(errMsg(e)); }
  });

  // The editor back to the saved title and document, in Preview.
  function resetDocument() {
    $('#dsc-title').value = dv.open.title;
    $('#dsc-doc').value = dv.open.document;
    dv.tab = 'preview';
    renderTab();
  }

  const saveAcceptance = () => once(async () => {
    const id = dv.open?.id;
    if (!id) return;
    try {
      const card = await api.updateDiscoveryCard(dv.openProject, id, { acceptance: $('#dsc-acc').value });
      if (dv.open?.id !== id) return;
      Object.assign(dv.open, { acceptance: card.acceptance, clarity: card.clarity });
      dv.editAcceptance = false;
      renderAcceptance();
      renderClarity();
      detailError('');
      refresh();
    } catch (e) { detailError(errMsg(e)); }
  });

  // One field, saved at once: the type (a bug or a hotfix joins the fast lane) or the tags.
  async function saveField(fields) {
    const id = dv.open.id;
    try {
      const card = await api.updateDiscoveryCard(dv.openProject, id, fields);
      if (dv.open?.id === id) Object.assign(dv.open, { type: card.type, tags: card.tags, clarity: card.clarity });
      detailError('');
    } catch (e) { detailError(errMsg(e)); }
    if (dv.open?.id === id) {
      $('#dsc-type').value = dv.open.type;
      $('#dsc-tags').value = (dv.open.tags || []).join(', ');
    }
    refresh();
  }

  async function attachToCard(list) {
    const id = dv.open?.id;
    if (!id || readOnly()) return;
    const { files, errors } = await parts().readFiles(list);
    for (const f of files) {
      try { await api.addDiscoveryAttachment(dv.openProject, id, undefined, f.name, f.data); } catch (e) { errors.push(`${f.name}: ${errMsg(e)}`); }
    }
    if (dv.open?.id !== id) return;
    // only the attachments are redrawn: an edit in progress keeps its text
    try { dv.open.attachments = (await api.getDiscoveryCard(dv.openProject, id)).attachments; } catch (e) { errors.push(errMsg(e)); }
    renderAttachments();
    loadPreviews();
    detailError(errors.join('; '));
    refresh();
  }

  async function viewAttachment(name) {
    const c = dv.open;
    try {
      const key = `${c.id}/${name}`;
      if (!dv.previews.has(key)) dv.previews.set(key, await api.discoveryAttachment(dv.openProject, c.id, name));
      const a = dv.previews.get(key);
      if (a.dataUrl && window.ImageViewer) window.ImageViewer.open({ title: c.title, images: [{ src: a.dataUrl, label: name }] });
      // another file is never opened from here (it could be a program): its folder is
      else await api.openPath(a.folder);
    } catch (e) { detailError(errMsg(e)); }
  }

  async function removeAttachment(name) {
    const id = dv.open.id;
    if (!(await confirmDialog('Remove attachment', `Delete "${name}" from this card?`, 'Remove'))) return;
    try {
      await api.removeDiscoveryAttachment(dv.openProject, id, name);
      dv.previews.delete(`${id}/${name}`);
      if (dv.open?.id !== id) return;
      dv.open.attachments = dv.open.attachments.filter((n) => n !== name);
      renderAttachments();
      refresh();
    } catch (e) { detailError(errMsg(e)); }
  }

  // ---- Grill me (#166) ------------------------------------------------------------------------------
  // The interview runs in the open card's thread: the store asks the card's next open point, the
  // note box answers it, the answer is written into the card (so an edit with changes goes first)
  // and the next question comes, until the card reaches its bar or the person ends it.
  const startGrill = () => once(async () => {
    const id = dv.open?.id;
    if (!id || editBlocks()) return;
    try {
      await api.grillDiscoveryCard(dv.openProject, id);
      if (dv.open?.id !== id) return;
      await reloadCard();
      refresh();
      const note = $('#dsc-note');
      note?.scrollIntoView?.({ block: 'center' });
      note?.focus({ preventScroll: true });
    } catch (e) { detailError(errMsg(e)); }
  });

  // "Grill me" on a card's face: its panel opens, then the interview starts there.
  async function grillFromBoard(id) {
    if (dv.open?.id !== id) await openCard(id);
    if (dv.open?.id === id) startGrill();
  }

  async function answerGrill(text) {
    const id = dv.open.id;
    if (editBlocks()) return;
    try {
      await api.answerDiscoveryGrill(dv.openProject, id, text);
      if (dv.open?.id !== id) return;
      await reloadCard();
      refresh();
      $('#dsc-note')?.focus({ preventScroll: true });
    } catch (e) { detailError(errMsg(e)); }
  }

  // Any other entry ends the wait: the card keeps what was answered so far.
  const endGrill = () => once(async () => {
    const id = dv.open?.id;
    if (!id) return;
    try {
      await api.appendDiscoveryConversation(dv.openProject, id, { text: 'Ended the Grill me interview.' });
      await reloadHistory();
      refresh();
    } catch (e) { detailError(errMsg(e)); }
  });

  const addNote = () => once(async () => {
    const id = dv.open?.id;
    const box = $('#dsc-note');
    const text = String(box?.value || '').trim();
    if (!id || !text) return;
    if (waitingGrill()) { await answerGrill(text); return; }
    try {
      await api.appendDiscoveryConversation(dv.openProject, id, { text });
      const thread = await api.discoveryConversation(dv.openProject, id);
      if (dv.open?.id !== id) return;
      box.value = '';
      dv.thread = thread || [];
      renderThread();
      refresh();
    } catch (e) { detailError(errMsg(e)); }
  });

  // "Commit to the backlog" (#258): the dialog files the issues; then the card is in the Committed list.
  function openCommit() {
    if (editBlocks()) return;
    commit().open({
      projectId: dv.openProject,
      card: dv.open,
      done: (out, problems) => {
        const filed = (out.issues || []).map((i) => `#${i.number}`).join(', ');
        const planned = out.roadmap && !problems.some((p) => /roadmap/.test(p));
        showToast(`Committed "${out.card?.title || ''}" to the backlog`, [`Filed ${filed}${out.simulated ? ' (simulated)' : ''}${planned ? ', planned in the roadmap' : ''}.`, ...problems].join(' '));
        if (dv.open?.id === out.card?.id) closeCard();
        refresh();
      },
    });
  }

  // New learning from a committed card (#258): a new Inbox card linked to it, opened to be written.
  const newFromCard = () => once(async () => {
    const from = dv.open;
    if (!from) return;
    try {
      const card = await api.createDiscoveryCard(dv.openProject, `Learned from: ${from.title}`.slice(0, 200), '', 'idea', from.id);
      showToast('New card in the Inbox', `Linked to the committed card "${from.title}".`);
      closeCard();
      await window.InboxActions?.openCard(card.id);
    } catch (e) { detailError(errMsg(e)); }
  });

  // what a committed card's panel still does (#258): it is read, never edited
  const READ_ONLY_ACTS = ['close', 'view', 'version-open', 'new-from'];

  function onDetailClick(e) {
    // a thread entry's run (an automation's, #259) opens on the Run screen
    const run = e.target.closest('[data-open-run]');
    if (run) { selectRun(run.dataset.openRun); return; }
    const b = e.target.closest('[data-detail]');
    if (!b || !dv.open) return;
    const act = b.dataset.detail;
    if (readOnly() && !READ_ONLY_ACTS.includes(act)) return;
    if (act === 'close') { if (!editBlocks()) closeCard(); }
    else if (act === 'commit') openCommit();
    else if (act === 'new-from') newFromCard();
    else if (act === 'tab') {
      dv.tab = b.dataset.tab;
      renderTab();
      if (dv.tab === 'edit') $('#dsc-doc').focus({ preventScroll: true });
    }
    else if (act === 'save-doc') saveDocument();
    else if (act === 'cancel-doc') { resetDocument(); detailError(''); }
    else if (act === 'edit-acc') { dv.editAcceptance = true; renderAcceptance(); $('#dsc-acc').focus({ preventScroll: true }); }
    else if (act === 'save-acc') saveAcceptance();
    else if (act === 'cancel-acc') { dv.editAcceptance = false; renderAcceptance(); detailError(''); }
    else if (act === 'attach') $('#dsc-file').click();
    else if (act === 'view') viewAttachment(b.dataset.name);
    else if (act === 'unattach') removeAttachment(b.dataset.name);
    else if (act === 'note') addNote();
    else if (act === 'grill') startGrill();
    else if (act === 'grill-use') once(() => answerGrill(waitingGrill()?.proposal || ''));
    else if (act === 'grill-end') endGrill();
    else if (act === 'version-open') openVersion(b.dataset.name);
    else if (act === 'version-restore') restoreVersion(b.dataset.name);
    else if (act === 'open-write-review') openRunScreen('write-review');
    else if (act === 'open-arena') openRunScreen('ai-arena');
  }

  function onDetailChange(e) {
    if (!dv.open || readOnly()) return;
    if (e.target.id === 'dsc-file') { attachToCard(e.target.files); e.target.value = ''; }
    else if (e.target.id === 'dsc-type') saveField({ type: e.target.value });
    else if (e.target.id === 'dsc-tags') saveField({ tags: e.target.value.split(',') });
  }

  // Esc: the open "Move to…" menu first, then the open card. An edit with changes stays (Cancel
  // drops it), and a dialog or the image viewer on top closes by itself.
  function onEscape(e) {
    if (e.key !== 'Escape' || e.defaultPrevented || state.view !== 'discovery') return;
    // the automation dialogs (#259) close with Escape: a proposal dismissed runs nothing
    if (!$('#dsc-proposal-modal').classList.contains('hidden')) { if (!dv.proposing) closeProposal(); return; }
    if (!$('#dsc-automation-modal').classList.contains('hidden')) { closeAutomationSettings(); return; }
    if (window.ImageViewer?.isOpen() || document.querySelector('.modal:not(.hidden)')) return;
    if (dv.menu) {
      const id = dv.menu;
      dv.menu = null;
      render();
      focusMove(id);
    } else if (dv.open && !editBlocks()) {
      closeCard();
    }
  }

  // ---- a run for a card -----------------------------------------------------------------------------
  // "Open in Write & Review" / "Open in AI Arena" fill that screen with the card's document; nothing
  // starts by itself. The screen tells DiscoveryRuns.started which run it started for the card, and
  // when that run finishes its document is recorded on the card (discovery:record-result). The link
  // is kept in localStorage, so a run that ends while the app is closed is caught up on the next visit.
  function openRunScreen(source) {
    const c = dv.open;
    if (editBlocks()) return;
    const skill = DOC_SKILL[c.type] || '';
    const what = { prd: 'a PRD', rfc: 'an RFC' }[c.type] || 'a clear document';
    const request = [
      `Shape this discovery card into ${what}. Keep its intent and every fact it states; ground what you add in the project's files and mark assumptions and open questions as such.`,
      `Card: ${c.title}`,
      `<document>\n${String(c.document || '').trim() || '(no document yet)'}\n</document>`,
      ...(String(c.acceptance || '').trim() ? [`<acceptance_criteria>\n${c.acceptance.trim()}\n</acceptance_criteria>`] : []),
    ].join('\n');
    const card = { projectId: dv.openProject, cardId: c.id, title: c.title };
    if (source === 'ai-arena') {
      window.openArenaForCard({ ...card, task: request, skill });
      return;
    }
    const goal = window.DuoIssue.defaultGoal(skill)
      || 'A document clear enough to commit to: the problem and who has it, what is decided, the scope and what is out of it, and the open questions marked as such.';
    window.openDuoForCard({ ...card, prompt: request, goal, skill });
  }

  const readRuns = () => { try { return JSON.parse(localStorage.getItem(LS_RUNS)) || {}; } catch { return {}; } };
  const writeRuns = (runs) => { try { localStorage.setItem(LS_RUNS, JSON.stringify(runs)); } catch { /* ignore */ } };

  /** The run `runId` was started for a card: `{ projectId, cardId, source }` ('write-review' | 'ai-arena'). */
  function runStarted(runId, { projectId, cardId, source }) {
    writeRuns({ ...readRuns(), [runId]: { projectId, cardId, source } });
  }

  function forgetRun(runId) {
    const runs = readRuns();
    delete runs[runId];
    writeRuns(runs);
  }

  // A card's run ended (`ev`: its workflow.finished): a successful run's document goes back to the
  // card. The link goes once the result is recorded, or when there is nothing to record (the run
  // failed, its card is gone); after another failure it stays, tried again when the board opens.
  async function runEnded(runId, ev) {
    const link = readRuns()[runId];
    if (!link || dv.recording.has(runId)) return;
    const text = String(ev.outputs?.document ?? '');
    if (ev.status !== 'success' || !text.trim()) {
      forgetRun(runId);
      return;
    }
    dv.recording.add(runId);
    try {
      await api.recordDiscoveryResult(link.projectId, link.cardId, link.source, text, runId);
      forgetRun(runId);
    } catch (e) {
      if (/not found/i.test(errMsg(e))) forgetRun(runId);
      dv.error = `The ${SOURCES[link.source] || link.source} result of the run ${runId} did not reach its card: ${errMsg(e)}`;
    } finally {
      dv.recording.delete(runId);
    }
    if (state.view !== 'discovery') return;
    await refresh();
    // an edit in progress keeps its text: the result is in the version history
    if (dv.open?.id === link.cardId && link.projectId === dv.openProject) {
      if (documentDirty() || acceptanceDirty()) reloadHistory(); else reloadCard().catch((e) => detailError(errMsg(e)));
    }
  }

  // The runs that ended while nobody listened (the app was closed): read from their events. A run
  // that no longer exists takes its link with it; another failure leaves the link for the next visit.
  async function catchUpRuns() {
    for (const runId of Object.keys(readRuns())) {
      let end = null;
      try {
        end = (await api.runEvents(runId) || []).find((e) => e.type === 'workflow.finished');
      } catch (e) {
        if (/not found/i.test(errMsg(e))) end = { status: 'gone' };
      }
      if (end) await runEnded(runId, end);
    }
  }

  window.DiscoveryRuns = { started: runStarted };
  // the Backlog's badge of an issue's discovery card (#258): the board with that card's panel open
  window.DiscoveryActions = {
    openCard: (id) => { showView('discovery'); return openCard(id); },
  };

  registerView({
    id: 'discovery',
    nav: {
      label: 'Discovery', order: 115, group: 'plan', title: 'Shape accepted ideas until they are ready: Triage, Shape, Define, Ready',
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="10" rx="1" /><rect x="17" y="4" width="4" height="13" rx="1" /></svg>',
    },
    markup: `
      <section id="view-discovery" class="view hidden">
        <div class="page-head">
          <div>
            <h1>Discovery</h1>
            <p class="muted small">The cards accepted in the Inbox, worked on until they are clear enough to commit: Triage → Shape → Define → Ready. Private to this workspace (<span class="mono">discovery/</span>). Drag a card or use its "Move to…" menu; bugs and hotfixes take the fast lane.</p>
          </div>
        </div>
        <div class="dsc-toolbar" role="group" aria-label="Filters">
          <div class="field">
            <label for="dsc-filter-type">Type</label>
            <select id="dsc-filter-type" data-testid="discovery-filter-type">
              <option value="">All types</option>
              ${TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="dsc-filter-tag">Tag</label>
            <select id="dsc-filter-tag" data-testid="discovery-filter-tag"><option value="">All tags</option></select>
          </div>
          <div class="field">
            <label for="dsc-filter-author">Author</label>
            <select id="dsc-filter-author" data-testid="discovery-filter-author"><option value="">All authors</option></select>
          </div>
          <div class="field dsc-search">
            <label for="dsc-search">Search</label>
            <input type="text" id="dsc-search" data-testid="discovery-search" placeholder="Titles and documents" autocomplete="off" />
          </div>
        </div>
        <p id="dsc-error" class="error small"></p>
        <p id="dsc-refused" class="error small" data-testid="clarity-refused" role="alert"></p>
        <div id="dsc-board-box"></div>
        <div id="dsc-detail"></div>
      </section>`,
    modals: `
  <div id="dsc-override-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="dsc-override-title" data-testid="clarity-override-dialog">
    <form id="dsc-override-form" class="modal-card">
      <h3 id="dsc-override-title">Move anyway</h3>
      <p id="dsc-override-what" class="muted small"></p>
      <div class="field">
        <label for="dsc-override-reason">Reason <span class="req">*</span></label>
        <textarea id="dsc-override-reason" data-testid="clarity-override-reason" rows="3" placeholder="Why does it go to Ready below the bar? Kept on the card."></textarea>
      </div>
      <p id="dsc-override-error" class="error small"></p>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" id="btn-dsc-override-cancel" class="btn ghost">Cancel</button>
        <button type="submit" id="btn-dsc-override-confirm" class="btn primary" data-testid="clarity-override-confirm" disabled>Move to Ready</button>
      </div>
    </form>
  </div>
  <div id="dsc-clarity-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="dsc-clarity-title" data-testid="clarity-settings-dialog">
    <form id="dsc-clarity-form" class="modal-card">
      <h3 id="dsc-clarity-title">Clarity bar and night</h3>
      <p class="muted small">A card enters Ready at or above the bar of this project. A type with a bar of its own uses it instead (a hotfix may pass lower); leave it empty to use the project's.</p>
      <div class="dsc-clarity-grid">
        <div class="field">
          <label for="dsc-bar">Bar (%) <span class="req">*</span></label>
          <input type="number" id="dsc-bar" data-testid="clarity-bar" min="0" max="100" step="1" required />
        </div>
        ${TYPES.map((t) => `<div class="field">
          <label for="dsc-bar-${t}">${t} (%)</label>
          <input type="number" id="dsc-bar-${t}" data-testid="clarity-bar-${t}" data-bar-kind="${t}" min="0" max="100" step="1" placeholder="project's" />
        </div>`).join('')}
      </div>
      <div class="dsc-clarity-grid">
        <div class="field">
          <label for="dsc-night-start">Night from <span class="req">*</span></label>
          <input type="time" id="dsc-night-start" data-testid="clarity-night-start" required />
        </div>
        <div class="field">
          <label for="dsc-night-end">Night to <span class="req">*</span></label>
          <input type="time" id="dsc-night-end" data-testid="clarity-night-end" required />
        </div>
      </div>
      <p class="hint">The night is when agents work alone: the ready forecast counts in nights of this length.</p>
      <p id="dsc-clarity-error" class="error small"></p>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" id="btn-dsc-clarity-cancel" class="btn ghost">Cancel</button>
        <button type="submit" class="btn primary" data-testid="clarity-settings-save">Save</button>
      </div>
    </form>
  </div>
  <div id="dsc-automation-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="dsc-automation-title" data-testid="discovery-automation-dialog">
    <form id="dsc-automation-form" class="modal-card">
      <h3 id="dsc-automation-title">Automation</h3>
      <p id="dsc-automation-what" class="muted small"></p>
      <div class="field dsc-automation-field">
        <label for="dsc-automation-mode">When a card enters</label>
        <select id="dsc-automation-mode" data-testid="discovery-automation-mode">
          ${Object.entries(AUTOMATION_MODES).map(([v, label]) => `<option value="${v}">${label}</option>`).join('')}
        </select>
        <div class="hint">Ask me proposes it with its cost estimate, On starts it with the move, Off does nothing. Every gate of a run still waits for you; the card never moves by itself.</div>
      </div>
      <p id="dsc-automation-error" class="error small" role="alert"></p>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" id="btn-dsc-automation-close" class="btn ghost">Close</button>
      </div>
    </form>
  </div>
  <div id="dsc-proposal-modal" class="dsc-proposal-dock hidden" role="dialog" aria-modal="false" aria-labelledby="dsc-proposal-title" data-testid="discovery-automation-proposal">
    <form id="dsc-proposal-form" class="modal-card">
      <h3 id="dsc-proposal-title">Run the automation?</h3>
      <p id="dsc-proposal-what" class="small" data-testid="discovery-automation-what"></p>
      <p id="dsc-proposal-estimate" class="muted small" data-testid="discovery-automation-estimate"></p>
      <p id="dsc-proposal-hint" class="hint"></p>
      <p id="dsc-proposal-error" class="error small" role="alert"></p>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" id="btn-dsc-proposal-skip" class="btn ghost" data-testid="discovery-automation-skip">Not now</button>
        <button type="button" id="btn-dsc-proposal-run" class="btn primary" data-testid="discovery-automation-run">Run</button>
      </div>
    </form>
  </div>${window.DiscoveryCommit.MODAL}`,
    mount() {
      commit().mount();
      $('#dsc-automation-form').onsubmit = (e) => e.preventDefault();
      $('#dsc-automation-mode').onchange = saveAutomationMode;
      $('#btn-dsc-automation-close').onclick = closeAutomationSettings;
      $('#dsc-proposal-form').onsubmit = runProposal;
      $('#btn-dsc-proposal-run').onclick = runProposal;
      $('#btn-dsc-proposal-skip').onclick = closeProposal;
      $('#dsc-override-form').onsubmit = moveAnyway;
      $('#dsc-override-reason').oninput = (e) => { $('#btn-dsc-override-confirm').disabled = !e.target.value.trim(); };
      $('#btn-dsc-override-cancel').onclick = () => { dv.override = null; closeModal('#dsc-override-modal'); };
      $('#dsc-clarity-form').onsubmit = saveClaritySettings;
      $('#btn-dsc-clarity-cancel').onclick = () => closeModal('#dsc-clarity-modal');

      const box = $('#dsc-board-box');
      box.onclick = onBoardClick;
      box.addEventListener('change', onBoardChange);
      box.addEventListener('keydown', onBoardKey);
      box.addEventListener('dragstart', onDragStart);
      box.addEventListener('dragover', onDragOver);
      box.addEventListener('drop', onDrop);
      box.addEventListener('dragend', clearDrag);

      for (const key of ['type', 'tag', 'author']) {
        $(`#dsc-filter-${key}`).onchange = (e) => { dv.filter[key] = e.target.value; dv.menu = null; render(); };
      }
      $('#dsc-search').oninput = (e) => {
        clearTimeout(dv.searchTimer);
        dv.searchTimer = setTimeout(() => { dv.filter.q = e.target.value; dv.menu = null; render(); }, 150);
      };

      const detail = $('#dsc-detail');
      detail.onclick = onDetailClick;
      detail.addEventListener('change', onDetailChange);
      detail.addEventListener('keydown', (e) => {
        if (e.target.id !== 'dsc-note' || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
        e.preventDefault();
        addNote();
      });
      detail.addEventListener('paste', (e) => {
        const files = [...(e.clipboardData?.files || [])];
        if (!files.length || !dv.open) return;
        e.preventDefault();
        attachToCard(files);
      });
      detail.addEventListener('dragover', (e) => { if (dv.open && parts().hasFiles(e)) e.preventDefault(); });
      detail.addEventListener('drop', (e) => {
        if (!dv.open || !e.dataTransfer?.files?.length) return;
        e.preventDefault();
        attachToCard(e.dataTransfer.files);
      });

      document.addEventListener('keydown', onEscape);
      document.addEventListener('click', onOutsideClick);
      api.onEvent((ev) => {
        if (ev?.type !== 'workflow.finished') return;
        runEnded(ev.run_id, ev);
        onRunFinished();
      });
    },
    show() {
      refresh();
      // back from another screen: the open card may have changed there (a run's result)
      if (dv.open && !documentDirty() && !acceptanceDirty()) reloadCard().catch(() => { /* gone: the refresh closes it */ });
      catchUpRuns();
    },
  });
})();
