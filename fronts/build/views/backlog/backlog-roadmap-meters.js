// @ts-check
// Backlog › Roadmap: what a roadmap item spent against its estimate, used by backlog-roadmap.js (split out of it on
// 2026-11-27 with the lanes: the file size ratchet, #334). The open row's meters (#282, #206, #215: cost and time, one
// each: the estimate, or the real value against it with a verdict and a bar; meterHtml draws the Progress meter too),
// the run's timer (#272: its working time in the time meter, moved every second by tick), a stage's estimate and real
// total (#215, stageCostHtml), and the row's Progress cell (progressCellHtml: a ring with the run's estimated percent,
// then two bars, cost and time, filled to what is spent of the estimate; tick moves the time bar too).
// Test ids: roadmap-meter-cost, roadmap-meter-time, roadmap-meter-progress (data-verdict none | estimate | ok | warn |
// over; the progress meter: the run's state), roadmap-run-timer (data-tone), roadmap-status (the Progress cell),
// roadmap-ring (data-percent).
// Uses app.js globals (esc, t), Estimates, RunProgress and RoadmapModel.
(() => {
  const plural = (n, key) => t(key, { count: n }); // a plural catalog entry ({ one, other }) picked by n
  const CLOCK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></svg>'; // i18n-ignore
  const money = (n, approx = false) => `${approx ? '≈ ' : ''}$${Number(n || 0).toFixed(2)}`; // approx (#72): it includes a cost the app does not know
  const mins = (n) => Estimates.formatMinutes(n);

  // #215: a real value against its estimate, coloured by the verdict (Estimates.verdict) with an
  // arrow, so colour is never the only signal; the difference in the tooltip. `fmt` formats a value,
  // `more`: the tooltip's difference ("$7.03 more"), `extra`: more tooltip lines.
  function vsBadge(kind, actual, estimate, fmt, more, extra = [], approx = false) {
    const v = Estimates.verdict(actual, estimate);
    if (!v) return `<span class="badge rm-actual rm-${kind}">${fmt(actual, approx)}</span>`;
    const pct = `${v.percent > 0 ? '+' : v.percent < 0 ? '−' : '±'}${Math.abs(v.percent)}%`;
    const tip = [`${pct}, ${more(v.diff)} than the estimate (${fmt(estimate)})`, ...extra].filter(Boolean).join('\n');
    return `<span class="badge rm-actual rm-${kind} rm-verdict rm-verdict-${v.level}" title="${esc(tip)}"><span class="rm-sign" aria-hidden="true">${v.sign}</span> <b>${esc(fmt(actual, approx))}</b> / ≈ ${esc(fmt(estimate))}</span>`;
  }
  const moneyMore = (d) => `${money(Math.abs(d))} ${d < 0 ? 'less' : 'more'}`;
  const timeMore = (d) => `${mins(Math.abs(d))} ${d < 0 ? 'less' : 'more'}`;
  const topStep = (x) => (x.actualTopStep ? `Longest step: ${x.actualTopStep.step} ${mins(x.actualTopStep.minutes)}` : '');

  // ---- cost and time (#282, #206, #215): one block, a line each ------------------------------------------
  // A planned item: its estimate ("≈ $31.66 · estimate"); one that runs or ran: the real value against
  // the estimate with a verdict (Estimates.verdict: a sign and a colour, never colour alone) and a 3px
  // bar (how much of the estimate is used; past it, full, with a tick where the estimate was); "no
  // estimate yet" without one. data-verdict: none | estimate | ok | warn | over.
  const VERDICT = { good: 'ok', warn: 'warn', bad: 'over' };
  const LEVEL = { ok: 'good', warn: 'warn', over: 'bad' };
  const METER = { cost: ['backlog_roadmap.meter_cost', 'data-testid="roadmap-meter-cost"'], time: ['backlog_roadmap.meter_time', 'data-testid="roadmap-meter-time"'], progress: ['backlog_roadmap.meter_progress', 'data-testid="roadmap-meter-progress"'] }; // #36: keys, read when drawn
  const pctText = (p) => `${p > 0 ? '+' : p < 0 ? '−' : '±'}${Math.abs(p)}%`;
  const barInner = (ratio) => `<i style="width:${Math.min(100, Math.max(0, ratio) * 100).toFixed(1)}%"></i>${ratio > 1 ? `<u style="left:${(100 / ratio).toFixed(1)}%"></u>` : ''}`;
  const verdictInner = (sign, text) => `${sign ? `<span class="rm-sign" aria-hidden="true">${sign}</span> ` : ''}${esc(text)}`;
  // `m`: { verdict, value (html), of?, note? (muted, at the right; noteId: its test id), level + text + sign? (the verdict), ratio? (the bar), title? }
  function meterHtml(kind, m) {
    const [label, id] = METER[kind];
    const right = m.text ? `<span class="rm-meter-verdict rm-verdict rm-verdict-${m.level}">${verdictInner(m.sign, m.text)}</span>` : m.note ? `<span class="rm-meter-note muted"${m.noteId ? ` data-testid="${m.noteId}"` : ''}>${esc(m.note)}</span>` : '';
    return `<div class="rm-meter" ${id} data-verdict="${m.verdict}"${m.title ? ` title="${esc(m.title)}"` : ''}><div class="rm-meter-row"><span class="rm-meter-label">${t(label)}</span><span class="rm-meter-value">${m.value}</span>${m.of ? `<span class="rm-meter-of muted">${esc(m.of)}</span>` : ''}<span class="spacer"></span>${right}</div>${m.ratio != null ? `<div class="rm-meter-bar" aria-hidden="true">${barInner(m.ratio)}</div>` : ''}</div>`;
  }
  // a real value against its estimate; `running`: within the estimate reads "on track"
  function againstHtml(kind, actual, estimate, /** @type {{ fmt: any, more: any, running?: any, extra?: any[], approx?: any }} */ { fmt, more, running = false, extra = [], approx = false }) {
    const v = Estimates.verdict(actual, estimate);
    if (!v) return meterHtml(kind, { verdict: 'none', value: esc(fmt(actual, approx)) });
    const onTrack = running && v.level === 'good';
    const tip = [`${pctText(v.percent)}, ${more(v.diff)} than the estimate (${fmt(estimate)})${running ? ', so far' : ''}`, ...extra].filter(Boolean).join('\n');
    return meterHtml(kind, { verdict: VERDICT[v.level], level: v.level, value: esc(fmt(actual, approx)), of: t('backlog_roadmap.meter_of', { value: fmt(estimate) }), sign: onTrack ? '' : v.sign, text: onTrack ? t('backlog_roadmap.on_track') : pctText(v.percent), ratio: actual / estimate, title: tip });
  }
  // the time line of a run at work, from its working time against the estimate (timerTone's levels)
  function liveTime(ms, minutes) {
    const tone = timerTone(ms, minutes);
    if (tone === 'neutral') return { verdict: 'none' };
    const ratio = ms / (minutes * 60000);
    return { verdict: tone, level: LEVEL[tone], sign: tone === 'ok' ? '' : '▲', text: tone === 'ok' ? t('backlog_roadmap.on_track') : pctText(Math.round((ratio - 1) * 100)), ratio };
  }
  function costMeter(x, running) {
    const sim = RoadmapModel.isSimulated(x), e = !sim && x.estimate; // #31: a simulated run spends nothing, whatever its events recorded
    if (!e) return meterHtml('cost', { verdict: 'none', value: sim ? money(0) : x.actualUsd != null ? (running ? t('backlog_roadmap.meter_so_far', { value: money(x.actualUsd, x.actualApprox) }) : money(x.actualUsd, x.actualApprox)) : '—', note: sim ? t('backlog_roadmap.simulated') : t('backlog_roadmap.no_estimate_yet'), title: sim ? '' : [t('backlog_roadmap.no_successful_real_run_of_this'), x.actualApprox ? t('run_list.cost_approx_tip') : ''].filter(Boolean).join('\n') });
    if (x.actualUsd == null) return meterHtml('cost', { verdict: 'estimate', value: `≈ ${money(e.usd)}${e.estimated ? t('backlog_roadmap.meter_est') : ''}`, note: t('backlog_roadmap.meter_estimate'), title: e.basis });
    return againstHtml('cost', x.actualUsd, e.usd, { fmt: money, more: moneyMore, running, extra: [e.basis, x.actualApprox ? t('run_list.cost_approx_tip') : ''], approx: x.actualApprox });
  }
  // `clock`: the run's working time (runClock); while it works, the value is the live timer (#272)
  function timeMeter(x, running, clock) {
    const e = x.estimate;
    const est = e?.minutes > 0 ? e.minutes : 0;
    if (clock && (running || x.actualMinutes == null)) {
      const live = liveTime(clock.ms, est);
      return meterHtml('time', {
        ...live, value: timerHtml(clock, e), of: est ? t('backlog_roadmap.meter_of', { value: mins(est) }) : '', note: est ? '' : t('backlog_roadmap.no_estimate_yet'),
        title: [t('backlog_roadmap.meter_working_time'), e?.timeBasis].filter(Boolean).join('\n'),
      });
    }
    if (x.actualMinutes != null) {
      if (est) return againstHtml('time', x.actualMinutes, est, { fmt: mins, more: timeMore, extra: [topStep(x), e.timeBasis] });
      return meterHtml('time', { verdict: 'none', value: esc(mins(x.actualMinutes)), note: t('backlog_roadmap.no_estimate_yet'), title: topStep(x) });
    }
    if (est) return meterHtml('time', { verdict: 'estimate', value: `≈ ${mins(est)}`, note: t('backlog_roadmap.meter_estimate'), title: e.timeBasis || t('backlog_roadmap.from_runs_past_runs', { runs: e.runs }) });
    return meterHtml('time', { verdict: 'none', value: '—', note: t('backlog_roadmap.no_estimate_yet') });
  }

  // #215: the stage's estimate (its items' costs summed, its longest item's time) and, once every
  // item has ended, its real total against it
  function stageCostHtml(stage, finished) {
    const e = stage.estimate;
    if (!e) return '';
    const plus = e.missing ? ' +' : '';
    const runs = plural(e.runs, 'backlog_roadmap.each_from_past_runs');
    const missing = e.missing ? plural(e.missing, 'backlog_roadmap.items_without_estimate') : '';
    if (finished && stage.actualUsd != null) {
      return vsBadge('cost', stage.actualUsd, e.usd, money, moneyMore, [`The real cost of its items' runs against the sum of their estimates${missing}`, stage.actualApprox ? t('run_list.cost_approx_tip') : ''], stage.actualApprox)
        + (stage.actualMinutes && e.minutes ? vsBadge('time', stage.actualMinutes, e.minutes, mins, timeMore, ['Its longest item\'s real duration against its longest estimate (items run in parallel)']) : '');
    }
    return `<span class="badge rm-estimate" title="${esc(t('backlog_roadmap.the_sum_of_its_items_estimates', { runs, missing }))}">≈ ${money(e.usd)}${plus}</span>`
      + (e.minutes ? `<span class="badge rm-estimate rm-time" title="${esc(t('backlog_roadmap.its_longest_item_s_estimate_its', { runs, missing }))}">≈ ${mins(e.minutes)}${plus}</span>` : '');
  }

  // ---- the run's timer (#272): its working time in the time line, against the item's time estimate ----
  // the clock ("23:41"), its tone against the estimate and the run's working time: RunProgress
  const clockText = (ms) => RunProgress.clockText(ms);
  const timerTone = (ms, minutes) => RunProgress.timerTone(ms, minutes);
  // "23 min of ≈ 22 min (estimate from 30 past runs)"
  function timeAgainst(ms, e) {
    const spent = mins(Math.floor(ms / 60000));
    if (!(e?.minutes > 0)) return t('backlog_roadmap.time_so_far_no_estimate', { spent });
    return t('backlog_roadmap.time_of_estimate', { spent, estimate: mins(e.minutes), basis: e.runs ? plural(e.runs, 'backlog_roadmap.estimate_from_past_runs') : e.timeBasis || t('backlog_roadmap.estimated') });
  }
  // data-tone is what the E2E steps read, data-timer-state the unit tests: the same value
  function timerHtml(clock, e) {
    const tone = timerTone(clock.ms, e?.minutes);
    return `<span class="rm-timer rm-timer-${tone}" role="timer" data-rm-timer="${clock.since ?? ''}" data-estimate="${Number(e?.minutes) || ''}" data-testid="roadmap-run-timer" data-timer-state="${tone}" data-tone="${tone}" aria-label="${esc(timeAgainst(clock.ms, e))}">${clockText(clock.ms)}</span>`;
  }
  /**
   * Every second (backlog.js): the timers of the runs at work read the clock again, without a redraw;
   * the time line around each (#282: its verdict and its bar) follows.
   */
  function tick(root) {
    for (const el of root?.querySelectorAll('[data-rm-timer]') || []) {
      const since = Number(el.dataset.rmTimer);
      if (!since) continue; // paused at a gate, or frozen at the run's end
      const ms = Math.max(0, Date.now() - since);
      const minutes = Number(el.dataset.estimate);
      const tone = timerTone(ms, minutes);
      el.textContent = clockText(ms);
      const meter = el.closest?.('.rm-meter');
      const live = meter ? liveTime(ms, minutes) : null;
      if (live?.ratio != null) {
        tickBar(el.closest('[data-item]'), live.ratio);
        const bar = meter.querySelector('.rm-meter-bar');
        const inner = barInner(live.ratio);
        if (bar && bar.dataset.drawn !== inner) { bar.innerHTML = inner; bar.dataset.drawn = inner; }
        const verdict = meter.querySelector('.rm-meter-verdict');
        if (verdict && verdict.textContent.trim() !== `${live.sign ? `${live.sign} ` : ''}${live.text}`) {
          verdict.className = `rm-meter-verdict rm-verdict rm-verdict-${live.level}`;
          verdict.innerHTML = verdictInner(live.sign, live.text);
        }
      }
      if (el.dataset.tone === tone) continue;
      el.classList.replace(`rm-timer-${el.dataset.tone}`, `rm-timer-${tone}`);
      el.dataset.tone = tone;
      el.dataset.timerState = tone;
      if (meter && live) meter.dataset.verdict = live.verdict;
    }
  }
  // the row's time bar and the overrun beside the bars follow the timer (the Progress cell, progressCellHtml)
  function tickBar(row, ratio) {
    const bar = row?.querySelector?.('[data-rm-timebar]');
    if (!bar) return;
    const [fill, inner, over] = [barFill(ratio), bar.querySelector('i'), row.querySelector('[data-rm-over]')];
    if (inner && bar.dataset.fill !== fill) {
      Object.assign(bar.dataset, { fill, level: barLevel(ratio) });
      inner.style.height = fill;
    }
    const text = over ? overText(Math.max(Number(over.dataset.rmOver) || 0, ratio)) : '';
    if (over && over.textContent !== text) over.textContent = text;
  }

  // ---- the Progress cell of a row (2026-11-27): a ring and two bars ----------------------------------------
  // The ring: the run's estimated percent, coloured by its state (blue running, amber waiting for the owner, red failed, grey
  // stopped; done: a full green ring with a check; not started: empty, "0%"). The bars: cost then time, each filled to what is
  // spent of the item's estimate (no estimate, or nothing spent: an empty bar), green up to BAR_WARN_AT of it, amber up to
  // BAR_OVER_AT, red past it with the bar full and the overrun beside the bars ("+92%"). Both limits are the designer's
  // proposal, not confirmed by the owner. The exact figures: the cell's title and name, and the open row's meters.
  const BAR_WARN_AT = 0.8;
  const BAR_OVER_AT = 1;
  const percentOf = (v) => (!v ? 0 : v.est.state === 'done' ? 100 : v.est.percent);
  const barLevel = (ratio) => (ratio == null ? 'none' : ratio > BAR_OVER_AT ? 'over' : ratio > BAR_WARN_AT ? 'warn' : 'ok');
  const barFill = (ratio) => (ratio > 0 ? `max(3px, ${Math.min(100, ratio * 100).toFixed(1)}%)` : '0');
  const overText = (ratio) => (ratio > BAR_OVER_AT ? `+${Math.round((ratio - 1) * 100)}%` : '');
  const barHtml = (kind, ratio, icon) => `<span class="rm-gauge" data-bar="${kind}" data-level="${barLevel(ratio)}" data-fill="${barFill(ratio)}"${kind === 'time' ? ' data-rm-timebar' : ''}><span class="rm-gauge-track"><i style="height:${barFill(ratio)}"></i></span>${icon}</span>`;
  // what an item spent of its estimate: the bars' ratios (null: no estimate, or nothing spent yet) and each figure in words
  function spentOf(x, v) {
    const [e, sim] = [x.estimate || {}, RoadmapModel.isSimulated(x)]; // #31: a simulated run spends nothing
    const usd = sim ? null : x.actualUsd ?? null;
    const live = !!v?.clock && (x.status === 'running' || !!x.waiting || x.actualMinutes == null);
    const minutes = live ? v.clock.ms / 60000 : x.actualMinutes ?? null;
    const words = (label, spent, est) => (spent || est ? `${t(label)} ${spent ? `${spent}${est ? ` ${t('backlog_roadmap.meter_of', { value: est })}` : ''}` : `≈ ${est}`}` : '');
    return {
      cost: usd != null && e.usd > 0 ? usd / e.usd : null,
      time: minutes != null && e.minutes > 0 ? minutes / e.minutes : null,
      words: [
        words('backlog_roadmap.meter_cost', usd != null ? money(usd, x.actualApprox) : '', e.usd > 0 && !sim ? money(e.usd) : ''),
        words('backlog_roadmap.meter_time', minutes != null ? mins(Math.floor(minutes)) : '', e.minutes > 0 ? mins(e.minutes) : ''),
      ].filter(Boolean),
    };
  }
  function progressCellHtml(x, v) {
    const [state, pct, s] = [v ? v.est.state : 'none', percentOf(v), spentOf(x, v)];
    const tip = [`${t('backlog_roadmap.meter_progress')} ${pct}%`, ...s.words].join(' · ');
    const ring = state === 'done'
      ? '<circle class="rm-ring-bar" cx="19" cy="19" r="16"/><path class="rm-ring-check" d="m13 19.5 4 4 8-9"/>' // i18n-ignore
      : `<circle class="rm-ring-track" cx="19" cy="19" r="16"/>${pct ? `<circle class="rm-ring-bar" cx="19" cy="19" r="16" pathLength="100" stroke-dasharray="${pct} 100" transform="rotate(-90 19 19)"/>` : ''}`;
    return `<div class="rm-cell-progress" role="img" data-testid="roadmap-status" aria-label="${esc(tip)}" title="${esc(tip)}">
            <span class="rm-ring st-${state}" data-testid="roadmap-ring" data-percent="${pct}"><svg viewBox="0 0 38 38" aria-hidden="true">${ring}</svg>${state === 'done' ? '' : `<span class="rm-ring-pct">${pct}%</span>`}</span>
            <span class="rm-gauges">${barHtml('cost', s.cost, '<span class="rm-gauge-ico" aria-hidden="true">$</span>')}${barHtml('time', s.time, CLOCK)}</span>
            <span class="rm-over" data-rm-over="${s.cost ?? ''}">${overText(Math.max(s.cost ?? 0, s.time ?? 0))}</span>
          </div>`;
  }

  window.RoadmapMeters = {
    costMeter,
    meterHtml,
    mins,
    money,
    percentOf,
    progressCellHtml,
    stageCostHtml,
    tick,
    timeMeter,
  };
})();
