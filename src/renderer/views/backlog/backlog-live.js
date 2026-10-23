// Backlog › Roadmap kept live without redrawing it (#491) and the base check's card (#465), used by
// backlog-roadmap.js (re-exported as BacklogRoadmap.patch / mergeState) and backlog.js's liveReload.
// patch: the list drawn again with its item rows kept in place; mergeState: the light backlog:state
// (src/backlog.js backlogState) merged into the Backlog shown, or null when only the full read can
// tell; readLight: that state read with its key and mark; baseCheckHtml / baseCheckTerm: the "Base check: running since HH:MM on <commit>" card in the
// roadmap's bar and its read-only log terminal (term-dock.js termButtons / termAction).
// Uses app.js globals (esc, t).
(() => {
  // the list drawn again with its item rows kept: when the same items are in the same stages and
  // order, each row ([data-item]) keeps its element and only its attributes and content change, so a
  // live refresh never replaces the row under the owner's pointer and scroll; an item or a stage added,
  // removed or moved draws the whole list. Answers whether the rows were kept.
  function patch(list, markup) {
    const tpl = document.createElement('template');
    tpl.innerHTML = markup;
    if (!tpl.content?.querySelectorAll || !list?.querySelectorAll) {
      list.innerHTML = markup;
      return false;
    }
    const rows = (root) => [...root.querySelectorAll('.rm-item[data-item]')];
    const order = (els) => els.map((el) => `${el.dataset.stage}:${el.dataset.item}`).join('|');
    const before = rows(list);
    const after = rows(tpl.content);
    const stages = (root) => root.querySelectorAll('.rm-stage').length;
    if (!before.length || order(before) !== order(after) || stages(list) !== stages(tpl.content)
      || new Set(after.map((el) => el.dataset.item)).size !== after.length) {
      list.innerHTML = markup;
      return false;
    }
    after.forEach((fresh, k) => {
      const row = before[k];
      for (const a of [...row.attributes]) if (!fresh.hasAttribute(a.name)) row.removeAttribute(a.name);
      for (const a of [...fresh.attributes]) if (row.getAttribute(a.name) !== a.value) row.setAttribute(a.name, a.value);
      if (row.innerHTML !== fresh.innerHTML) row.innerHTML = fresh.innerHTML;
      fresh.replaceWith(row);
    });
    list.replaceChildren(...tpl.content.childNodes);
    return true;
  }

  // each item's status, runs and live run, the stages' pauses, the roadmap's state, the queue, the
  // refresh banner and the base check. Null when only the whole Backlog can tell: the stages were
  // edited (`shape`), a stage or an item the screen does not know, an item that ended (its error, PR
  // and costs come with the full read), an item on another run (its workflow, steps and agents come
  // with the full read) or the roadmap's state changed.
  const shape = (stages) => (stages || []).map((s) => `${s.id}:${(s.items || []).map((x) => x.id).join(',')}`).join('|');
  function mergeState(data, light) {
    const r = data?.roadmap;
    const lr = light?.roadmap;
    if (!r || !lr || (r.shape && lr.shape !== r.shape) || lr.state !== r.state) return null;
    if (shape(r.stages) !== shape(lr.stages)) return null;
    const live = window.RoadmapModel?.LIVE_ITEM_STATES;
    if (!live) return null;
    const items = new Map(lr.stages.flatMap((s) => s.items.map((x) => [x.id, x])));
    const stale = r.stages.some((s) => s.items.some((x) => {
      const l = items.get(x.id);
      return l.runId !== (x.runId || null) || (l.status !== (x.status || null) && !live.has(l.status));
    }));
    if (stale) return null;
    const pauses = new Map(lr.stages.map((s) => [s.id, s.pause]));
    const queue = light.queue && data.queue ? {
      ...data.queue,
      ...light.queue,
      items: (light.queue.items || []).map((q) => ({ ...(data.queue.items || []).find((o) => o.id === q.id), ...q })),
    } : light.queue ?? data.queue;
    return {
      ...data,
      queue,
      refresh: light.refresh ? { ...data.refresh, ...light.refresh } : data.refresh,
      baseCheck: light.baseCheck ?? null,
      roadmap: {
        ...r,
        updatedAt: lr.updatedAt,
        scope: lr.scope,
        pausedBy: lr.pausedBy,
        error: lr.error,
        stages: r.stages.map((s) => ({
          ...s,
          pause: pauses.get(s.id) || undefined,
          items: s.items.map((x) => {
            const { run, status, runId, runs, waiting } = items.get(x.id);
            return { ...x, status, runId, runs, waiting, ...(run ? { run: { ...x.run, ...run } } : {}) };
          }),
        })),
      },
    };
  }

  // backlog.js's live reload: the light state, its key without the timers that move every second
  // (`elapsed`), and its `mark`, the roadmap's stages and `updatedAt` (whether a full read is needed)
  async function readLight(api, id) {
    const light = await api.getBacklogState(id).catch(() => null);
    const lr = light?.roadmap;
    return {
      key: `${id}:${JSON.stringify(light, (k, v) => (k === 'elapsed' ? undefined : v))}`,
      light,
      mark: lr ? `${id}:${lr.shape}:${lr.updatedAt}` : null,
    };
  }

  // the base check (#405) after a local merge: "running since HH:MM on <commit>" while its suite runs,
  // then green or red with the count; its log follows live in a read-only terminal either way.
  // `clock`: the roadmap's HH:MM in the owner's time zone. The terminal's inline message is kept per
  // check (`termMsg`), since the bar is drawn again on every live reload
  let termMsg = null;
  function baseCheckHtml(c, clock) {
    if (!c?.status) return '';
    const commit = String(c.commit || '').slice(0, 8);
    const text = c.status === 'running' ? t('backlog_roadmap.base_check_running', { time: clock(c.startedAt), commit })
      // #527: another run's whole suite holds the machine's suite slot
      : c.status === 'waiting' ? t('backlog_roadmap.base_check_waiting')
      : c.status === 'green' ? t('backlog_roadmap.base_check_green', { commit })
        : c.status === 'red' ? t('backlog_roadmap.base_check_red', { count: c.failures ?? 0, commit })
          : t('backlog_roadmap.base_check_failed', { error: c.error || '' });
    const msg = termMsg?.key === `${c.commit}:${c.startedAt}` ? termMsg : null;
    return `<span class="rm-base-check small" data-testid="base-check-card" data-status="${esc(c.status)}"><span class="badge">${t('backlog_roadmap.base_check')}</span> <span title="${esc(c.commit || '')}">${esc(text)}</span>${termButtons('base-check', t('backlog_roadmap.follow_the_base_check_log'))}<span class="muted${msg?.error ? ' error' : ''}" data-term-msg data-check="${esc(`${c.commit}:${c.startedAt}`)}">${esc(msg?.text || '')}</span></span>`;
  }
  async function baseCheckTerm({ ctx, target }, btn) {
    const msg = await termAction(btn, { sessionId: ctx.projectId, runId: null, label: t('backlog_roadmap.base_check') });
    const line = target.closest('.rm-base-check')?.querySelector('[data-term-msg]');
    if (line) {
      termMsg = { key: line.dataset.check, text: msg.text, error: !!msg.error };
      line.textContent = msg.text;
      line.classList.toggle('error', !!msg.error);
    }
  }

  window.BacklogLive = {
    baseCheckHtml,
    baseCheckTerm,
    mergeState,
    patch,
    readLight,
  };
})();
