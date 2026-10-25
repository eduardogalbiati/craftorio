// The Code & Build front's Home card (phase 3 of docs/reorganisation-study-2026-10.md, decision 5;
// the kit's home-cards.js): the flow strip's Backlog To do, Running, Merged locally and Released
// stages with their counts (a count opens the board's column, Workflows › Runs on the project's runs
// in progress, or the Releases screen), the "What needs you" rows of the roadmap (its runs waiting at
// a gate in another app, its failed items, each with Open run / Open roadmap) and "Today"'s next
// roadmap stage. A composition without this front shows none of it. Uses the globals of app.js
// (state, showView, viewRegistry, t) at call time, packages/shared/roadmap-model.js and
// backlog-archive.js, and the Backlog's window.BacklogActions (views/backlog/backlog.js).
(function () {
  const list = (v) => (Array.isArray(v) ? v : []);
  // the roadmap's items, each with its stage's number (1-based) and name
  const items = (own) => list(own.backlog?.roadmap?.stages).flatMap((s, n) => list(s.items).map((x) => ({ ...x, stage: n + 1, stageName: s.name || t('dashboard.stage_n', { n: n + 1 }) })));
  // "#21 Refund a failed payment" (+ how many more), else the item's workflow
  function itemTitle(x) {
    const issues = list(x.issues);
    if (!issues.length) return x.workflow || 'Roadmap item';
    return `#${issues[0].number}${issues[0].title ? ` ${issues[0].title}` : ''}${issues.length > 1 ? ` +${issues.length - 1} more` : ''}`;
  }
  // the board's columns: no epic (#253), no archived issue (#238)
  const onBoard = (i) => !i.isEpic && window.BacklogArchive?.issueState(i) !== 'archived';
  const column = (own, id) => list(own.backlog?.issues).filter((i) => onBoard(i) && (i.column || (i.state === 'closed' ? 'done' : 'todo')) === id);
  // The project's runs in progress: this app's, and the roadmap's items running in another app.
  function running(own, d) {
    const ids = new Set(list(d.active).filter((r) => (r.projectId || r.project_id) === d.projectId).map((r) => r.runId));
    for (const x of items(own)) if (x.status === 'running' && x.runId) ids.add(x.runId);
    return ids;
  }
  // merged locally: the board's column, and the issues of the commits not pushed yet (a simulated
  // run never moves a card, its local merge still waits for a push)
  const merged = (own) => new Set([...column(own, 'local').map((i) => i.number), ...list(own.backlog?.local?.issues)]);
  // the board's columns for this visit only, the remembered mode kept
  const openBoard = () => { window.BacklogActions?.showColumns(); showView('backlog'); };

  window.HomeCards.register({
    id: 'build',
    order: 20,
    async read({ projectId, api, read }) {
      const [backlog, releases] = await Promise.all([
        read(() => projectId && api.getBacklog(projectId)),
        read(() => projectId && api.listReleases(projectId)),
      ]);
      return { backlog: backlog || null, releases: releases || null };
    },
    stages: [
      { id: 'todo', order: 40, view: 'backlog', count: (own) => column(own, 'todo').length, open: openBoard },
      {
        id: 'running',
        order: 50,
        view: 'workflows',
        count: (own, d) => running(own, d).size,
        // the runs in progress of the header's project (the search matches its name), simulated ones included
        open: (own, d) => {
          state.workflowsTab = 'runs';
          Object.assign(state.wr, { filter: 'running', showSim: true, workflow: '', q: state.projects.find((p) => p.id === d.projectId)?.name || '' });
          showView('workflows');
        },
      },
      { id: 'merged', order: 60, view: 'backlog', count: (own) => merged(own).size, open: openBoard },
      { id: 'released', order: 70, view: 'releases', count: (own) => list(own.releases?.releases).length },
    ],
    needs(own, d, shell) {
      const mine = new Set(shell?.gates || []);
      const all = items(own);
      // the roadmap's runs waiting at a gate in another app: opened there, shown here
      const elsewhere = all.filter((x) => x.status === 'running' && x.waiting && x.runId && !mine.has(x.runId)).map((x) => ({
        kind: 'gate', order: 20, since: x.run?.progress?.at(-1)?.ts || x.run?.startedAt || null, phoneUrl: null,
        title: itemTitle(x), detail: x.run?.gate || t('dashboard.roadmap_stagename', { stageName: x.stageName }),
        button: { label: t('dashboard.open_run'), attr: 'data-home-run', value: x.runId, primary: true },
      }));
      const failed = all.filter((x) => x.status === 'failed').map((x) => ({
        kind: 'failed-item', order: 50, title: itemTitle(x), detail: x.error || t('dashboard.roadmap_stagename', { stageName: x.stageName }),
        button: { label: t('dashboard.open_roadmap'), attr: 'data-home-roadmap', value: String(x.stage) },
      }));
      return [...elsewhere, ...failed];
    },
    today(own) {
      const stages = list(own.backlog?.roadmap?.stages);
      const next = RoadmapModel.currentStage({ stages });
      const nextName = next < 0 ? '' : stages[next].name || t('dashboard.stage_n', { n: next + 1 });
      return [{
        order: 60,
        label: t('dashboard.next_roadmap_stage'),
        value: nextName ? `<button type="button" class="link-btn home-next" data-home-roadmap="${next + 1}" title="${esc(t('dashboard.stage_value_of_length_nextname_open', { value: next + 1, length: stages.length, nextName }))}">${esc(nextName)}</button>` : '—',
        title: nextName ? t('dashboard.the_first_stage_with_work_left') : t('dashboard.no_roadmap_stage_with_work_left'),
      }];
    },
    actions: {
      'data-home-roadmap': (stage) => window.BacklogActions?.openStage(Number(stage)),
    },
  });
})();
