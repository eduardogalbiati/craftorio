// The run's 3D view (bundled by scripts/build-3d.js): the HUD over the scene, plain React DOM drawn
// from the model (view.js), ported from poc/run-3d.html with its look (classes `r3d-*`, run3d.css):
// - TopBar: the run, a search over steps / agents / events, its state (live, finished, interrupted,
//   or a replay and its speed) with the clock, the theme's toggle (dark / light) and Close;
// - Kpis: step visits, cost (with the effective $/M), tokens (total, output and cache read share, every
//   kind in the tooltip), elapsed time last;
// - Detail: the selected station, the supervisor or the work item; a station waiting for the owner
//   shows the question and "Open the gate" (the view never answers a gate: the overlay closes and
//   the gate opens where the app answers it);
// - List: tabs Steps / Agents / Events, a row selects what it names;
// - Pipeline: the workflow's groups, the timeline strip of the step visits and the replay's controls
//   (Replay: play / pause, previous / next step, the speed, clicking or dragging the strip seeks, the
//   time shown and the total, "Live" back to a running run), the work item;
// - Tags: the floating tags over the scene (scene.jsx's TagProjector places them).
// Everything is drawn from the model the player shows (view.model): the run as it is now, or the
// replayed moment. A live run has no known end: a running step's bar is indeterminate and the strip
// spans the run so far; a replay knows both (the bar fills, the strip shows what comes next, dimmed).
// A state's colour is the theme's (statusColor) and always comes with its label. Its text comes from
// the interface language's catalog (t(), the `run3d.*` keys, #330).
import { useMemo, useRef, useState } from 'react';
import {
  agentDef, clockOf, issueText, itemName, nowMs, providerLabel, robotStateOf, setTheme, STATUS, stationColor, statusColor, tagEls,
  tokOf, usd, useTick, view, wallMs,
} from './view.js';

const ICON = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z', close: 'M6 6l12 12M18 6L6 18',
  follow: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  check: 'M5 12l5 5 9-10', steps: 'M5 6h14M5 12h14M5 18h9', coin: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 7v10M14.5 9.5H11a1.5 1.5 0 0 0 0 3h2a1.5 1.5 0 0 1 0 3H9.5',
  tokens: 'M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2', person: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0',
  box: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8', bot: 'M6 9h12v10H6zM9 13v2M15 13v2M12 9V5M12 5h.01',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.2A8 8 0 0 1 9.8 4 8 8 0 1 0 20 14.2z',
  play: 'M8 5l11 7-11 7z', pause: 'M8 5v14M16 5v14', prev: 'M6 5v14M19 5l-10 7 10 7z', next: 'M18 5v14M5 5l10 7-10 7z', end: 'M5 5l8 7-8 7zM13 5l8 7-8 7z',
};
export const Icon = ({ name, size = 17 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[name]} /></svg>
);
/** A catalog text as a child: <T k="run3d.cost" />, its params as props. */
const T = ({ k, ...params }) => t(k, params);

// A robot of robots.js as it is (Robots.svg), in the agent's state: the look saved in Agents as saved,
// else the provider's robot painted in the role's colour (agentDef's variant and paint, #297).
function Avatar({ agent, state, size = 30, bubble = false }) {
  const def = agent === 'supervisor' ? { variant: 'supervisor' } : agentDef(agent);
  const svg = useMemo(() => window.Robots.svg(def.variant, state, { ...(def.paint ? { color: def.paint } : {}), bubble, plaque: '' }), [def.variant, def.paint, state, bubble]);
  return <div className="r3d-avatar" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
const Badge = ({ icon, color, size = 30 }) => (
  <span className="r3d-badge" style={{ width: size, height: size, '--c': color }}><Icon name={icon} size={Math.round(size * 0.55)} /></span>
);
function StationIcon({ st, size = 30, bubble = false }) {
  const m = view.model;
  if (st.kind === 'agent') {
    const lead = m.leadOf(st);
    return <Avatar agent={lead} state={robotStateOf(`${st.id}:${lead}`)} size={size} bubble={bubble} />;
  }
  return <Badge icon={st.kind === 'gate' ? 'person' : 'gear'} color={st.kind === 'gate' ? view.theme.gate : view.theme.machineTone} size={size} />;
}
const Pill = ({ status, text }) => (
  <span className="r3d-pill" style={{ '--c': statusColor(status) }}>
    <i className={'r3d-dot' + (status === 'running' || status === 'waiting' ? ' live' : '')} style={{ '--c': statusColor(status) }} />
    {text || STATUS[status].label}
  </span>
);
// a step's bar: full once its visit ended, indeterminate while it runs (a live visit has no known
// end); a replay knows the end: `progress` (0..1) fills it
function Bar({ status, color, progress = null }) {
  const running = status === 'running' || status === 'waiting', open = running && progress == null;
  return <span className={'r3d-bar' + (open ? ' open' : '')} style={{ '--c': color }}><i style={{ width: status === 'pending' || status === 'not_run' ? 0 : running && !open ? `${Math.round(progress * 100)}%` : '100%' }} /></span>;
}

const runState = (m) => (m.live ? 'live' : m.finished ? (m.run.final === 'interrupted' ? 'interrupted' : 'completed') : 'loading');
const wallOf = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function TopBar({ query, setQuery, onClose }) {
  useTick();
  const p = view.player, m = view.model, run = m.run, waiting = p.atHead && m.pendingGates().length;
  // a replay says so: what is on screen is a past moment, whatever the run does now
  const state = p.atHead ? runState(m) : 'replay';
  const title = window.runTitle ? window.runTitle({ id: run.id, workflow: run.workflow, issues: run.issues, task: run.task }) : run.workflow;
  const text = state === 'replay' ? (p.playing ? t('run3d.replay_speed', { speed: p.speed }) : t('run3d.replay_paused'))
    : state === 'live' ? (waiting ? t('run3d.waiting_for_you') : t('run3d.live')) : state === 'completed' ? t('run3d.finished_final', { final: run.final }) : state === 'interrupted' ? t('run3d.interrupted') : t('run3d.loading');
  const next = window.Run3DTheme.other(view.theme.name);
  const switchTheme = t('run3d.switch_theme', { theme: t(`run3d.theme_${next}`) });
  return (
    <header className="r3d-top r3d-card">
      <div className="r3d-brand"><i><Icon name="bot" /></i><span><T k="run3d.run_in_3d" /></span></div>
      <div className="r3d-run" title={`${run.workflow} · ${run.id}`}>
        <b>
          {title}
        </b>
        <small>
          {run.workflow} · {issueText(run)}
        </small>
      </div>
      <label className="r3d-search"><Icon name="search" size={15} />
        <input placeholder={t('run3d.search_placeholder')} aria-label={t('run3d.search_label')} value={query} onChange={(e) =>
          setQuery(e.target.value)} /></label>
      <div className="r3d-grow" />
      <div className={`r3d-chip r3d-state ${state}${waiting && state === 'live' ? ' waiting' : ''}${state === 'replay' && !p.playing ? ' paused' : ''}`} data-testid="run3d-state" data-state={state}>
        <i className={'r3d-dot' + (state === 'live' || (state === 'replay' && p.playing) ? ' live' : '')} style={{ '--c': 'currentColor' }} />
        {text} · {wallOf(run.startedAt + m.elapsed(nowMs()))}
      </div>
      <button type="button" className="r3d-close r3d-theme" title={switchTheme} aria-label={switchTheme} data-testid="run3d-theme" data-theme={view.theme.name}
        onClick={() => setTheme(next)}><Icon name={next === 'light' ? 'sun' : 'moon'} /></button>
      <button type="button" className="r3d-close" title={t('run3d.close_title')} aria-label={t('run3d.close_label')} data-testid="run3d-close" onClick={onClose}><Icon name="close" /></button>
    </header>
  );
}

export function Kpis() {
  useTick();
  const m = view.model, done = m.visits.filter((v) => v.t1 != null).length;
  // #833: the run's tokens by kind (what Analytics › Run sums) and the effective $/M over them
  const tok = m.tokens(), perM = m.usdPerMTokens();
  const tokensTitle = t('run3d.tokens_title', { input: tokOf(tok.input), output: tokOf(tok.output), cache_read: tokOf(tok.cache_read), cache_write: tokOf(tok.cache_write) });
  return (
    <div className="r3d-kpis">
      <div className="r3d-kpi r3d-card" data-testid="run3d-card-visits"><i><Icon name="steps" /></i><div><label><T k="run3d.step_visits" /></label>
        <b>
          {done} <small>
            {`/ ${m.visits.length}`}
          </small>
        </b>
        <em>
          {t('run3d.agent_turns', { count: m.turns })}
        </em>
      </div></div>
      <div className="r3d-kpi r3d-card" data-testid="run3d-card-cost"><i><Icon name="coin" /></i><div><label><T k="run3d.cost" /></label>
        <b>
          {m.costUnknown() ? t('run_list.cost_unknown') : `${m.costApprox() ? '≈ ' : ''}${usd(m.cost())}`}
        </b>
        <em data-testid="run3d-cost-per-m">
          {perM == null ? '—' : t('run3d.cost_per_m', { cost: usd(perM) })}
        </em>
      </div></div>
      <div className="r3d-kpi r3d-card" data-testid="run3d-card-tokens" title={tokensTitle}><i><Icon name="tokens" /></i><div><label><T k="run3d.tokens" /></label>
        <b data-testid="run3d-tokens-total">
          {tokOf(tok.total)}
        </b>
        <em data-testid="run3d-tokens-split">
          {t('run3d.tokens_split', { output: tokOf(tok.output), share: Math.round(tok.cacheShare * 100) })}
        </em>
      </div></div>
      <div className="r3d-kpi r3d-card" data-testid="run3d-card-elapsed"><i><Icon name="clock" /></i><div><label><T k="run3d.elapsed" /></label>
        <b>
          {clockOf(m.elapsed(nowMs()))}
        </b>
        <em>
          {t('run3d.supervisor_calls', { count: m.sup.calls })}
        </em>
      </div></div>
    </div>
  );
}

// the gate's picture, drawn once (each Robots.gate() call has new ids: a new one every tick would repaint)
let gateSvg = '';
const GATE_SVG = () => (gateSvg ||= window.Robots.gate({ reviewer: 'human' }));

/** A note box: its bold heading, then its text (an expression on its own line, see the check of #330). */
const Note = ({ cls = '', head, children }) => (
  <div className={'r3d-note' + (cls ? ` ${cls}` : '')}>
    <b>
      {head}
    </b>
    {children}
  </div>
);

export function Detail({ shown, onOpenGate, canAnswer }) {
  useTick();
  const p = view.player, m = view.model, run = m.run, layout = m.layout(), now = nowMs();
  if (shown === 'supervisor') {
    const r = m.robots.supervisor, target = m.sup.target;
    return (
      <aside className="r3d-detail r3d-card" aria-label={t('run3d.supervisor')}>
        <div className="r3d-d-head"><Avatar agent="supervisor" state={robotStateOf('supervisor')} size={92} bubble />
          <div><div className="r3d-kind"><T k="run3d.supervisor" /></div><h3><T k="run3d.supervisor" /></h3><p><T k="run3d.supervisor_help" /></p></div></div>
        <div className="r3d-d-status"><Pill status={target || r?.busy ? 'running' : 'pending'} text={target ? t('run3d.working_on', { target }) : r?.busy ? t('run3d.working') : t('run3d.standing_by')} /></div>
        <dl className="r3d-rows"><dt><T k="run3d.model" /></dt>
          <dd>
            {m.supervisorModel ? window.Robots.plaqueFor(m.supervisorModel) : '—'}
          </dd>
          <dt><T k="run3d.calls_in_this_run" /></dt>
          <dd>
            {m.sup.calls}
          </dd>
          <dt><T k="run3d.cost" /></dt>
          <dd>
            {usd(m.agentCost('supervisor'))}
          </dd>
        </dl>
        {r?.busy && r.tool && <Note cls="live" head={t('run3d.now')}>{r.tool}</Note>}
        {m.sup.text && <Note head={target ? t('run3d.why') : t('run3d.last_decision')}>{m.sup.text}</Note>}
      </aside>
    );
  }
  const st = layout.byId[shown];
  if (!st) {
    const at = m.finished ? (m.merged ? t('run3d.merged_into', { base: m.merged.base }) : t('run3d.end_of_the_run')) : m.activeId ? t('run3d.at_step', { step: m.activeId }) : t('run3d.issue_inbox');
    const pill = m.finished ? (m.run.final === 'success' ? 'done' : 'failed') : 'running';
    return (
      <aside className="r3d-detail r3d-card" aria-label={t('run3d.work_item')}>
        <div className="r3d-d-head"><Badge icon="box" color={view.theme.accent} size={60} />
          <div><div className="r3d-kind"><T k="run3d.work_item" /></div>
            <h3>
              {itemName(run)}
            </h3>
            <p>
              {run.issues[0]?.title || run.task}
            </p>
          </div></div>
        <div className="r3d-d-status"><Pill status={pill} text={m.finished ? (m.merged ? t('run3d.merged_into_cap', { base: m.merged.base }) : t('run3d.finished_final', { final: run.final })) : t('run3d.in_the_run')} /></div>
        <dl className="r3d-rows"><dt><T k="run3d.location" /></dt>
          <dd>
            {at}
          </dd>
          <dt><T k="run3d.branch" /></dt>
          <dd className="r3d-mono">
            {run.branch || '—'}
          </dd>
          <dt><T k="run3d.workflow" /></dt>
          <dd>
            {run.workflow}
          </dd>
          <dt><T k="run3d.mode" /></dt>
          <dd>
            {run.mode || '—'}{run.resumedFrom ? t('run3d.resumed_at_suffix', { step: run.resumedFrom }) : ''}
          </dd>
          <dt><T k="run3d.started" /></dt>
          <dd>
            {run.startedAt ? new Date(run.startedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
          </dd>
        </dl>
        {run.issues.length > 1 && <Note head={t('run3d.issues')}>{run.issues.map((i) => <div key={i.number} children={`#${i.number} ${i.title}`} />)}</Note>}
      </aside>
    );
  }
  const step = m.state[st.id], col = statusColor(step.status), total = m.visitsOf(st.id);
  const lead = st.kind === 'agent' ? m.leadOf(st) : null, robot = lead && m.robots[`${st.id}:${lead}`];
  const kind = st.kind === 'gate' ? t('run3d.human_approval') : st.kind === 'machine' ? t('run3d.engine_step', { type: st.type.replace(/_/g, ' ') }) : t('run3d.step_of', { provider: providerLabel(agentDef(lead).provider) || t('run3d.agent') });
  const pillText = m.sup.target === st.id ? t('run3d.supervisor_on_it') : step.status === 'running' && robot?.busy ? t('run3d.running_act', { act: robot.act }) : undefined;
  const gate = m.pendingGates().find((g) => g.step === st.id);
  // a gate seen in a replay may have been answered since: only one still open can be opened
  const answered = gate && p.head.gates[gate.id]?.resolved;
  const time = m.stepTime(st.id, now);
  const visit = step.visits ? t('run3d.visit_n', { n: step.visits }) : m.finished ? t('run3d.not_used_in_this_run') : t('run3d.not_reached_yet');
  const tookLabel = step.status === 'running' ? t('run3d.running_for') : step.status === 'waiting' ? t('run3d.waiting_for') : t('run3d.last_visit_took');
  return (
    <aside className="r3d-detail r3d-card" aria-label={t('run3d.step_label', { label: st.label })} data-testid="run3d-detail" data-step={st.id} data-status={step.status}>
      <div className="r3d-d-head">
        {st.kind === 'gate' ? <div className="r3d-avatar" style={{ width: 92, height: 92 }} dangerouslySetInnerHTML={{ __html: GATE_SVG() }} />
          : st.kind === 'machine' ? <Badge icon="gear" color={view.theme.machineTone} size={60} /> : <StationIcon st={st} size={92} bubble />}
        <div>
          <div className="r3d-kind">
            {kind}
          </div>
          <h3>
            {st.label}
          </h3>
          <p className="r3d-mono">
            {st.id}
          </p>
        </div></div>
      <div className="r3d-d-status"><Pill status={step.status} text={pillText} />
        <span className="r3d-pct">
          {visit}{total > 1 ? t('run3d.visits_suffix', { count: total }) : ''}
        </span></div>
      <Bar status={step.status} color={col} progress={p.progress(st.id)} />
      {st.kind === 'agent' && (
        <div className="r3d-crew">
          {st.agents.map((a) => {
          const key = `${st.id}:${a}`, r = m.robots[key], def = agentDef(a), state = robotStateOf(key);
          return (
            <div key={a} className="r3d-mate"><Avatar agent={a} state={state} size={34} />
              <span className="r3d-txt"><b><span className="r3d-role" style={{ '--c': def.color }}>
                {def.label}
              </span></b><small>
                {def.model ? window.Robots.plaqueFor(def.model) : t('run3d.did_not_run')}{r?.ctx ? t('run3d.context_suffix', { tokens: tokOf(r.ctx) }) : ''}
              </small></span>
              <span className="r3d-state-word">
                {state}
              </span></div>
          );
        })}</div>
      )}
      <dl className="r3d-rows">
        <dt><T k="run3d.cost" /></dt>
        <dd>
          {st.kind === 'agent' ? usd(m.stepCost(st.id)) : t('run3d.no_model_call')}
        </dd>
        <dt>
          {tookLabel}
        </dt>
        <dd>
          {time == null ? '—' : clockOf(time)}
        </dd>
      </dl>
      {step.ask && <Note cls="warn" head={t('run3d.asks_you')}>{step.ask}</Note>}
      {robot?.busy && robot.tool && <Note cls="live" head={t('run3d.now')}><span className="r3d-mono" children={robot.tool} /></Note>}
      {robot?.say && <Note head={robot.busy ? t('run3d.saying') : t('run3d.last_message')}>{robot.say}</Note>}
      {step.note && step.status !== 'running' && !robot?.busy && <Note head={t('run3d.result')}>{step.note}</Note>}
      {answered && <Note head={t('run3d.since_then')}>{answered === 'closed' ? t('run3d.gate_closed') : t('run3d.gate_answered', { answer: answered })}</Note>}
      {gate && !answered && (
        <button type="button" className="r3d-primary" data-testid="run3d-open-gate" disabled={!canAnswer}
          title={canAnswer ? t('run3d.open_gate_title') : t('run3d.open_gate_elsewhere')}
          onClick={() =>
            onOpenGate(gate)}><T k="run3d.open_the_gate" /></button>
      )}
    </aside>
  );
}

const TABS = [['steps', 'run3d.steps'], ['agents', 'run3d.agents'], ['events', 'run3d.events']];

export function List({ shown, onSelect, query }) {
  useTick();
  const [tab, setTab] = useState('steps');
  const p = view.player, m = view.model, layout = m.layout(), q = query.trim().toLowerCase(), now = nowMs();
  const has = (...xs) => !q || xs.some((x) => String(x).toLowerCase().includes(q));
  const steps = layout.stations.filter((st) => has(st.id, st.label, st.type, ...st.agents));
  const agents = [];
  for (const st of layout.stations) for (const a of st.agents) if (!agents.some((x) => x.agent === a) && has(a, agentDef(a).label, agentDef(a).model)) agents.push({ agent: a, st });
  const events = m.feed.filter((e) => has(e.text));
  const counts = { steps: steps.length, agents: agents.length, events: events.length };
  let body;
  if (tab === 'steps') {
    body = steps.map((st) => {
      const step = m.state[st.id], time = m.stepTime(st.id, now);
      const sub = st.kind === 'gate' ? t('run3d.human_approval_lower') : st.kind === 'machine' ? t('run3d.engine_type', { type: st.type.replace(/_/g, ' ') }) : st.agents.map((a) => agentDef(a).label).join(' + ');
      const na = m.doesntApply(st.id); // #735: shown dimmed, "Doesn't apply: no UI in this project"
      const pill = na ? t(na) : step.status === 'changes' ? t('run3d.changes') : step.status === 'waiting' ? t('run3d.waiting') : m.finished && !step.visits ? t('run3d.not_used') : undefined;
      return (
        <button type="button" key={st.id} className={'r3d-row' + (shown === st.id ? ' sel' : '') + (step.visits ? '' : ' unused') + (na ? ' doesnt-apply' : '')}
          data-testid={na ? 'run3d-step-doesnt-apply' : undefined} onClick={() =>
          onSelect(st.id)}>
          <StationIcon st={st} />
          <span className="r3d-txt">
            <b>
              {st.label}
            </b>
            <small>
              {sub}{step.visits > 1 ? t('run3d.visit_suffix', { n: step.visits }) : ''}
            </small>
          </span>
          <Pill status={step.status} text={pill} />
          <span className="r3d-mini"><Bar status={step.status} color={statusColor(step.status)} progress={p.progress(st.id)} />
            <small>
              {time == null ? '—' : clockOf(time)}
            </small>
          </span>
        </button>
      );
    });
  } else if (tab === 'agents') {
    body = agents.map(({ agent, st: first }) => {
      const st = layout.stations.find((x) => x.agents.includes(agent) && m.robots[`${x.id}:${agent}`]?.busy) || first;
      const def = agentDef(agent), state = robotStateOf(`${st.id}:${agent}`);
      const na = !def.model && m.doesntApply(agent); // #735: the UI Reviewer of a project without UI
      return (
        <button type="button" key={agent} className={'r3d-row' + (shown === st.id ? ' sel' : '') + (na ? ' doesnt-apply' : '')} onClick={() =>
          onSelect(st.id)}>
          <Avatar agent={agent} state={state} />
          <span className="r3d-txt">
            <b>
              {def.label}
            </b>
            <small>
              {def.model ? `${providerLabel(def.provider) || def.provider} · ${window.Robots.plaqueFor(def.model)}` : na ? t(na) : t('run3d.did_not_run')}
            </small>
          </span>
          <span className="r3d-role" style={{ '--c': def.color }}>
            {state}
          </span>
          <span className="r3d-mini">
            <small>
              {usd(m.agentCost(agent))}
            </small>
          </span>
        </button>
      );
    });
  } else {
    const start = m.run.startedAt || 0;
    body = events.map((e) => (
      <button type="button" key={e.n} className="r3d-ev" onClick={() =>
        e.target && onSelect(e.target)}>
        <time>
          {clockOf(e.ts - start)}
        </time>
        <i className="r3d-dot" style={{ '--c': statusColor(e.kind) }} />
        <span>
          {e.text}
        </span>
      </button>
    ));
  }
  return (
    <section className="r3d-list r3d-card" aria-label={t('run3d.list_label')}>
      <div className="r3d-tabs" role="tablist">
        {TABS.map(([id, key]) => (
          <button type="button" key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() =>
            setTab(id)}>
            {t(key)}
            <small>
              {counts[id]}
            </small>
          </button>
        ))}
      </div>
      <div className="r3d-scroll">
        {body.length ? body : <div className="r3d-empty" children={q ? t('run3d.nothing_matches', { query }) : t('run3d.nothing_yet')} />}
      </div>
    </section>
  );
}

// The run's timeline and the replay's controls. The strip: one block per visit of a step, in the
// step's colour; clicking or dragging it shows that moment (a live run goes on behind: "Live" comes
// back to it). A live run's strip is in real time and grows; a replay's has the long waits for the
// owner cut short, marked where they were (the player's strip()).
function Replay() {
  const p = view.player, layout = p.head.layout(), wall = wallMs(), ref = useRef();
  const strip = p.strip(wall), clock = p.clock(wall), behind = p.behind(wall), SPEEDS = window.Run3DReplay.SPEEDS;
  const pct = (f) => `${f * 100}%`;
  const seek = (e) => { const r = ref.current.getBoundingClientRect(); p.seekStrip((e.clientX - r.left) / Math.max(1, r.width), wall); };
  // the drag goes on outside the strip (a pointer that cannot be captured still seeks where it pressed)
  const grab = (e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not a live pointer */ } };
  const cutNote = t('run3d.cut_note', { time: clockOf(clock.cut) });
  const playTitle = p.live ? t('run3d.pause_live_title') : p.moving ? t('run3d.pause_title') : p.atHead ? t('run3d.replay_start_title') : t('run3d.play_title');
  const playLabel = p.moving ? t('run3d.pause') : p.atHead ? t('run3d.replay_start') : t('run3d.play');
  const visitTitle = (st, v) => `${st.label}${v.visit > 1 ? t('run3d.visit_paren', { n: v.visit }) : ''} · ${clockOf(v.ms)}`;
  return (
    <div className="r3d-strip-wrap">
      <div className={'r3d-strip' + (strip.live ? '' : ' replay')} ref={ref} role="slider" tabIndex={0} data-testid="run3d-strip"
        aria-label={t('run3d.timeline')} aria-valuemin={0} aria-valuemax={Math.round(clock.total / 1000)} aria-valuenow={Math.round(clock.at / 1000)}
        aria-valuetext={t('run3d.time_of', { at: clockOf(clock.at), total: clockOf(clock.total) })} title={t('run3d.strip_title')}
        onPointerDown={(e) => { if (e.button !== 0) return; grab(e); seek(e); }}
        onPointerMove={(e) => { if (e.buttons & 1) seek(e); }}>
        {strip.visits.map((v, i) => {
          const st = layout.byId[v.step];
          if (!st) return null;
          return <i key={i} className={(v.open ? 'open' : '') + (v.todo ? ' todo' : '')} title={visitTitle(st, v)}
            style={{ left: pct(v.left), width: `max(2px, calc(${pct(v.width)} - 1px))`, background: stationColor(st) }} />;
        })}
        {strip.cuts.map((c, i) => <u key={i} style={{ left: pct(c.at) }} title={t('run3d.cut_title', { time: clockOf(c.ms) })} />)}
        {strip.at != null && <b style={{ left: pct(strip.at) }} />}
      </div>
      <div className="r3d-replay" role="group" aria-label={t('run3d.replay')}>
        <button type="button" className="r3d-ctl" data-testid="run3d-play" data-playing={p.moving}
          title={playTitle} aria-label={playLabel} onClick={() => p.toggle()}><Icon name={p.moving ? 'pause' : 'play'} size={15} /></button>
        <button type="button" className="r3d-ctl" data-r3d-step="-1" title={t('run3d.prev_title')} aria-label={t('run3d.prev')}
          onClick={() => p.step(-1)}><Icon name="prev" size={15} /></button>
        <button type="button" className="r3d-ctl" data-r3d-step="1" title={t('run3d.next_title')} aria-label={t('run3d.next')} disabled={p.atHead}
          onClick={() => p.step(1)}><Icon name="next" size={15} /></button>
        <span className="r3d-speeds" role="group" aria-label={t('run3d.replay_speed_label')}>
          {SPEEDS.map((v) => <button type="button" key={v} className={'r3d-ctl speed' + (p.speed === v ? ' on' : '')} aria-pressed={p.speed === v}
            title={t('run3d.speed_title', { count: v })} onClick={() =>
              p.setSpeed(v)}>{v}×</button>)}
        </span>
        <span className="r3d-time" data-testid="run3d-time">
          <b>
            {clockOf(clock.at)}
          </b>
          {strip.live ? t('run3d.so_far') : ` / ${clockOf(clock.total)}`}
          {!strip.live && clock.cut > 0 && <em title={cutNote}><T k="run3d.waits_cut" /></em>}
        </span>
        {!p.atHead && (p.head.live
          ? <button type="button" className="r3d-live" data-testid="run3d-live" title={t('run3d.back_to_live', { count: behind.events })}
            onClick={() => p.toHead()}>
            <i className="r3d-dot live" style={{ '--c': 'currentColor' }} />
            {t('run3d.live')}
            <small>
              {t('run3d.behind', { time: clockOf(behind.ms) })}
            </small>
          </button>
          : <button type="button" className="r3d-live end" data-testid="run3d-live" title={t('run3d.back_to_end')}
            onClick={() => p.toHead()}><Icon name="end" size={13} /><T k="run3d.end" /></button>)}
      </div>
    </div>
  );
}

export function Pipeline({ shown, onSelect }) {
  useTick();
  const m = view.model, run = m.run, layout = m.layout(), now = nowMs();
  // the workflow's groups, plus one for the steps before them (the tests written first)
  const groups = useMemo(() => {
    const grouped = new Set(run.groups.flatMap((g) => g.steps || []));
    const loose = layout.stations.filter((st) => !grouped.has(st.id)).map((st) => st.id);
    return [...(loose.length ? [{ name: t('run3d.prepare'), steps: loose }] : []), ...run.groups]
      .map((g) => ({ name: window.RunProgress.groupName(g.name, t), stations: (g.steps || []).map((id) => layout.byId[id]).filter(Boolean) })).filter((g) => g.stations.length);
  }, [run, layout]);
  const liveAt = groups.findIndex((g) => g.stations.some((st) => st.id === m.activeId));
  const at = m.finished ? (m.merged ? t('run3d.merged_into', { base: m.merged.base }) : t('run3d.finished_lower', { final: run.final })) : m.activeId ? t('run3d.at_step', { step: m.activeId }) : t('run3d.in_the_issue_inbox');
  return (
    <section className="r3d-pipe r3d-card" aria-label={t('run3d.pipeline')}>
      <div className="r3d-pipe-top">
        <div className="r3d-pipe-main">
          <div className="r3d-pipe-title">
            {t('run3d.pipeline')}
            <span>
              {m.feed[0]?.text}
            </span>
          </div>
          <div className="r3d-miles">
            {groups.map((g, gi) => {
            const live = g.stations.find((st) => st.id === m.activeId), touched = g.stations.filter((st) => m.state[st.id].visits);
            const status = live ? m.state[live.id].status : 'pending';
            // a group is done once the run went past it (or ended); visited and gone back to: partly
            const cls = live ? 'active' : touched.length && (m.finished || gi < liveAt) ? 'done' : touched.length ? 'part' : '';
            const ms = touched.reduce((sum, st) => sum + m.visits.filter((v) => v.step === st.id).reduce((s, v) => s + ((v.t1 ?? Math.max(now, m.lastTs)) - v.t0), 0), 0);
            return (
              <button type="button" key={g.name} className={'r3d-mile ' + cls} style={{ '--c': statusColor(status === 'pending' ? 'running' : status) }} onClick={() =>
                onSelect((live || touched[touched.length - 1] || g.stations[0]).id)}>
                <i>
                  {cls === 'done' && <Icon name="check" size={13} />}
                </i>
                <b>
                  {g.name}
                </b>
                <small>
                  {live ? `${live.label} · ${clockOf(ms)}` : touched.length ? clockOf(ms) : t('run3d.queued')}
                </small>
              </button>
            );
          })}</div>
        </div>
        <button type="button" className={'r3d-item' + (shown === 'item' ? ' sel' : '')} onClick={() =>
          onSelect('item')}>
          <i><Icon name="box" size={20} /></i>
          <span>
            <b>
              {itemName(run)}
            </b>
            <small>
              {run.issues[0]?.title || run.task}
            </small>
            <small>
              {at}
            </small>
          </span>
        </button>
      </div>
      <Replay />
    </section>
  );
}

// The floating tags over the scene: one per station, plus the supervisor, the work item and both ends.
const tagRef = (id) => (el) => { if (el) tagEls.set(id, el); else tagEls.delete(id); };
export function Tags({ shown, onSelect }) {
  useTick();
  const m = view.model, run = m.run, layout = m.layout();
  const target = m.sup.target && layout.byId[m.sup.target] ? m.sup.target : null;
  return (
    <div className="r3d-tags">
      <div className="r3d-tag dim" ref={tagRef('start')}><i className="r3d-dot" style={{ '--c': statusColor('pending') }} />
        {run.resumedFrom ? t('run3d.resumed_at', { step: run.resumedFrom }) : issueText(run)}
      </div>
      <div className="r3d-tag dim" ref={tagRef('end')}><i className="r3d-dot" style={{ '--c': statusColor(m.merged ? 'done' : 'pending') }} />
        {m.merged ? t('run3d.merged_into', { base: m.merged.base }) : t('run3d.base_branch')}
      </div>
      {layout.stations.map((st) => {
        const step = m.state[st.id], lead = st.kind === 'agent' && m.leadOf(st), r = lead && m.robots[`${st.id}:${lead}`];
        const live = step.status === 'running' || step.status === 'waiting' || r?.busy;
        const na = !live && m.doesntApply(st.id);
        const text = na ? t(na) : target === st.id ? t('run3d.supervisor_on_it_lower') : step.status === 'waiting' ? t('run3d.waiting_for_you_lower') : r?.busy ? r.act : step.status === 'pending' ? '' : STATUS[step.status].label.toLowerCase();
        return (
          <div key={st.id} ref={tagRef(st.id)} className={'r3d-tag' + (shown === st.id ? ' sel' : '') + (live ? ' live' : step.visits ? '' : ' dim') + (na ? ' doesnt-apply' : '')} onClick={() =>
            onSelect(st.id)}>
            <i className={'r3d-dot' + (live ? ' live' : '')} style={{ '--c': statusColor(r?.busy && step.status !== 'waiting' ? 'running' : step.status) }} />
            {st.label}
            {text && <span children={text} />}
          </div>
        );
      })}
      <div ref={tagRef('supervisor')} className={'r3d-tag' + (shown === 'supervisor' ? ' sel' : '') + (target ? ' live' : ' dim')} onClick={() =>
        onSelect('supervisor')}>
        <i className={'r3d-dot' + (target ? ' live' : '')} style={{ '--c': view.theme.supervisor }} />
        {t('run3d.supervisor_lower')}
        {target && <span><T k="run3d.on_target" target={target} /></span>}
      </div>
      <div ref={tagRef('item')} className={'r3d-tag' + (shown === 'item' ? ' sel' : '')} onClick={() =>
        onSelect('item')}>
        <i className="r3d-dot" style={{ '--c': view.theme.accent }} />
        {itemName(run).replace(/^Task$/, t('run3d.task_lower'))}
      </div>
    </div>
  );
}
