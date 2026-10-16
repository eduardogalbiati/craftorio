// What every list shows of a run (#84): its issues (issuesOfRun, issueRefs), its display title
// (runTitle, runLabel, runTitleHtml with the pencil and editRunTitle, the inline rename), its PR
// (runPr, prBadge, askPrStates: the PR states the lists show, read on demand) and the record of
// both from the service (state.runMeta: noteRunMeta, onRunMeta on 'run:meta'). Moved out of app.js;
// its names stay globals (window.runTitle, runTitleHtml, runPrBadge, noteRunMeta, askPrStates for
// the screens). Uses app.js globals ($, esc, state, errMsg, showToast, scheduleRender), RunBadges
// (run-badges.js) and renderRunListsSoon (run-list.js), all read when called, never as it loads.

// The issues a run implements (Backlog; several for a group) and their "#53, #65" label. Runs
// recorded before groups have a single `issue`.
const issuesOfRun = (r) => r?.issues || (r?.issue ? [r.issue] : []);
const issueRefs = (r) => issuesOfRun(r).map((i) => `#${i.number}`).join(', ');
// The run's display title (#84): the owner's, else its issue or its task's first line, else the
// workflow. r: a run list item ({ runId }) or a window run view ({ id }).
const runMetaOf = (r) => state.runMeta.get(r?.runId || r?.id) || {};
const runTitle = (r) => runMetaOf(r).title || r?.title || RunBadges.defaultTitle(r) || r?.workflow || 'workflow';
const runPr = (r) => runMetaOf(r).pr || r?.pr || null;
// "title · workflow · project" of a run, for toasts, dialogs and tooltips
const runLabel = (r) => {
  const title = runTitle(r);
  return [title, r?.workflow && r.workflow !== title ? r.workflow : null, r?.project].filter(Boolean).join(' · ');
};
// Records what the service says of runs (lists, runs:active, run:meta); a PR without its state
// keeps the state already known for the same URL.
function noteRunMeta(list) {
  for (const r of list || []) {
    const id = r?.runId;
    if (!id) continue;
    const cur = state.runMeta.get(id) || {};
    const next = { ...cur };
    if ('title' in r) { next.title = r.title; next.customTitle = r.customTitle || null; }
    if ('pr' in r) next.pr = r.pr && !r.pr.state && cur.pr?.url === r.pr.url && cur.pr.state ? { ...r.pr, ...pickKeys(cur.pr, ['state', 'detail', 'checkedAt']) } : r.pr;
    state.runMeta.set(id, next);
  }
}
const pickKeys = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
function onRunMeta(m) {
  noteRunMeta([m]);
  renderRunListsSoon();
  scheduleRender();
  window.runChatRefreshHead?.();
  window.renderBacklogCards?.();
}
// The PR states the lists show and the service has not read yet (finished runs: on demand, cached
// by the service), one request per run at a time.
const prAsked = new Set();
function askPrStates(list) {
  for (const r of list || []) {
    const id = r?.runId || r?.id;
    const pr = runPr(r);
    if (!pr?.url || pr.state || prAsked.has(id)) continue;
    prAsked.add(id);
    Promise.resolve(api.runPrState?.(id))
      .then((p) => { if (p) onRunMeta({ runId: id, pr: p }); })
      .catch(() => {})
      .finally(() => setTimeout(() => prAsked.delete(id), 60 * 1000));
  }
}
const prBadge = (r, opts) => RunBadges.prBadgeHtml(runPr(r), opts);
// The title with its pencil (shown on hover): a click edits it inline, Enter saves, Esc cancels,
// an empty title goes back to the default.
const PENCIL_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Zm-2.677 2.323L3.13 11.43a.25.25 0 0 0-.064.108l-.558 1.953 1.953-.558a.25.25 0 0 0 .108-.064l6.62-6.62Z"/></svg>';
function runTitleHtml(r, runId = r?.runId || r?.id) {
  return `<span class="run-title" data-title-run="${esc(runId)}"><span class="run-title-text">${esc(runTitle(r))}</span><button type="button" class="icon-btn run-title-edit" data-title-edit title="${t('run_meta.rename_this_run_only_its_display')}">${PENCIL_SVG}</button></span>`;
}
function editRunTitle(btn) {
  const box = btn.closest('[data-title-run]');
  const runId = box.dataset.titleRun;
  const meta = state.runMeta.get(runId) || {};
  const input = document.createElement('input');
  input.className = 'run-title-input';
  input.value = meta.customTitle || box.querySelector('.run-title-text').textContent;
  input.placeholder = 'Default title';
  box.replaceChildren(input);
  input.focus({ preventScroll: true });
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    input.remove(); // every place draws the title again below
    if (save) {
      try { onRunMeta(await api.setRunTitle(runId, value)); } catch (e) { showToast('Could not rename the run', errMsg(e)); }
    }
    $('#run-summary')._html = null; // drawn again even when nothing changed (Esc)
    window.runChatRefreshHead?.();
    renderRunListsSoon();
    scheduleRender();
  };
  input.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
  input.onclick = (e) => e.stopPropagation();
  input.onblur = () => finish(true);
}
window.runTitle = runTitle;
window.runTitleHtml = runTitleHtml;
window.runPrBadge = prBadge;
window.noteRunMeta = noteRunMeta;
window.askPrStates = askPrStates;
