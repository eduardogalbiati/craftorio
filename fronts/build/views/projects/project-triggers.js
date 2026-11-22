/* global api */
// #568: the "Platform triggers" card of a project's page (Projects › Overview, views/project/project.js).
// The rules are the `triggers:` of the repository's .craftorio/project.yaml at HEAD (accepted per commit,
// packages/engine/domains/triggers/triggers.js), read with api.triggersStatus (service/areas/triggers.js)
// with the owner's switch (Settings › Execution › Platform triggers), the last event seen and the runs the
// triggers started. A refused rule (an unknown workflow, a missing label...) is listed apart as ignored.
// The card is hidden when the repository declares no trigger. Uses app.js globals ($, esc, t).

window.ProjectTriggers = (() => {
  let shown = 0; // the latest show() call: an older answer arriving late draws nothing

  // a rule's event in plain words: "issue labelled ready", "@orchestrator comment on a pull request", "failed CI on main"
  function eventText(rule) {
    if (rule.on === 'issue_labeled') return t('project.triggers.event_issue_labeled', { label: rule.label || '?' });
    if (rule.on === 'pr_comment') return t('project.triggers.event_pr_comment', { mention: rule.mention || '?' });
    if (rule.on === 'ci_failed') return rule.branch ? t('project.triggers.event_ci_failed', { branch: rule.branch }) : t('project.triggers.event_ci_failed_any');
    return rule.on || t('project.triggers.event_unknown');
  }

  const when = (iso) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : ''; };

  function lastEventHtml(ev) {
    if (!ev) return esc(t('project.triggers.no_event'));
    const what = esc(t(`project.triggers.kind_${ev.kind}`) || ev.kind);
    const link = ev.url ? `<span class="mono small text-cut" title="${esc(ev.url)}">${esc(ev.url)}</span>` : `<span class="mono small">${esc(ev.id)}</span>`;
    const failed = ev.error ? `<div class="warn-text small text-cut" data-testid="project-triggers-last-error" title="${esc(ev.error)}">${esc(t('project.triggers.start_failed', { problem: ev.error }))}</div>` : '';
    return `${what} ${link} <span class="muted small">${esc(when(ev.at))}</span>${failed}`;
  }

  function runsHtml(runs) {
    if (!runs.length) return esc(t('project.triggers.no_runs'));
    return `<ul class="pj-trig-runs">${runs.slice(0, 5).map((r) => `<li><span class="mono text-cut" title="${esc(r.runId)}">${esc(r.runId)}</span> <span class="badge">${esc(r.workflow)}</span> <span class="muted small">${esc(when(r.at))}</span></li>`).join('')}</ul>`;
  }

  function cardHtml(s) {
    const on = !!s.enabled && s.intervalMs > 0;
    const rules = s.rules.map((r) => `<li data-testid="project-trigger-rule">${esc(eventText(r))} → <span class="mono">${esc(r.workflow)}</span></li>`).join('');
    const refused = (s.refused || []).map((r) => `<li class="warn-text small" data-testid="project-trigger-invalid" title="${esc(r.problem)}">${esc(t('project.triggers.invalid', { event: eventText(r), workflow: r.workflow || '?', problem: r.problem }))}</li>`).join('');
    return `
      <div class="pj-wf" data-testid="project-triggers-card">
        <div class="pj-wf-head"><span class="pj-wf-title">${t('project.triggers.title')}</span>
          <span class="badge${on ? ' ok' : ''}" data-testid="project-triggers-state" data-state="${on ? 'on' : 'off'}">${t(on ? 'project.triggers.on' : 'project.triggers.off')}</span>
          <span class="muted small">${esc(t(on ? 'project.triggers.on_help' : 'project.triggers.off_help', { minutes: Math.round(s.intervalMs / 60000) }))}</span></div>
        ${rules ? `<ul class="pj-trig-rules">${rules}</ul>` : ''}
        ${refused ? `<ul class="pj-trig-rules">${refused}</ul>` : ''}
        <dl class="kv">
          <dt>${t('project.triggers.last_event')}</dt><dd data-testid="project-triggers-last-event">${lastEventHtml(s.lastEvent)}</dd>
          <dt>${t('project.triggers.runs')}</dt><dd data-testid="project-triggers-runs">${runsHtml(s.runs || [])}</dd>
        </dl>
      </div>`;
  }

  /** Draws the card of project `p` into `box` (empty when the repository declares no trigger). */
  async function show(p, box) {
    if (!box) return;
    const call = ++shown;
    if (!p?.id) { box.innerHTML = ''; return; }
    let s;
    try { s = await api.triggersStatus(p.id); } catch { s = null; }
    if (call !== shown) return;
    box.innerHTML = s && (s.rules.length || (s.refused || []).length) ? cardHtml(s) : '';
  }

  return { show };
})();
