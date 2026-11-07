// Backlog › Roadmap: the notice under a stage waiting for its PR's merge (#807, RoadmapModel.mergeWait), used by
// backlog-roadmap.js (stageHtml, its CLICKS entry `[data-rm-merge-wait]`). It names the PR, offers Move on (the
// item skipped: the next stage starts from the base, without that work) and Stack (the next stage starts from the
// waiting stage's branch, its PR targets it; not drawn in Fork + PR mode, #738; past the depth limit its reason
// instead), and names the files both stages change (each item's expected files: the paths its issues cite,
// CityImpact.expectedFiles, #375/#427). `byNumber` (the backlog's issues by number), `refs(item)` (its issue
// refs) and `modeOf(item)` (its effective run mode, the workflow's default and the project's runDefaults
// resolved) come from backlog-roadmap.js. stackedHtml: the line of a stacked item's card (`stackedOn`, the
// service's roadmapView). Uses app.js globals (esc, t), RoadmapModel and CityImpact.
(() => {
  // the files an item expects to change, from the bodies of its issues
  function filesOf(x, byNumber, refs) {
    if (!window.CityImpact || !byNumber || !refs) return x.files || [];
    const body = refs(x).map((i) => byNumber.get(i.number)?.body || '').join('\n\n');
    // no repository listing here: a cited path the repository lacks comes back in newFiles, so both count
    const e = CityImpact.expectedFiles({ body });
    return [...new Set([...(x.files || []), ...[...e.files, ...e.newFiles].map((f) => f.path)])];
  }

  function html(r, s, { byNumber = null, refs = null, modeOf = null } = {}) {
    const w = r ? RoadmapModel.mergeWait(r, s, { filesOf: (x) => filesOf(x, byNumber, refs), modeOf }) : null;
    if (!w) return '';
    const item = (r.stages[s]?.items || []).find((x) => x.id === w.itemId) || {};
    const pr = `#${w.pr.number}`;
    const link = `<a class="link-btn small" href="${esc(w.pr.url)}" target="_blank" rel="noopener" draggable="false" data-testid="roadmap-merge-wait-pr-link">${esc(pr)}</a>`;
    const hint = t('backlog_roadmap.merge_wait.move_on_hint', { base: item.inputs?.base_branch || 'main', pr });
    const button = (action, label, tip) => `<button class="btn sm ghost" type="button" data-rm-merge-wait="${action}" data-item="${esc(w.itemId)}" data-testid="roadmap-merge-wait-${action === 'skip' ? 'move-on' : 'stack'}" title="${esc(tip)}">${esc(label)}</button>`;
    const moveOn = w.moveOn.allowed ? button('skip', t('backlog_roadmap.merge_wait.move_on'), hint) : '';
    const fork = String(item.effectiveMode || (modeOf ? modeOf(item) : null) || item.inputs?.mode || '') === 'fork';
    // refused: the depth limit as a badge; another reason (a release before the next stage) on a disabled Stack's hover
    const deep = w.stack.reason === t('roadmap.stack_depth_limit', { max: RoadmapModel.MAX_STACK_DEPTH });
    const stack = fork ? '' : w.stack.allowed ? button('stack', t('backlog_roadmap.merge_wait.stack'), t('backlog_roadmap.merge_wait.stack_hint', { pr }))
      : deep ? `<span class="badge" data-testid="roadmap-merge-wait-stack-refused" title="${esc(w.stack.reason || '')}">${esc(t('backlog_roadmap.merge_wait.stack_depth_limit', { max: RoadmapModel.MAX_STACK_DEPTH }))}</span>`
        : `<button class="btn sm ghost" type="button" disabled data-testid="roadmap-merge-wait-stack-refused" title="${esc(w.stack.reason || '')}">${esc(t('backlog_roadmap.merge_wait.stack'))}</button>`;
    const overlap = w.overlap.length ? `<div class="small warn-text" data-testid="roadmap-merge-wait-overlap" title="${esc(w.overlap.join('\n'))}">${esc(t('backlog_roadmap.merge_wait.overlap', { files: w.overlap.join(', ') }))}</div>` : '';
    return `<div class="small rm-head-line" role="status" data-testid="roadmap-merge-wait-notice" data-stage="${s}">
      <span>${esc(t('backlog_roadmap.merge_wait.title'))} ${link}.</span> <span class="muted">${esc(hint)}</span><span class="spacer"></span>${moveOn} ${stack}
    </div>${overlap}`;
  }

  // a stacked item's card: the branch (and PR) it builds on, the full branch on hover
  function stackedHtml(x) {
    const on = x?.stackedOn;
    if (!on?.branch) return '';
    return `<div class="small muted" data-testid="roadmap-item-stacked-on" title="${esc(on.branch)}">${esc(t('backlog_roadmap.stacked_on', { branch: on.branch }))}${on.prNumber ? ` (#${esc(on.prNumber)})` : ''}</div>`;
  }

  window.RoadmapMergeWait = { html, stackedHtml };
})();
