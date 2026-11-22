#!/usr/bin/env node
// Counts the tool calls a CLI refused in headless runs (permission checks nobody could answer, #96)
// from each run's events.jsonl, per session, with the session's tool calls and cache_read tokens,
// so a run after a change to the capabilities can be compared with earlier ones.
//   node scripts/count-refusals.js <run_dir or run id>... [--workspace <dir>] [--show]
// A run id is looked up in <workspace>/runs. --show prints the first line of each refusal.

const fs = require('fs');
const path = require('path');
const { isPermissionDenial } = require('@craftorio/engine/engine/providers');

// Claude Code's refusals of a Bash call it would ask about (plus the generic denial wording);
// "Contains ..." is its static check of shell syntax ("Contains simple_expansion", "Contains shell
// syntax (string) that cannot be statically analyzed").
const REFUSAL_RE = /^(This command requires approval|This Bash command contains multiple operations|Commands that change directories|Output redirection to|Contains \S)/;

const isRefusal = (item) => item?.kind === 'tool_result' && !!item.is_error
  && (REFUSAL_RE.test(String(item.output || '').trim()) || isPermissionDenial(item));

function runFolder(arg, workspace) {
  if (fs.existsSync(path.join(arg, 'events.jsonl'))) return arg;
  const ws = workspace || process.env.CRAFTORIO_WORKSPACE || require('@craftorio/engine/domains/workspace/workspace').existingDefaultWorkspace();
  return path.join(ws, 'runs', arg);
}

// { runId, sessions: [{ id, agent, provider, calls, refused, cacheRead, samples }] }
function countRun(dir) {
  const sessions = new Map();
  const of = (id) => {
    if (!sessions.has(id)) sessions.set(id, { id, agent: '?', provider: '?', calls: 0, refused: 0, cacheRead: 0, samples: [] });
    return sessions.get(id);
  };
  for (const line of fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'session.opened' && ev.session) Object.assign(of(ev.session_id), { agent: ev.session.agent, provider: ev.session.provider });
    if (ev.type !== 'session.stream' || !ev.item) continue;
    const s = of(ev.session_id);
    if (ev.item.kind === 'tool_call') s.calls++;
    if (ev.item.kind === 'usage') s.cacheRead += ev.item.usage?.cache_read || 0;
    if (isRefusal(ev.item)) {
      s.refused++;
      s.samples.push(String(ev.item.output).split('\n')[0].slice(0, 160));
    }
  }
  return { runId: path.basename(dir), sessions: [...sessions.values()].filter((s) => s.calls || s.refused) };
}

function main(argv) {
  const show = argv.includes('--show');
  const wsAt = argv.indexOf('--workspace');
  const workspace = wsAt >= 0 ? argv[wsAt + 1] : null;
  const runs = argv.filter((a, i) => !a.startsWith('--') && (wsAt < 0 || i !== wsAt + 1));
  if (!runs.length) {
    console.error('usage: node scripts/count-refusals.js <run_dir or run id>... [--workspace <dir>] [--show]');
    return 2;
  }
  let calls = 0;
  let refused = 0;
  for (const arg of runs) {
    const dir = runFolder(arg, workspace);
    if (!fs.existsSync(path.join(dir, 'events.jsonl'))) { console.error(`${arg}: no events.jsonl in ${dir}`); continue; }
    const run = countRun(dir);
    console.log(run.runId);
    for (const s of run.sessions) {
      calls += s.calls;
      refused += s.refused;
      console.log(`  ${s.id.padEnd(4)} ${String(s.agent).padEnd(18)} ${String(s.provider).padEnd(8)} calls ${String(s.calls).padStart(4)}  refused ${String(s.refused).padStart(3)}  cache_read ${s.cacheRead.toLocaleString('en-US')}`);
      if (show) for (const m of s.samples) console.log(`       ${m}`);
    }
  }
  console.log(`total: ${refused} refused of ${calls} tool calls (${calls ? ((100 * refused) / calls).toFixed(1) : '0.0'}%)`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { countRun, isRefusal };
