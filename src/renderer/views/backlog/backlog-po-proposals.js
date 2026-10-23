// Backlog › Product Owner: the plan answer's "Split what is too big" (#124) and "Epics" (#138)
// sections, drawn inside the drawer by backlog-po.js (`ctx`: { messages, projectId, busy, issueRef,
// issueOf, render, setMessages }).
// A split card leads with the parent's title and why it is too big, then its 2-4 children (stage,
// complexity, title, the parent's tasks each takes) and what becomes of the parent. Edit… opens a
// framed form: each task's child (a select), each child's title, stage and complexity, "merge with
// the next child", the parent's fate (Umbrella / Close); Save keeps the edit until filed, Cancel drops
// it. Split (or Split + roadmap: the children planned in the roadmap by stage, with the workflow of
// the select next to the buttons, the default development workflow until changed, #195) files it on
// the owner's click (api.splitProductOwnerIssue); a split filed shows "Split into #a, #b" and no buttons.
// The Epics section: issues to place, grouped by epic (Place in epic), new epics (title, goal,
// members: Create epic), and epics to merge or split (advice). Each is applied on the owner's click
// (api.applyProductOwnerEpic). A real write asks first; developer or simulated mode only previews.
// Uses app.js globals (esc, state, errMsg, devMode, confirmDialog).
/* global api */
(() => {
  const edits = new Map(); // split key → the proposal being edited
  const workflowOf = new Map(); // split key → the children's workflow picked (#195; else the default)
  const saved = new Map(); // split key → the owner's saved edit (filed instead of the PO's)
  const notes = new Map(); // split or epic key → { text, error }
  let busy = false;

  const clone = (s) => ({ issue: s.issue, parent: s.parent, children: s.children.map((c) => ({ ...c, tasks: [...c.tasks] })) });
  const splitKey = (msg, s) => `${msg.ts}:split:${s.issue}`;
  const epicKey = (msg, key) => `${msg.ts}:${key}`;
  const current = (msg, s) => saved.get(splitKey(msg, s)) || s;
  const filedSplit = (ctx, msg, s) => ctx.messages.find((x) => x.split && x.split.at === msg.ts && x.split.issue === s.issue && !x.split.preview)?.split;
  const appliedEpic = (ctx, msg, key) => ctx.messages.find((x) => x.epicApplied && x.epicApplied.at === msg.ts && x.epicApplied.key === key && !x.epicApplied.preview)?.epicApplied;
  const noteHtml = (key) => { const n = notes.get(key); return n ? `<span class="small ${n.error ? 'error' : 'muted'}">${esc(n.text)}</span>` : ''; };
  const off = (ctx) => (busy || ctx.busy ? ' disabled' : '');
  const epicTitle = (id) => (window.BacklogActions?.data()?.epics || []).find((e) => e.id === id)?.title || id;

  // ---- splits (#124) ---------------------------------------------------------------------------------
  // The children's workflow (#195): the default development workflow (Settings › General › Backlog)
  // unless the owner picks another; the workflows that take a task, never a pipeline.
  const splitWorkflow = (key) => workflowOf.get(key) || DefaultWorkflow.current().file;
  function workflowSelect(key, ctx) {
    const value = splitWorkflow(key);
    const list = DefaultWorkflow.projectFirst((state.workflows || []).filter((w) => !w.error && w.inputs?.task));
    const options = list.some((w) => w.file === value) ? list : [{ file: value, name: value }, ...list];
    return `<select class="po-wf" data-split-wf aria-label="${t('backlog_po_proposals.workflow_of_the_children_in_the')}" title="${t('backlog_po_proposals.the_workflow_of_the_children_s')}"${off(ctx)}>${options.map((w) =>
      `<option value="${esc(w.file)}"${w.file === value ? ' selected' : ''}>${esc(w.name || w.file)}${w.file === DefaultWorkflow.current().file ? ' (default)' : ''}</option>`).join('')}</select>`;
  }

  // A task is the issue's checkbox line as written (#242): its inline Markdown (**bold**, *italic*,
  // `code`, [text](url)) is rendered, and its hover is the plain text without the symbols.
  const MD_CODE = /`([^`]+)`/g;
  const MD_LINK = /\[([^\]]+)\]\([^)\s]+\)/g;
  const MD_BOLD = /\*\*([^*]+)\*\*|__([^_]+)__/g;
  const MD_ITALIC = /\*([^*\s][^*]*)\*/g;
  const taskPlain = (text) => String(text ?? '').replace(MD_CODE, '$1').replace(MD_LINK, '$1').replace(MD_BOLD, '$1$2').replace(MD_ITALIC, '$1');
  function taskHtml(text) {
    const codes = [];
    const html = esc(String(text ?? '').replace(MD_CODE, (_, c) => `\u0000${codes.push(c) - 1}\u0000`))
      .replace(MD_LINK, '$1').replace(MD_BOLD, '<b>$1$2</b>').replace(MD_ITALIC, '<i>$1</i>'); // i18n-ignore
    return html.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
  }

  function childrenHtml(s, p) {
    const text = (k) => s.tasks?.[k - 1]?.text || `Task ${k}`;
    return `<ol class="po-children">${p.children.map((c) => `<li class="po-child">
        <div class="po-child-head"><span class="badge" title="${t('backlog_po_proposals.children_of_the_same_stage_can')}">${t('backlog_po_proposals.stage')} ${c.stage}</span><span class="badge bl-triage bl-complexity lvl-${c.complexity}" title="${t('backlog_po_proposals.complexity_complexity_5', { complexity: c.complexity })}">C${c.complexity}</span><b class="po-child-title" title="${esc(c.title)}">${esc(c.title)}</b></div>
        <ul class="po-tasks small">${c.tasks.map((k) => `<li data-testid="po-split-task" title="${esc(taskPlain(text(k)))}"><span class="muted mono">${k}.</span> ${taskHtml(text(k))}</li>`).join('')}</ul>
        ${c.reason ? `<div class="small muted">${esc(c.reason)}</div>` : ''}
      </li>`).join('')}</ol>
      <div class="small"><span class="muted">${t('backlog_po_proposals.then_issue', { issue: s.issue })}</span> ${p.parent === 'close' ? t('backlog_po_proposals.closed_in_favour_of_its_children') : t('backlog_po_proposals.an_umbrella_with_a_task_list')}</div>`;
  }

  function editHtml(s, e) {
    const tasks = s.tasks || [];
    return `<div class="po-edit">
        <div class="field"><label>${t('backlog_po_proposals.then')}${s.issue}</label>
          <div class="seg sm" role="group" aria-label="${t('backlog_po_proposals.what_becomes_of_issue', { issue: s.issue })}">
            <button type="button" class="${e.parent === 'umbrella' ? 'active' : ''}" data-split-parent="umbrella">${t('backlog_po_proposals.umbrella')}</button>
            <button type="button" class="${e.parent === 'close' ? 'active' : ''}" data-split-parent="close">${t('common.close')}</button>
          </div>
          <div class="hint">${t('backlog_po_proposals.umbrella_a_task_list_linking_the')}</div></div>
        ${e.children.map((c, i) => `<div class="po-edit-child">
          <div class="field"><label for="po-split-title-${s.issue}-${i}">${t('backlog_po_proposals.child')} ${i + 1}</label>
            <input type="text" id="po-split-title-${s.issue}-${i}" data-split-title="${i}" value="${esc(c.title)}" /></div>
          <div class="row small">
            <label class="po-edit-num">${t('backlog_po_proposals.stage_2')} <input type="number" min="1" max="9" data-split-stage="${i}" value="${c.stage}" /></label>
            <label class="po-edit-num">${t('backlog_po_proposals.complexity')} <select data-split-cx="${i}">${[1, 2, 3, 4, 5].map((k) => `<option value="${k}"${c.complexity === k ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
            ${i < e.children.length - 1 ? `<button class="link-btn small" type="button" data-split-merge="${i}" title="${t('backlog_po_proposals.child_value_s_tasks_join_this', { value: i + 2 })}">${t('backlog_po_proposals.merge_with_child')} ${i + 2}</button>` : ''}
          </div></div>`).join('')}
        <div class="field"><label>${t('backlog_po_proposals.tasks')}</label><div class="po-edit-tasks">${tasks.map((t) => `<label class="po-edit-task"><span class="small" title="${esc(taskPlain(t.text))}"><span class="muted mono">${t.n}.</span> ${taskHtml(t.text)}</span>
            <select data-split-task="${t.n}" aria-label="${I18n.t('backlog_po_proposals.child_of_task_n', { n: t.n })}">${e.children.map((c, i) => `<option value="${i}"${c.tasks.includes(t.n) ? ' selected' : ''}>${I18n.t('backlog_po_proposals.child')} ${i + 1}</option>`).join('')}</select></label>`).join('')}</div>
          <div class="hint">${t('backlog_po_proposals.every_task_goes_to_exactly_one')}</div></div>
        <div class="row"><button class="btn sm primary" type="button" data-split-act="save">${t('common.save')}</button><button class="btn sm ghost" type="button" data-split-act="cancel">${t('common.cancel')}</button></div>
      </div>`;
  }

  function splitHtml(ctx, msg, s) {
    const key = splitKey(msg, s);
    const edit = edits.get(key);
    const done = filedSplit(ctx, msg, s);
    const title = s.title || ctx.issueOf(s.issue)?.title || '';
    return `<div class="po-group po-split${done ? ' applied' : ''}" data-split="${s.issue}" data-testid="po-split-card">
        <div class="po-group-head">${ctx.issueRef(s.issue)}<b class="po-split-title" title="${esc(title)}">${esc(title)}</b>
          <span class="badge">${s.tasks?.length || 0} ${t('backlog_po_proposals.tasks_2')}</span>
          ${done ? `<span class="badge live">${t('backlog_po_proposals.split_into')} ${esc(done.children.map((c) => (c.number ? `#${c.number}` : c.title)).join(', '))}</span>` : saved.has(key) ? `<span class="badge warn" title="${t('backlog_po_proposals.you_edited_this_proposal_the_edit')}">${t('backlog_po_proposals.edited')}</span>` : ''}</div>
        <ul class="po-list small">${s.reasons.map((r) => `<li class="warn-text">${esc(r)}</li>`).join('')}</ul>
        ${s.repaired ? `<div class="small muted">${t('backlog_po_proposals.the_proposal_was_adjusted_so_that')}</div>` : ''}
        ${edit ? editHtml(s, edit) : childrenHtml(s, current(msg, s))}
        ${done || edit ? '' : `<div class="row po-group-actions">
          <button class="btn sm primary" type="button" data-split-act="split"${off(ctx)} title="${t('backlog_po_proposals.file_the_children_then_update_issue', { issue: s.issue })}">${t('backlog_po_proposals.split')}</button>
          <button class="btn sm ghost" type="button" data-split-act="split-roadmap"${off(ctx)} title="${t('backlog_po_proposals.file_the_children_then_plan_them', { key: esc(DefaultWorkflow.label(splitWorkflow(key))) })}">${t('backlog_po_proposals.split_roadmap')}</button>
          ${workflowSelect(key, ctx)}
          <button class="btn sm ghost" type="button" data-split-act="edit"${off(ctx)} title="${t('backlog_po_proposals.move_a_task_merge_two_children')}">${t('backlog_po_proposals.edit')}</button>
          ${noteHtml(key)}</div>`}
      </div>`;
  }

  function splitsHtml(ctx, msg) {
    const list = msg.answer?.splits || [];
    if (!list.length) return '';
    return `<div class="po-sec"><div class="sup-h">${t('backlog_po_proposals.split_what_is_too_big')}</div>${list.map((s) => splitHtml(ctx, msg, s)).join('')}</div>`;
  }

  // ---- epics (#138) -------------------------------------------------------------------------------------
  function epicsHtml(ctx, msg) {
    const ep = msg.answer?.epics;
    if (!ep || !(ep.place?.length || ep.create?.length || ep.merge?.length || ep.split?.length)) return '';
    const byEpic = new Map();
    for (const p of ep.place || []) { if (!byEpic.has(p.epic)) byEpic.set(p.epic, []); byEpic.get(p.epic).push(p); }
    const action = (key, label, title) => {
      const done = appliedEpic(ctx, msg, key);
      return done ? `<span class="badge live">${esc(done.epic?.id || '')} ${t('backlog_po_proposals.done')}</span>`
        : `<div class="row po-group-actions"><button class="btn sm primary" type="button" data-epic-act="${esc(key)}"${off(ctx)} title="${esc(title)}">${label}</button>${noteHtml(epicKey(msg, key))}</div>`;
    };
    const place = [...byEpic].map(([id, list]) => `<div class="po-group${appliedEpic(ctx, msg, `place:${id}`) ? ' applied' : ''}">
        <div class="po-group-head"><span class="badge bl-epic" title="${t('backlog_po_proposals.epic_id', { id: esc(id) })}">${esc(list[0].epicTitle || epicTitle(id))}</span><span class="po-issues">${list.map((p) => ctx.issueRef(p.issue)).join('')}</span></div>
        <ul class="po-list small">${list.map((p) => `<li>#${p.issue} ${esc(ctx.issueOf(p.issue)?.title || '')}${p.reason ? ` <span class="muted">${esc(p.reason)}</span>` : ''}</li>`).join('')}</ul>
        ${action(`place:${id}`, 'Place in epic', `Move ${list.map((p) => `#${p.issue}`).join(', ')} into this epic`)}
      </div>`).join('');
    const create = (ep.create || []).map((c, n) => `<div class="po-group${appliedEpic(ctx, msg, `create:${n}`) ? ' applied' : ''}">
        <div class="po-group-head"><b class="po-split-title" title="${esc(c.title)}">${esc(c.title)}</b><span class="badge">${t('backlog_po_proposals.new_epic')}</span><span class="po-issues">${c.issues.map(ctx.issueRef).join('')}</span></div>
        ${c.goal ? `<div class="small">${esc(c.goal)}</div>` : ''}
        ${action(`create:${n}`, 'Create epic', `Create the epic and place ${c.issues.map((x) => `#${x}`).join(', ')} in it`)}
      </div>`).join('');
    const advice = [
      ...(ep.merge || []).map((m) => `<li>${t('backlog_po_proposals.merge')} ${m.epics.map((id) => `<span class="badge bl-epic">${esc(epicTitle(id))}</span>`).join(' + ')} ${esc(m.reason)}</li>`),
      ...(ep.split || []).map((s) => `<li>${t('backlog_po_proposals.split')} <span class="badge bl-epic">${esc(epicTitle(s.epic))}</span> ${esc(s.reason)}</li>`),
    ].join('');
    return `<div class="po-sec"><div class="sup-h">${t('backlog_po_proposals.epics')}</div>
        ${place ? `<div class="small muted">${t('backlog_po_proposals.place_in_existing_epics')}</div>${place}` : ''}
        ${create ? `<div class="small muted">${t('backlog_po_proposals.epics_to_create')}</div>${create}` : ''}
        ${advice ? `<div class="small muted">${t('backlog_po_proposals.epics_to_merge_or_split')}</div><ul class="po-list">${advice}</ul>` : ''}
      </div>`;
  }

  // ---- the owner's clicks -------------------------------------------------------------------------------
  async function fileSplit(ctx, msg, s, roadmap) {
    const key = splitKey(msg, s);
    const p = current(msg, s);
    const simulated = devMode();
    if (!simulated && !await confirmDialog(t('backlog_po_proposals.split_issue_into_length_issues', { issue: s.issue, length: p.children.length }),
      t(p.parent === 'close' ? 'backlog_po_proposals.split_filed_parent_closed' : 'backlog_po_proposals.split_filed_parent_task_list', { count: p.children.length, issue: s.issue }), t('backlog_po_proposals.split'))) return;
    busy = true;
    notes.delete(key);
    ctx.render();
    try {
      const out = await api.splitProductOwnerIssue(ctx.projectId, msg.ts, clone(p), simulated);
      ctx.setMessages(out.messages);
      if (out.backlog) window.BacklogActions.showData(out.backlog);
      if (out.syncError) notes.set(key, { text: t('backlog_po_proposals.filed_but_the_sync_failed', { error: out.syncError }), error: true });
      if (roadmap && out.preview) notes.set(key, { text: t('backlog_po_proposals.preview_children_planned_in_roadmap') });
      if (roadmap && !out.preview) {
        const workflow = splitWorkflow(key);
        const workflowName = (state.workflows || []).find((w) => w.file === workflow)?.name;
        const stages = [...new Set(out.children.map((c) => c.stage))].sort((a, b) => a - b).map((st) => ({
          name: `#${s.issue} split, stage ${st}`,
          note: '',
          items: out.children.filter((c) => c.stage === st && c.number).map((c) => ({ workflow, ...(workflowName ? { workflowName } : {}), issues: [c.number], inputs: {}, mock: !!state.simulationOnly, reason: `Split from #${s.issue}.`, origin: msg.ts })),
        })).filter((st) => st.items.length);
        if (stages.length) window.BacklogActions.showRoadmap(await api.proposeRoadmap(ctx.projectId, { stages }, false));
      }
    } catch (e) {
      notes.set(key, { text: errMsg(e), error: true });
    } finally {
      busy = false;
      ctx.render();
    }
  }

  async function applyEpic(ctx, msg, key) {
    const ep = msg.answer?.epics;
    let epic;
    let issues;
    let what;
    if (key.startsWith('place:')) {
      const id = key.slice('place:'.length);
      issues = (ep.place || []).filter((p) => p.epic === id).map((p) => p.issue);
      epic = { id };
      what = [t('backlog_po_proposals.place_issues_in_epic', { count: issues.length, epic: epicTitle(id) }), t('backlog_po_proposals.place_issues_detail', { issues: issues.map((n) => `#${n}`).join(', ') }), t('backlog_po_proposals.place')];
    } else {
      const c = ep.create?.[Number(key.slice('create:'.length))];
      if (!c) return;
      issues = c.issues;
      epic = { title: c.title, goal: c.goal };
      what = [t('backlog_po_proposals.create_the_epic', { title: c.title }), t('backlog_po_proposals.create_the_epic_detail', { issues: issues.map((n) => `#${n}`).join(', ') }), t('backlog_po_proposals.create')];
    }
    const simulated = devMode();
    if (!simulated && !await confirmDialog(...what)) return;
    const k = epicKey(msg, key);
    busy = true;
    notes.delete(k);
    ctx.render();
    try {
      const out = await api.applyProductOwnerEpic(ctx.projectId, msg.ts, key, epic, issues, simulated);
      ctx.setMessages(out.messages);
      if (out.backlog) window.BacklogActions.showData(out.backlog);
      if (out.syncError) notes.set(k, { text: `Done, but the backlog sync failed: ${out.syncError}`, error: true });
    } catch (e) {
      notes.set(k, { text: errMsg(e), error: true });
    } finally {
      busy = false;
      ctx.render();
    }
  }

  // A click in the conversation; true when it was a split's or an epic's.
  function onClick(e, ctx) {
    const b = e.target.closest('[data-split-act], [data-split-parent], [data-split-merge], [data-epic-act]');
    if (!b) return false;
    const msg = ctx.messages[Number(b.closest('[data-msg]')?.dataset.msg)];
    if (!msg?.answer) return true;
    if (b.dataset.epicAct) { applyEpic(ctx, msg, b.dataset.epicAct); return true; }
    const s = (msg.answer.splits || []).find((x) => x.issue === Number(b.closest('[data-split]')?.dataset.split));
    if (!s) return true;
    const key = splitKey(msg, s);
    const edit = edits.get(key);
    const act = b.dataset.splitAct;
    if (act === 'split' || act === 'split-roadmap') { fileSplit(ctx, msg, s, act === 'split-roadmap'); return true; }
    if (act === 'edit') edits.set(key, clone(current(msg, s)));
    else if (act === 'cancel') edits.delete(key);
    else if (act === 'save' && edit) {
      const children = edit.children.filter((c) => c.tasks.length && c.title.trim());
      if (children.length < 2) { notes.set(key, { text: 'A split keeps at least two children with tasks and a title.', error: true }); edits.delete(key); } else {
        saved.set(key, { ...edit, children });
        edits.delete(key);
        notes.delete(key);
      }
    } else if (b.dataset.splitParent && edit) edit.parent = b.dataset.splitParent;
    else if (b.dataset.splitMerge && edit) {
      const i = Number(b.dataset.splitMerge);
      const [next] = edit.children.splice(i + 1, 1);
      if (next) edit.children[i].tasks = [...edit.children[i].tasks, ...next.tasks].sort((x, y) => x - y);
    }
    ctx.render();
    return true;
  }

  // The edit form's fields change the proposal being edited (no redraw while typing).
  function onInput(e, ctx) {
    const el = e.target;
    const box = el.closest('[data-split]');
    const msg = box && ctx.messages[Number(el.closest('[data-msg]')?.dataset.msg)];
    const s = msg?.answer?.splits?.find((x) => x.issue === Number(box.dataset.split));
    // the children's workflow (#195): kept for this split, the Split + roadmap tooltip follows it
    if (s && el.dataset.splitWf != null) {
      workflowOf.set(splitKey(msg, s), el.value);
      if (e.type === 'change') ctx.render();
      return true;
    }
    const edit = s && edits.get(splitKey(msg, s));
    if (!edit) return false;
    if (el.dataset.splitTitle != null) edit.children[Number(el.dataset.splitTitle)].title = el.value;
    else if (el.dataset.splitStage != null) edit.children[Number(el.dataset.splitStage)].stage = Math.max(1, Number(el.value) || 1);
    else if (el.dataset.splitCx != null) edit.children[Number(el.dataset.splitCx)].complexity = Number(el.value);
    else if (el.dataset.splitTask != null) {
      const k = Number(el.dataset.splitTask);
      edit.children.forEach((c, i) => { c.tasks = c.tasks.filter((x) => x !== k); if (i === Number(el.value)) c.tasks = [...c.tasks, k].sort((x, y) => x - y); });
    } else return false;
    return true;
  }

  window.BacklogPoProposals = { epicsHtml, onClick, onInput, splitsHtml };
})();
