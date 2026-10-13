// The run's 3D view (bundled by scripts/build-3d.js): the HUD over the scene, plain React DOM drawn
// from the model (view.js), ported from poc/run-3d.html with its look (classes `r3d-*`, run3d.css):
// - TopBar: the run, a search over steps / agents / events, its state (live, finished, interrupted,
//   or a replay and its speed) with the clock, the theme's toggle (dark / light) and Close;
// - Kpis: step visits, cost, elapsed time;
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
// A state's colour is the theme's (statusColor) and always comes with its label.
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
    <i className={'r3d-dot' + (status === 'running' || status === 'waiting' ? ' live' : '')} style={{ '--c': statusColor(status) }} />{text || STATUS[status].label}
  </span>
);
// a step's bar: full once its visit ended, indeterminate while it runs (a live visit has no known
// end); a replay knows the end: `progress` (0..1) fills it
function Bar({ status, color, progress = null }) {
  const running = status === 'running' || status === 'waiting', open = running && progress == null;
  return <span className={'r3d-bar' + (open ? ' open' : '')} style={{ '--c': color }}><i style={{ width: status === 'pending' ? 0 : running && !open ? `${Math.round(progress * 100)}%` : '100%' }} /></span>;
}

const runState = (m) => (m.live ? 'live' : m.finished ? (m.run.final === 'interrupted' ? 'interrupted' : 'completed') : 'loading');
const wallOf = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function TopBar({ query, setQuery, onClose }) {
  useTick();
  const p = view.player, m = view.model, run = m.run, waiting = p.atHead && m.pendingGates().length;
  // a replay says so: what is on screen is a past moment, whatever the run does now
  const state = p.atHead ? runState(m) : 'replay';
  const title = window.runTitle ? window.runTitle({ id: run.id, workflow: run.workflow, issues: run.issues, task: run.task }) : run.workflow;
  const text = state === 'replay' ? (p.playing ? `Replay ${p.speed}×` : 'Replay paused')
    : state === 'live' ? (waiting ? 'Waiting for you' : 'Live') : state === 'completed' ? `Finished: ${run.final}` : state === 'interrupted' ? 'Interrupted' : 'Loading';
  const next = window.Run3DTheme.other(view.theme.name);
  return (
    <header className="r3d-top r3d-card">
      <div className="r3d-brand"><i><Icon name="bot" /></i><span>Run in 3D</span></div>
      <div className="r3d-run" title={`${run.workflow} · ${run.id}`}><b>{title}</b><small>{run.workflow} · {issueText(run)}</small></div>
      <label className="r3d-search"><Icon name="search" size={15} />
        <input placeholder="Search steps, agents, events…" aria-label="Search steps, agents and events" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <div className="r3d-grow" />
      <div className={`r3d-chip r3d-state ${state}${waiting && state === 'live' ? ' waiting' : ''}${state === 'replay' && !p.playing ? ' paused' : ''}`} data-testid="run3d-state" data-state={state}>
        <i className={'r3d-dot' + (state === 'live' || (state === 'replay' && p.playing) ? ' live' : '')} style={{ '--c': 'currentColor' }} />
        {text} · {wallOf(run.startedAt + m.elapsed(nowMs()))}
      </div>
      <button type="button" className="r3d-close r3d-theme" title={`Switch to the ${next} theme`} aria-label={`Switch to the ${next} theme`} data-testid="run3d-theme" data-theme={view.theme.name}
        onClick={() => setTheme(next)}><Icon name={next === 'light' ? 'sun' : 'moon'} /></button>
      <button type="button" className="r3d-close" title="Close the 3D view (Esc)" aria-label="Close the 3D view" data-testid="run3d-close" onClick={onClose}><Icon name="close" /></button>
    </header>
  );
}

export function Kpis() {
  useTick();
  const m = view.model, done = m.visits.filter((v) => v.t1 != null).length;
  return (
    <div className="r3d-kpis">
      <div className="r3d-kpi r3d-card"><i><Icon name="steps" /></i><div><label>Step visits</label><b>{done} <small>/ {m.visits.length}</small></b><em>{m.turns} agent turn{m.turns === 1 ? '' : 's'}</em></div></div>
      <div className="r3d-kpi r3d-card"><i><Icon name="coin" /></i><div><label>Cost</label><b>{usd(m.cost())}</b><em>{tokOf(m.tokensOut())} output tokens</em></div></div>
      <div className="r3d-kpi r3d-card"><i><Icon name="clock" /></i><div><label>Elapsed</label><b>{clockOf(m.elapsed(nowMs()))}</b><em>{m.sup.calls} supervisor call{m.sup.calls === 1 ? '' : 's'}</em></div></div>
    </div>
  );
}

// the gate's picture, drawn once (each Robots.gate() call has new ids: a new one every tick would repaint)
let gateSvg = '';
const GATE_SVG = () => (gateSvg ||= window.Robots.gate({ reviewer: 'human' }));

export function Detail({ shown, onOpenGate, canAnswer }) {
  useTick();
  const p = view.player, m = view.model, run = m.run, layout = m.layout(), now = nowMs();
  if (shown === 'supervisor') {
    const r = m.robots.supervisor, target = m.sup.target;
    return (
      <aside className="r3d-detail r3d-card" aria-label="Supervisor">
        <div className="r3d-d-head"><Avatar agent="supervisor" state={robotStateOf('supervisor')} size={92} bubble />
          <div><div className="r3d-kind">Supervisor</div><h3>Supervisor</h3><p>Called only when a step fails or a gate would ask you</p></div></div>
        <div className="r3d-d-status"><Pill status={target || r?.busy ? 'running' : 'pending'} text={target ? `Working on ${target}` : r?.busy ? 'Working' : 'Standing by'} /></div>
        <dl className="r3d-rows"><dt>Model</dt><dd>{m.supervisorModel ? window.Robots.plaqueFor(m.supervisorModel) : '—'}</dd><dt>Calls in this run</dt><dd>{m.sup.calls}</dd>
          <dt>Cost</dt><dd>{usd(m.agentCost('supervisor'))}</dd></dl>
        {r?.busy && r.tool && <div className="r3d-note live"><b>Now</b>{r.tool}</div>}
        {m.sup.text && <div className="r3d-note"><b>{target ? 'Why' : 'Last decision'}</b>{m.sup.text}</div>}
      </aside>
    );
  }
  const st = layout.byId[shown];
  if (!st) {
    const at = m.finished ? (m.merged ? `merged into ${m.merged.base}` : 'end of the run') : m.activeId ? `at ${m.activeId}` : 'issue inbox';
    const pill = m.finished ? (m.run.final === 'success' ? 'done' : 'failed') : 'running';
    return (
      <aside className="r3d-detail r3d-card" aria-label="Work item">
        <div className="r3d-d-head"><Badge icon="box" color={view.theme.accent} size={60} />
          <div><div className="r3d-kind">Work item</div><h3>{itemName(run)}</h3><p>{run.issues[0]?.title || run.task}</p></div></div>
        <div className="r3d-d-status"><Pill status={pill} text={m.finished ? (m.merged ? `Merged into ${m.merged.base}` : `Finished: ${run.final}`) : 'In the run'} /></div>
        <dl className="r3d-rows"><dt>Location</dt><dd>{at}</dd><dt>Branch</dt><dd className="r3d-mono">{run.branch || '—'}</dd><dt>Workflow</dt><dd>{run.workflow}</dd>
          <dt>Mode</dt><dd>{run.mode || '—'}{run.resumedFrom ? ` · resumed at ${run.resumedFrom}` : ''}</dd>
          <dt>Started</dt><dd>{run.startedAt ? new Date(run.startedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</dd></dl>
        {run.issues.length > 1 && <div className="r3d-note"><b>Issues</b>{run.issues.map((i) => <div key={i.number}>#{i.number} {i.title}</div>)}</div>}
      </aside>
    );
  }
  const step = m.state[st.id], col = statusColor(step.status), total = m.visitsOf(st.id);
  const lead = st.kind === 'agent' ? m.leadOf(st) : null, robot = lead && m.robots[`${st.id}:${lead}`];
  const kind = st.kind === 'gate' ? 'Human approval' : st.kind === 'machine' ? `Engine step · ${st.type.replace(/_/g, ' ')}` : `Step · ${providerLabel(agentDef(lead).provider) || 'agent'}`;
  const pillText = m.sup.target === st.id ? 'Supervisor on it' : step.status === 'running' && robot?.busy ? `Running · ${robot.act}` : undefined;
  const gate = m.pendingGates().find((g) => g.step === st.id);
  // a gate seen in a replay may have been answered since: only one still open can be opened
  const answered = gate && p.head.gates[gate.id]?.resolved;
  const time = m.stepTime(st.id, now);
  return (
    <aside className="r3d-detail r3d-card" aria-label={`Step ${st.label}`} data-testid="run3d-detail" data-step={st.id} data-status={step.status}>
      <div className="r3d-d-head">
        {st.kind === 'gate' ? <div className="r3d-avatar" style={{ width: 92, height: 92 }} dangerouslySetInnerHTML={{ __html: GATE_SVG() }} />
          : st.kind === 'machine' ? <Badge icon="gear" color={view.theme.machineTone} size={60} /> : <StationIcon st={st} size={92} bubble />}
        <div><div className="r3d-kind">{kind}</div><h3>{st.label}</h3><p className="r3d-mono">{st.id}</p></div></div>
      <div className="r3d-d-status"><Pill status={step.status} text={pillText} />
        <span className="r3d-pct">{step.visits ? `visit ${step.visits}` : m.finished ? 'not used in this run' : 'not reached yet'}{total > 1 ? ` · ${total} visits` : ''}</span></div>
      <Bar status={step.status} color={col} progress={p.progress(st.id)} />
      {st.kind === 'agent' && (
        <div className="r3d-crew">{st.agents.map((a) => {
          const key = `${st.id}:${a}`, r = m.robots[key], def = agentDef(a), state = robotStateOf(key);
          return (
            <div key={a} className="r3d-mate"><Avatar agent={a} state={state} size={34} />
              <span className="r3d-txt"><b><span className="r3d-role" style={{ '--c': def.color }}>{def.label}</span></b><small>{def.model ? window.Robots.plaqueFor(def.model) : 'did not run'}{r?.ctx ? ` · context ${tokOf(r.ctx)}` : ''}</small></span>
              <span className="r3d-state-word">{state}</span></div>
          );
        })}</div>
      )}
      <dl className="r3d-rows">
        <dt>Cost</dt><dd>{st.kind === 'agent' ? usd(m.stepCost(st.id)) : 'no model call'}</dd>
        <dt>{step.status === 'running' ? 'Running for' : step.status === 'waiting' ? 'Waiting for' : 'Last visit took'}</dt><dd>{time == null ? '—' : clockOf(time)}</dd>
      </dl>
      {step.ask && <div className="r3d-note warn"><b>Asks you</b>{step.ask}</div>}
      {robot?.busy && robot.tool && <div className="r3d-note live"><b>Now</b><span className="r3d-mono">{robot.tool}</span></div>}
      {robot?.say && <div className="r3d-note"><b>{robot.busy ? 'Saying' : 'Last message'}</b>{robot.say}</div>}
      {step.note && step.status !== 'running' && !robot?.busy && <div className="r3d-note"><b>Result</b>{step.note}</div>}
      {answered && <div className="r3d-note"><b>Since then</b>{answered === 'closed' ? 'The run ended before this gate was answered.' : `This gate was answered “${answered}”.`}</div>}
      {gate && !answered && (
        <button type="button" className="r3d-primary" data-testid="run3d-open-gate" disabled={!canAnswer}
          title={canAnswer ? 'Close the 3D view and answer this gate in the run' : 'This window does not follow the run: open it from the runs list to answer'}
          onClick={() => onOpenGate(gate)}>Open the gate</button>
      )}
    </aside>
  );
}

export function List({ shown, onSelect, query }) {
  useTick();
  const [tab, setTab] = useState('steps');
  const p = view.player, m = view.model, layout = m.layout(), q = query.trim().toLowerCase(), now = nowMs();
  const has = (...t) => !q || t.some((x) => String(x).toLowerCase().includes(q));
  const steps = layout.stations.filter((st) => has(st.id, st.label, st.type, ...st.agents));
  const agents = [];
  for (const st of layout.stations) for (const a of st.agents) if (!agents.some((x) => x.agent === a) && has(a, agentDef(a).label, agentDef(a).model)) agents.push({ agent: a, st });
  const events = m.feed.filter((e) => has(e.text));
  let body;
  if (tab === 'steps') {
    body = steps.map((st) => {
      const step = m.state[st.id], time = m.stepTime(st.id, now);
      const sub = st.kind === 'gate' ? 'human approval' : st.kind === 'machine' ? `engine · ${st.type.replace(/_/g, ' ')}` : st.agents.map((a) => agentDef(a).label).join(' + ');
      return (
        <button type="button" key={st.id} className={'r3d-row' + (shown === st.id ? ' sel' : '') + (step.visits ? '' : ' unused')} onClick={() => onSelect(st.id)}>
          <StationIcon st={st} />
          <span className="r3d-txt"><b>{st.label}</b><small>{sub}{step.visits > 1 ? ` · visit ${step.visits}` : ''}</small></span>
          <Pill status={step.status} text={step.status === 'changes' ? 'Changes' : step.status === 'waiting' ? 'Waiting' : m.finished && !step.visits ? 'Not used' : undefined} />
          <span className="r3d-mini"><Bar status={step.status} color={statusColor(step.status)} progress={p.progress(st.id)} /><small>{time == null ? '—' : clockOf(time)}</small></span>
        </button>
      );
    });
  } else if (tab === 'agents') {
    body = agents.map(({ agent, st: first }) => {
      const st = layout.stations.find((x) => x.agents.includes(agent) && m.robots[`${x.id}:${agent}`]?.busy) || first;
      const def = agentDef(agent), state = robotStateOf(`${st.id}:${agent}`);
      return (
        <button type="button" key={agent} className={'r3d-row' + (shown === st.id ? ' sel' : '')} onClick={() => onSelect(st.id)}>
          <Avatar agent={agent} state={state} />
          <span className="r3d-txt"><b>{def.label}</b><small>{def.model ? `${providerLabel(def.provider) || def.provider} · ${window.Robots.plaqueFor(def.model)}` : 'did not run'}</small></span>
          <span className="r3d-role" style={{ '--c': def.color }}>{state}</span>
          <span className="r3d-mini"><small>{usd(m.agentCost(agent))}</small></span>
        </button>
      );
    });
  } else {
    const start = m.run.startedAt || 0;
    body = events.map((e) => (
      <button type="button" key={e.n} className="r3d-ev" onClick={() => e.target && onSelect(e.target)}>
        <time>{clockOf(e.ts - start)}</time><i className="r3d-dot" style={{ '--c': statusColor(e.kind) }} /><span>{e.text}</span>
      </button>
    ));
  }
  const tabBtn = (id, label, n) => (
    <button type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}<small>{n}</small></button>
  );
  return (
    <section className="r3d-list r3d-card" aria-label="Steps, agents and events">
      <div className="r3d-tabs" role="tablist">{tabBtn('steps', 'Steps', steps.length)}{tabBtn('agents', 'Agents', agents.length)}{tabBtn('events', 'Events', events.length)}</div>
      <div className="r3d-scroll">{body.length ? body : <div className="r3d-empty">{q ? `Nothing matches “${query}”.` : 'Nothing yet.'}</div>}</div>
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
  const cutNote = `${clockOf(clock.cut)} of waiting for you is skipped in the replay: a wait over a minute is cut to 45 s`;
  return (
    <div className="r3d-strip-wrap">
      <div className={'r3d-strip' + (strip.live ? '' : ' replay')} ref={ref} role="slider" tabIndex={0} data-testid="run3d-strip"
        aria-label="Run timeline" aria-valuemin={0} aria-valuemax={Math.round(clock.total / 1000)} aria-valuenow={Math.round(clock.at / 1000)}
        aria-valuetext={`${clockOf(clock.at)} of ${clockOf(clock.total)}`} title="Click or drag to show that moment of the run"
        onPointerDown={(e) => { if (e.button !== 0) return; grab(e); seek(e); }}
        onPointerMove={(e) => { if (e.buttons & 1) seek(e); }}>
        {strip.visits.map((v, i) => {
          const st = layout.byId[v.step];
          if (!st) return null;
          return <i key={i} className={(v.open ? 'open' : '') + (v.todo ? ' todo' : '')} title={`${st.label}${v.visit > 1 ? ` (visit ${v.visit})` : ''} · ${clockOf(v.ms)}`}
            style={{ left: pct(v.left), width: `max(2px, calc(${pct(v.width)} - 1px))`, background: stationColor(st) }} />;
        })}
        {strip.cuts.map((c, i) => <u key={i} style={{ left: pct(c.at) }} title={`${clockOf(c.ms)} of waiting for you cut from the replay`} />)}
        {strip.at != null && <b style={{ left: pct(strip.at) }} />}
      </div>
      <div className="r3d-replay" role="group" aria-label="Replay">
        <button type="button" className="r3d-ctl" data-testid="run3d-play" data-playing={p.moving}
          title={p.live ? 'Pause on this moment: the run goes on, Live brings you back (Space)' : p.moving ? 'Pause (Space)' : p.atHead ? 'Replay from the start (Space)' : 'Play (Space)'}
          aria-label={p.moving ? 'Pause' : p.atHead ? 'Replay from the start' : 'Play'} onClick={() => p.toggle()}><Icon name={p.moving ? 'pause' : 'play'} size={15} /></button>
        <button type="button" className="r3d-ctl" data-r3d-step="-1" title="Previous step (Left arrow)" aria-label="Previous step" onClick={() => p.step(-1)}><Icon name="prev" size={15} /></button>
        <button type="button" className="r3d-ctl" data-r3d-step="1" title="Next step (Right arrow)" aria-label="Next step" disabled={p.atHead} onClick={() => p.step(1)}><Icon name="next" size={15} /></button>
        <span className="r3d-speeds" role="group" aria-label="Replay speed">
          {SPEEDS.map((v) => <button type="button" key={v} className={'r3d-ctl speed' + (p.speed === v ? ' on' : '')} aria-pressed={p.speed === v}
            title={`Replay ${v} second${v === 1 ? '' : 's'} of the run per second`} onClick={() => p.setSpeed(v)}>{v}×</button>)}
        </span>
        <span className="r3d-time" data-testid="run3d-time"><b>{clockOf(clock.at)}</b>{strip.live ? ' so far' : ` / ${clockOf(clock.total)}`}
          {!strip.live && clock.cut > 0 && <em title={cutNote}> · long waits cut to 45 s</em>}</span>
        {!p.atHead && (p.head.live
          ? <button type="button" className="r3d-live" data-testid="run3d-live" title={`Back to the live run: ${behind.events} event${behind.events === 1 ? '' : 's'} since this moment`} onClick={() => p.toHead()}>
            <i className="r3d-dot live" style={{ '--c': 'currentColor' }} />Live<small>{clockOf(behind.ms)} behind</small></button>
          : <button type="button" className="r3d-live end" data-testid="run3d-live" title="Back to the end of the run" onClick={() => p.toHead()}><Icon name="end" size={13} />End</button>)}
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
    return [...(loose.length ? [{ name: 'Prepare', steps: loose }] : []), ...run.groups]
      .map((g) => ({ name: g.name, stations: (g.steps || []).map((id) => layout.byId[id]).filter(Boolean) })).filter((g) => g.stations.length);
  }, [run, layout]);
  const liveAt = groups.findIndex((g) => g.stations.some((st) => st.id === m.activeId));
  const at = m.finished ? (m.merged ? `merged into ${m.merged.base}` : `finished: ${run.final}`) : m.activeId ? `at ${m.activeId}` : 'in the issue inbox';
  return (
    <section className="r3d-pipe r3d-card" aria-label="Run pipeline">
      <div className="r3d-pipe-top">
        <div className="r3d-pipe-main">
          <div className="r3d-pipe-title">Run pipeline<span>{m.feed[0]?.text}</span></div>
          <div className="r3d-miles">{groups.map((g, gi) => {
            const live = g.stations.find((st) => st.id === m.activeId), touched = g.stations.filter((st) => m.state[st.id].visits);
            const status = live ? m.state[live.id].status : 'pending';
            // a group is done once the run went past it (or ended); visited and gone back to: partly
            const cls = live ? 'active' : touched.length && (m.finished || gi < liveAt) ? 'done' : touched.length ? 'part' : '';
            const ms = touched.reduce((sum, st) => sum + m.visits.filter((v) => v.step === st.id).reduce((s, v) => s + ((v.t1 ?? Math.max(now, m.lastTs)) - v.t0), 0), 0);
            return (
              <button type="button" key={g.name} className={'r3d-mile ' + cls} style={{ '--c': statusColor(status === 'pending' ? 'running' : status) }} onClick={() => onSelect((live || touched[touched.length - 1] || g.stations[0]).id)}>
                <i>{cls === 'done' && <Icon name="check" size={13} />}</i>
                <b>{g.name}</b><small>{live ? `${live.label} · ${clockOf(ms)}` : touched.length ? clockOf(ms) : 'queued'}</small>
              </button>
            );
          })}</div>
        </div>
        <button type="button" className={'r3d-item' + (shown === 'item' ? ' sel' : '')} onClick={() => onSelect('item')}>
          <i><Icon name="box" size={20} /></i><span><b>{itemName(run)}</b><small>{run.issues[0]?.title || run.task}</small><small>{at}</small></span>
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
      <div className="r3d-tag dim" ref={tagRef('start')}><i className="r3d-dot" style={{ '--c': statusColor('pending') }} />{run.resumedFrom ? `resumed at ${run.resumedFrom}` : issueText(run)}</div>
      <div className="r3d-tag dim" ref={tagRef('end')}><i className="r3d-dot" style={{ '--c': statusColor(m.merged ? 'done' : 'pending') }} />{m.merged ? `merged into ${m.merged.base}` : 'base branch'}</div>
      {layout.stations.map((st) => {
        const step = m.state[st.id], lead = st.kind === 'agent' && m.leadOf(st), r = lead && m.robots[`${st.id}:${lead}`];
        const live = step.status === 'running' || step.status === 'waiting' || r?.busy;
        const text = target === st.id ? 'supervisor on it' : step.status === 'waiting' ? 'waiting for you' : r?.busy ? r.act : step.status === 'pending' ? '' : STATUS[step.status].label.toLowerCase();
        return (
          <div key={st.id} ref={tagRef(st.id)} className={'r3d-tag' + (shown === st.id ? ' sel' : '') + (live ? ' live' : step.visits ? '' : ' dim')} onClick={() => onSelect(st.id)}>
            <i className={'r3d-dot' + (live ? ' live' : '')} style={{ '--c': statusColor(r?.busy && step.status !== 'waiting' ? 'running' : step.status) }} />{st.label}{text && <span>{text}</span>}
          </div>
        );
      })}
      <div ref={tagRef('supervisor')} className={'r3d-tag' + (shown === 'supervisor' ? ' sel' : '') + (target ? ' live' : ' dim')} onClick={() => onSelect('supervisor')}>
        <i className={'r3d-dot' + (target ? ' live' : '')} style={{ '--c': view.theme.supervisor }} />supervisor{target && <span>on {target}</span>}</div>
      <div ref={tagRef('item')} className={'r3d-tag' + (shown === 'item' ? ' sel' : '')} onClick={() => onSelect('item')}>
        <i className="r3d-dot" style={{ '--c': view.theme.accent }} />{itemName(run).replace(/^Task$/, 'task')}</div>
    </div>
  );
}

