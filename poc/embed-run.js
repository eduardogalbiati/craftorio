#!/usr/bin/env node
// Embeds real runs of the workspace into poc/run-3d.html, as the compact replay the page plays.
// Reads runs/<id>/events.jsonl (and summary.json, and the workflow's YAML for the agents' colours)
// and rewrites the page's <script id="run-data"> block. Read-only on the workspace.
//
//   node poc/embed-run.js <run id> [<run id> ...]      the first one is the run the page opens with
//
// Workspace: MULTIAGENT_WORKSPACE, or <home>/multiagent-workspace.
// What a replay keeps of a run: its steps and their outcomes, every agent turn (cost, tokens), the
// agents' tool calls and messages (shortened), handoff notes, gates, supervisor calls and the merge.
// A wait at a human gate longer than a minute is cut to 45 s of replay (`skips` holds what was cut).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const WORKSPACE = process.env.MULTIAGENT_WORKSPACE || path.join(os.homedir(), 'multiagent-workspace');
const PAGE = path.join(__dirname, 'run-3d.html');
const OPEN = '<script id="run-data" type="application/json">', CLOSE = '</script>';
const GATE_WAIT_MS = 45000;

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// no machine paths in the page: a worktree file by its path in the repository, the rest by its name
const clean = (s) => one(s)
  .replace(/[A-Za-z]:[\\/][^\s"'`]*?[\\/]worktrees[\\/][^\\/\s"'`]+[\\/]?/g, '')
  .replace(/[A-Za-z]:[\\/](?:[^\\/\s"'`]+[\\/])+/g, '')
  .replace(/\\/g, '/');
const short = (s, n) => { const t = clean(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** The agents of a workflow file: { name: { color, provider, model } } (a line scan, no YAML parser). */
function agentsOf(file) {
  const agents = {};
  let text;
  try { text = fs.readFileSync(path.join(WORKSPACE, 'workflows', file), 'utf8'); } catch { return agents; }
  let inside = false, cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^agents:\s*$/.test(line)) { inside = true; continue; }
    if (inside && /^\S/.test(line)) inside = false;
    if (!inside) continue;
    const name = /^ {2}([A-Za-z_][\w-]*):\s*$/.exec(line);
    if (name) { cur = agents[name[1]] = {}; continue; }
    const color = /^ {4}color:\s*"?(#[0-9A-Fa-f]{6})/.exec(line);
    if (cur && color) cur.color = color[1].toUpperCase();
    const field = /^ {4}(provider|model):\s*"?([^"\s#]+)/.exec(line);
    if (cur && field) cur[field[1]] = field[2];
  }
  return agents;
}

/** How a step ended, from its output: done, failed or changes (a reviewer asked for changes). */
function outcome(o) {
  if (!o || typeof o !== 'object') return 'done';
  if (o.kind === 'suite' || o.kind === 'test_ids') return o.status === 'pass' ? 'done' : 'failed';
  if (o.results) return Object.values(o.results).some((r) => r && r.verdict && r.verdict !== 'approved') ? 'changes' : 'done';
  if (o.verdict) return o.verdict === 'not_verified' ? 'failed' : 'done';
  if (o.tests_status) return o.tests_status === 'pass' ? 'done' : 'failed';
  if (o.build_status) return o.build_status === 'success' ? 'done' : 'failed';
  if (o.blocked === true) return 'failed';
  return 'done';
}

/** One line about a step's output. */
function noteOf(o) {
  if (!o || typeof o !== 'object') return one(o);
  if (o.kind === 'suite') {
    const counts = o.passed == null && o.failed == null ? `${o.status || 'ran'}${(o.failures || []).length ? `, ${o.failures.length} failure(s)` : ''}` : `${o.passed ?? 0} passed, ${o.failed ?? 0} failed`;
    return `${counts} (${o.scope || 'suite'}): ${o.command || ''}`;
  }
  if (o.kind === 'screenshots') return `${o.taken ?? 0} screenshots of ${o.screens ?? 0} screens`;
  if (o.results) {
    return Object.entries(o.results).filter(([, r]) => r && r.verdict)
      .map(([agent, r]) => `${agent}: ${String(r.verdict).replace(/_/g, ' ')}, ${(r.findings || []).length} finding(s)`).join('; ');
  }
  return o.summary || o.message || o.claim || Object.values(o).find((v) => typeof v === 'string') || '';
}

function toolDetail(input = {}) {
  return input.description || input.file_path || input.pattern || input.command || input.prompt || input.query || '';
}

function compact(runId) {
  const dir = path.join(WORKSPACE, 'runs', runId);
  const events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  let summary = {};
  try { summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')); } catch { /* a run that never finished */ }
  const started = events.find((e) => e.type === 'workflow.started');
  if (!started) throw new Error(`${runId}: no workflow.started event`);
  const t0 = Date.parse(events[0].ts);
  const defs = agentsOf(started.file || `${started.workflow}.yaml`);

  const sessions = {}, turns = [], out = [], open = {}, lastCtx = {};
  let asked = null;
  const cuts = []; // [{ from, to }] in run time: the part of a gate wait the replay skips
  for (const e of events) {
    const t = Date.parse(e.ts) - t0;
    const push = (k, rest) => out.push({ t, k, ...rest });
    switch (e.type) {
      case 'session.opened': {
        const s = e.session || {};
        if (s.agent && s.agent !== 'orchestrator') sessions[e.session_id] = { agent: s.agent, provider: s.provider, model: s.model };
        break;
      }
      case 'step.started': push('step', { step: e.step_id, visit: e.visit, type: e.step_type }); break;
      case 'step.finished': push('end', { step: e.step_id, visit: e.visit, st: outcome(e.output), note: short(noteOf(e.output), 220) }); break;
      case 'step.transition': if (e.when === 'on_error') push('go', { from: e.from, to: e.to, err: 1 }); break;
      case 'session.message_sent':
        if (!sessions[e.session_id]) break;
        open[e.session_id] = { t0: t, step: e.step_id };
        push('sent', { sid: e.session_id, step: e.step_id });
        break;
      case 'session.message_received': {
        const turn = open[e.session_id];
        if (!turn || !sessions[e.session_id]) break;
        delete open[e.session_id];
        const u = e.usage || {};
        turns.push({ sid: e.session_id, step: turn.step, t0: turn.t0, t1: t, cost: +(e.cost_usd || 0).toFixed(4), out: u.output || 0, all: (u.input || 0) + (u.output || 0) + (u.cache_read || 0) + (u.cache_write || 0) });
        push('recv', { sid: e.session_id, text: short(e.text, 240) });
        break;
      }
      case 'session.stream': {
        const item = e.item || {}, sid = e.session_id;
        if (!sessions[sid]) break;
        if (item.kind === 'tool_call') push('tool', { sid, n: item.name, d: short(toolDetail(item.input), 72) });
        else if (item.kind === 'tool_result') push('res', { sid });
        else if (item.kind === 'text') push('say', { sid, text: short(item.text, 150) });
        else if (item.kind === 'thinking') push('think', { sid });
        else if (item.kind === 'context' && Math.abs(item.tokens - (lastCtx[sid] || 0)) > (lastCtx[sid] || 0) * 0.04) {
          lastCtx[sid] = item.tokens;
          push('ctx', { sid, n: item.tokens });
        }
        break;
      }
      case 'handoff.saved': push('handoff', { step: e.step_id, agent: e.agent, note: short(e.note, 260) }); break;
      case 'approval.requested':
        asked = t;
        push('ask', { step: e.step_id, text: short((e.brief && e.brief.headline) || e.message, 220) });
        break;
      case 'approval.resolved':
        if (asked !== null && t - asked > 60000) cuts.push({ from: asked + GATE_WAIT_MS, to: t });
        asked = null;
        push('answer', { step: e.step_id, choice: e.choice ?? (e.approved === false ? 'reject' : 'approve'), by: e.by || 'user', via: e.via, wait: e.wait_ms || 0 });
        break;
      case 'supervisor.started': push('sup', { step: e.step_id, text: short(e.error, 160) }); break;
      case 'supervisor.decision': push('supdone', { step: e.step_id, action: e.action, goto: e.goto, text: short(e.explanation, 220) }); break;
      case 'limit.exceeded': push('log', { level: 'warn', text: short(e.message || `limit exceeded: ${e.limit || e.kind || ''}`, 160) }); break;
      case 'log': if (e.level === 'warn' || e.level === 'error') push('log', { level: e.level, text: short(e.message, 160) }); break;
      case 'worktree.merged': push('merged', { branch: e.branch, base: e.base, commit: String(e.commit || '').slice(0, 7) }); break;
      case 'workflow.finished': push('fin', { status: e.status }); break;
      default:
    }
  }

  // replay time: run time minus the gate waits that were cut
  const at = (t) => t - cuts.reduce((sum, c) => sum + Math.max(0, Math.min(t, c.to) - c.from), 0);
  for (const e of out) e.t = at(e.t);
  for (const turn of turns) { turn.t0 = at(turn.t0); turn.t1 = at(turn.t1); }
  const end = Date.parse(events[events.length - 1].ts) - t0;

  const visited = new Set(out.filter((e) => e.k === 'step').map((e) => e.step));
  const agents = {};
  const agentOf = (name) => (agents[name] ||= { ...(defs[name] || {}), label: (started.display?.agents || {})[name] || name.replace(/_/g, ' ') });
  for (const s of Object.values(sessions)) Object.assign(agentOf(s.agent), { provider: s.provider, model: s.model });
  const steps = (started.steps || []).map((s) => {
    const names = s.agent ? String(s.agent).split('·').map((a) => a.trim()).filter(Boolean) : [];
    names.forEach(agentOf);
    return { id: s.id, type: s.type, agents: names, label: (started.display?.steps || {})[s.id] || s.id, visited: visited.has(s.id) };
  });

  return {
    id: runId, workflow: started.workflow, project: started.project_id || '', mode: started.inputs?.mode || '',
    status: summary.status || (out.find((e) => e.k === 'fin') || {}).status || 'unknown',
    startedAt: events[0].ts, durationMs: at(end), realMs: end, skips: cuts.map((c) => ({ t: at(c.from), ms: c.to - c.from })),
    costUsd: summary.cost_usd ?? +turns.reduce((sum, x) => sum + x.cost, 0).toFixed(4),
    issues: (started.issues || []).map((i) => ({ number: i.number, title: i.title })),
    task: short(started.inputs?.task, 120), branch: summary.worktree?.branch || summary.outputs?.branch || '',
    resumedFrom: started.resumed_from ? started.resumed_from.step : '',
    groups: started.groups || [], steps, agents, sessions, turns, events: out,
  };
}

function main() {
  const ids = process.argv.slice(2);
  if (!ids.length) { console.error('usage: node poc/embed-run.js <run id> [<run id> ...]'); process.exit(1); }
  const runs = ids.map(compact);
  const page = fs.readFileSync(PAGE, 'utf8');
  const a = page.indexOf(OPEN), b = page.indexOf(CLOSE, a);
  if (a < 0 || b < 0) throw new Error(`${PAGE}: the run-data block is missing`);
  // "<" escaped, so no text of a run can close the script block
  const json = JSON.stringify(runs).replace(/</g, '\\u003c');
  fs.writeFileSync(PAGE, page.slice(0, a + OPEN.length) + json + page.slice(b));
  for (const r of runs) console.log(`${r.id}  ${r.workflow}  ${r.events.length} events, ${r.turns.length} turns, ${(r.durationMs / 60000).toFixed(1)} min of replay`);
  console.log(`embedded ${runs.length} run(s), ${(json.length / 1024).toFixed(0)} KB, in ${PAGE}`);
}

main();
