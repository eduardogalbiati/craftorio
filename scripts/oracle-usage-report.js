// The Oracle's spend per UTC day (#244), from <workspace>/oracle/usage.jsonl and messages.jsonl: the
// turns by kind (wake, owner, handoff: a usage line with no answer posted right after it), each
// turn's own cost (packages/engine/domains/oracle/oracle.js usageLines: Claude's cumulative cost per session, differenced), the
// cost the app reported before #244 (the plain sum), cache read / write and output tokens, the
// context at the day's first turn and its peak, wake-ups answered / refused, code-only notices and
// the action cards proposed during wake turns. Read-only: nothing is rewritten.
//
//   node scripts/oracle-usage-report.js [--dir <oracle folder>] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//
// --dir defaults to $MULTIAGENT_WORKSPACE/oracle.

const fs = require('fs');
const path = require('path');
const { usageLines } = require('@craftorio/engine/domains/oracle/oracle');

const MATCH_MS = 10e3; // an answer is posted right after its usage line

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').map((l) => { try { return l ? JSON.parse(l) : null; } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

/** usage lines + messages → one row per UTC day. */
function report(dir, { from = null, to = null } = {}) {
  const usage = usageLines(dir);
  const messages = readLines(path.join(dir, 'messages.jsonl'));
  const answers = messages.filter((m) => m.role === 'oracle' && !m.kind && !m.simulated);
  const days = new Map();
  const row = (ts) => {
    const day = String(ts).slice(0, 10);
    if (!days.has(day)) {
      days.set(day, {
        day, turns: { wake: 0, owner: 0, handoff: 0 }, costByKind: { wake: 0, owner: 0, handoff: 0 }, realUsd: 0, reportedUsd: 0,
        cacheRead: 0, cacheWrite: 0, output: 0, contextStart: null, contextPeak: 0, wakesAnswered: 0, wakesRefused: 0, notices: 0, wakeActions: 0,
      });
    }
    return days.get(day);
  };
  const used = new Set();
  for (const u of usage) {
    if (!u.ts) continue;
    const r = row(u.ts);
    const t = Date.parse(u.ts);
    const answer = answers.find((m) => !used.has(m.id) && Date.parse(m.ts) >= t - 1000 && Date.parse(m.ts) - t <= MATCH_MS);
    if (answer) used.add(answer.id);
    const kind = !answer ? 'handoff' : answer.wake ? 'wake' : 'owner';
    r.turns[kind] += 1;
    r.costByKind[kind] += u.turnUsd;
    r.realUsd += u.turnUsd;
    r.reportedUsd += Number(u.costUsd) || 0;
    r.cacheRead += Number(u.tokens?.cache_read) || 0;
    r.cacheWrite += Number(u.tokens?.cache_write) || 0;
    r.output += Number(u.tokens?.output) || 0;
  }
  let inWake = false;
  for (const m of messages) {
    if (!m.ts) continue;
    const r = row(m.ts);
    if (m.role === 'oracle' && !m.kind && Number(m.contextTokens) > 0) {
      if (r.contextStart == null) r.contextStart = Number(m.contextTokens);
      r.contextPeak = Math.max(r.contextPeak, Number(m.contextTokens));
    }
    if (m.kind === 'wake') inWake = true;
    if (m.kind === 'wake-refused') r.wakesRefused += 1;
    if (m.kind === 'notice') r.notices += 1;
    if (m.kind === 'action' && inWake) r.wakeActions += 1;
    if (m.role === 'oracle' && m.wake) { r.wakesAnswered += 1; inWake = false; }
  }
  return [...days.values()].filter((r) => (!from || r.day >= from) && (!to || r.day <= to)).sort((a, b) => a.day.localeCompare(b.day));
}

const usd = (n) => `$${n.toFixed(2)}`;
const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

function table(rows) {
  const head = '| UTC day | Turns (wake / owner / handoff) | Cache read | Cache write | Output | Reported (old sum) | **Real** | Real wake cost | Context (first → peak) | Wakes answered / refused | Notices | Actions from wakes |';
  const lines = rows.map((r) => `| ${r.day} | ${r.turns.wake + r.turns.owner + r.turns.handoff} (${r.turns.wake} / ${r.turns.owner} / ${r.turns.handoff}) | ${k(r.cacheRead)} | ${k(r.cacheWrite)} | ${k(r.output)} | ${usd(r.reportedUsd)} | **${usd(r.realUsd)}** | ${usd(r.costByKind.wake)} | ${r.contextStart == null ? '-' : `${k(r.contextStart)} → ${k(r.contextPeak)}`} | ${r.wakesAnswered} / ${r.wakesRefused} | ${r.notices} | ${r.wakeActions} |`);
  const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  const total = `| **Total** | ${sum((r) => r.turns.wake + r.turns.owner + r.turns.handoff)} | ${k(sum((r) => r.cacheRead))} | ${k(sum((r) => r.cacheWrite))} | ${k(sum((r) => r.output))} | ${usd(sum((r) => r.reportedUsd))} | **${usd(sum((r) => r.realUsd))}** | ${usd(sum((r) => r.costByKind.wake))} | | ${sum((r) => r.wakesAnswered)} / ${sum((r) => r.wakesRefused)} | ${sum((r) => r.notices)} | ${sum((r) => r.wakeActions)} |`;
  return [head, `|${'---|'.repeat(12)}`, ...lines, total].join('\n');
}

if (require.main === module) {
  const dir = arg('dir', process.env.MULTIAGENT_WORKSPACE ? path.join(process.env.MULTIAGENT_WORKSPACE, 'oracle') : null);
  if (!dir || !fs.existsSync(dir)) {
    console.error('Usage: node scripts/oracle-usage-report.js --dir <workspace>/oracle [--from YYYY-MM-DD] [--to YYYY-MM-DD]');
    process.exit(1);
  }
  console.log(table(report(dir, { from: arg('from'), to: arg('to') })));
}

module.exports = {
  report,
  table,
};
