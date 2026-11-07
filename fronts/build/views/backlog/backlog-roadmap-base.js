// Backlog › Roadmap: a Start answered by the local base question (#805, roadmap:start's { confirm, baseCheck }),
// used by backlog-roadmap.js. asked: keeps the Start that was asked about (its mode, scope and "go live") and answers
// whether it was a question; html: the notice in the header's activity band, with the base's state from baseCheck
// (the engine's `confirm` is English) and its choices; choose: the same Start again with the choice, the notice gone.
// A diverged base has no update: it is never moved, the notice points to the Backlog's Update and push.
// Uses app.js globals (api, esc, t).
(() => {
  let question = null; // { projectId, simulated, scope, live, baseCheck }

  function asked(ctx, answer, start) {
    question = answer?.confirm && answer.baseCheck ? { ...start, projectId: ctx.projectId, baseCheck: answer.baseCheck } : null;
    return !!question;
  }

  function html(data) {
    if (!question || (data?.projectId && data.projectId !== question.projectId)) return '';
    const { base, behind, canUpdate, state } = question.baseCheck;
    const text = t(state === 'diverged' ? 'backlog_roadmap.base_diverged' : 'backlog_roadmap.base_behind', { count: behind, base });
    const update = canUpdate ? `<button class="btn sm primary" type="button" data-rm="base-update" data-testid="roadmap-base-update">${esc(t('backlog_roadmap.base_update'))}</button> ` : '';
    return `<div class="small rm-head-line" role="status" data-testid="roadmap-base-notice"><span class="warn-text">${esc(text)}</span><span class="spacer"></span>${update}<button class="btn sm ghost" type="button" data-rm="base-continue" data-testid="roadmap-base-continue">${esc(t('backlog_roadmap.base_continue'))}</button></div>`;
  }

  async function choose(ctx, choice) {
    if (!question) return;
    const { simulated, scope, live } = question;
    question = null;
    ctx.setData(await api.startRoadmap(ctx.projectId, simulated, scope, choice));
    if (live) ctx.setData(await api.setRoadmapLive(ctx.projectId, true));
  }

  window.RoadmapBaseNotice = {
    asked,
    choose,
    html,
  };
})();
