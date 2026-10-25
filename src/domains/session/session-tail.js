// Follows one agent session live in a terminal: prompts, thinking, text, tool calls, results
// and usage, read from <run>/sessions/<id>.jsonl (written by the recorder).
// With the session id "orchestrator" it follows the whole run instead (<run>/events.jsonl):
// steps, transitions, sessions, approvals, actions and logs.
// Two uses:
// - module: followSession(runDir, sessionId, write) streams it into the app's embedded terminal
//   (no child process);
// - script, for the external console window, run by the Electron binary in Node mode
//   (ELECTRON_RUN_AS_NODE=1):  <electron> src/domains/session/session-tail.js <runDir> <sessionId>
// followFile (#465) follows a plain log instead (a machine step's output), printed as it is:
// the script's `<runDir> --file <path in the run folder>`.

const fs = require('fs');
const path = require('path');
const { StringDecoder } = require('string_decoder');


const c = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
const dim = c('2');
const bold = c('1');
const cyan = c('36');
const yellow = c('33');
const green = c('32');
const red = c('31');
const magenta = c('35');
const time = (ts) => dim(new Date(ts).toLocaleTimeString('en-US', { hour12: false }));
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n)}… (${s.length - n} more chars)` : s; };
const indent = (s) => String(s).replace(/\n/g, '\n    ');

/**
 * Follows a session (or, with "orchestrator", the whole run) and writes formatted lines.
 * @returns stop()
 */
function followSession(runDir, sessionId, write) {
const ORCHESTRATOR = sessionId === 'orchestrator';
const file = ORCHESTRATOR ? path.join(runDir || '', 'events.jsonl') : path.join(runDir || '', 'sessions', `${sessionId}.jsonl`);
const out = (line = '') => write(`${line}\n`);

function print(ev) {
  switch (ev.type) {
    case 'session.opened':
      out(bold(`${ev.session.agent}`) + dim(` · ${ev.session.provider} · ${ev.session.model} · ${ev.session_id}`));
      break;
    case 'session.message_sent':
      out(`\n${time(ev.ts)} ${bold(cyan(`── turn ${ev.turn}`))} ${dim(ev.step_id || '')}`);
      out(dim(`    prompt: ${indent(clip(ev.prompt, 1500))}`));
      break;
    case 'session.stream': {
      const it = ev.item || {};
      if (it.kind === 'thinking') out(`${time(ev.ts)} ${magenta('thinking')}  ${dim(indent(clip(it.text, 2000)))}`);
      else if (it.kind === 'text') out(`${time(ev.ts)} ${green('text')}      ${indent(it.text)}`);
      else if (it.kind === 'tool_call') out(`${time(ev.ts)} ${yellow('tool')}      ${bold(it.name || '?')} ${dim(clip(it.input?.command ?? JSON.stringify(it.input ?? ''), 400))}`);
      else if (it.kind === 'tool_result') out(`${time(ev.ts)} ${it.is_error ? red('error') : dim('result')}    ${dim(indent(clip(it.output, 800)))}`);
      else if (it.kind === 'stderr') out(`${time(ev.ts)} ${red('stderr')}    ${dim(clip(it.text, 600))}`);
      else if (it.kind === 'spawn') out(`${time(ev.ts)} ${dim(`$ ${path.basename(it.command)} ${(it.args || []).join(' ')}`)}`);
      else if (it.kind === 'session') out(`${time(ev.ts)} ${dim(`provider session ${it.sessionId}`)}`);
      break;
    }
    case 'session.message_received': {
      const u = ev.usage || {};
      const cost = ev.cost_usd != null ? ` · $${ev.cost_usd.toFixed(4)}` : '';
      out(`${time(ev.ts)} ${cyan('done')}      ${dim(`${Math.round((ev.duration_ms || 0) / 1000)}s · in ${u.input || 0} · cache ${u.cache_read || 0} · out ${u.output || 0}${cost}`)}`);
      break;
    }
    case 'session.status':
      if (ev.status === 'retrying' || ev.status === 'error') out(`${time(ev.ts)} ${red(ev.status)}`);
      break;
    case 'session.closed':
      out(`\n${time(ev.ts)} ${bold(`session closed: ${ev.status}`)}  ${dim('(you can close this window)')}`);
      break;
    default:
  }
}

function printOrchestrator(ev) {
  const t = time(ev.ts);
  switch (ev.type) {
    case 'workflow.started':
      out(`${t} ${bold(`▶ ${ev.workflow} ${ev.version || ''}`)}${ev.mock ? yellow(' (simulation)') : ''}`);
      for (const [k, v] of Object.entries(ev.inputs || {})) out(dim(`    ${k}: ${clip(String(v).replace(/\s+/g, ' '), 160)}`));
      break;
    case 'step.started': out(`\n${t} ${bold(cyan(`▶ ${ev.step_id}`))} ${dim(`visit ${ev.visit}${ev.agent ? ` · ${ev.agent}` : ''}`)}`); break;
    case 'step.finished': out(`${t} ${green('✓')} ${ev.step_id} ${dim(clip(JSON.stringify(ev.output), 300))}`); break;
    case 'step.transition': out(`${t} ${dim(`→ ${ev.to}   [${ev.when}]`)}`); break;
    case 'step.waiting': out(`${t} ${dim(`⏳ /loop: next check in ${Math.round((ev.interval_ms || 0) / 1000)}s`)}`); break;
    case 'step.goal': out(`${t} ${ev.met ? green('🎯 goal met') : yellow('🎯 goal pending')} ${dim(ev.goal || '')}`); break;
    case 'session.opened': if (ev.session_id !== 'orchestrator') out(`${t} ${dim(`+ session ${ev.session_id} ${ev.session.agent} (${ev.session.provider}/${ev.session.model})`)}`); break;
    case 'session.closed': if (ev.session_id !== 'orchestrator') out(`${t} ${dim(`- session ${ev.session_id} ${ev.status}`)}`); break;
    case 'session.message_received': out(`${t} ${dim(`  ${ev.session_id} answered in ${Math.round((ev.duration_ms || 0) / 1000)}s${ev.cost_usd != null ? ` · $${ev.cost_usd.toFixed(4)}` : ''}`)}`); break;
    case 'approval.requested': out(`${t} ${bold(yellow('? approval needed'))} ${indent(ev.message || '')}`); break;
    case 'approval.resolved': out(`${t} ${yellow(`  decision: ${ev.choice ?? (ev.approved ? 'approved' : 'rejected')} (${ev.by})`)}`); break;
    case 'action.executed': out(`${t} ${dim(`$ ${ev.command} → ${ev.skipped ? 'skipped (simulation)' : `exit ${ev.exit_code}`}`)}`); break;
    case 'file.saved': out(`${t} ${dim(`💾 ${ev.path}`)}`); break;
    case 'decision.logged': out(`${t} ${dim(`📝 ${ev.agent}: ${ev.count} decision(s)`)}`); break;
    case 'supervisor.started': out(`${t} ${bold(magenta('◆ supervisor'))} called on ${ev.step_id}: ${dim(clip(ev.error, 300))}`); break;
    case 'supervisor.decision': out(`${t} ${bold(magenta(`◆ supervisor → ${ev.action}${ev.goto ? ` ${ev.goto}` : ''}`))} ${indent(ev.explanation || '')}${ev.instruction ? `
    ${dim(`instruction: ${indent(ev.instruction)}`)}` : ''}`); break;
    case 'budget.exceeded': out(`${t} ${red(`💸 ${ev.provider} reached its monthly budget`)}`); break;
    case 'limit.exceeded': out(`${t} ${red(`limit exceeded: ${ev.limit}`)}`); break;
    case 'log': out(`${t} ${ev.level === 'error' ? red(ev.message) : ev.level === 'warn' ? yellow(ev.message) : dim(ev.message)}`); break;
    case 'workflow.finished':
      out(`\n${t} ${bold(ev.status === 'success' ? green(`■ ${ev.status}`) : red(`■ ${ev.status}`))}${ev.error ? ` ${red(ev.error)}` : ''}`);
      if (ev.summary) out(dim(`    ${Math.round(ev.summary.duration_ms / 1000)}s · $${ev.summary.cost_usd}`));
      break;
    default:
  }
}

let offset = 0;
let partial = '';
function readNew() {
  let size;
  try { size = fs.statSync(file).size; } catch { return; }
  if (size <= offset) return;
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  offset = size;
  const lines = (partial + buf.toString('utf8')).split('\n');
  partial = lines.pop();
  for (const l of lines) {
    if (!l.trim()) continue;
    try { (ORCHESTRATOR ? printOrchestrator : print)(JSON.parse(l)); } catch { /* ignore a broken line */ }
  }
}

out(dim(`Following ${file}\n`));
readNew();
const timer = setInterval(readNew, 400);
return () => clearInterval(timer);
}

/**
 * Follows a plain log (a machine step's command output, #465): prints it as it is, then what is
 * appended, every 400 ms. Waits for a file that does not exist yet; a file that shrinks (rewritten)
 * is read again from its start. Keeps following until stop().
 * @returns stop()
 */
function followFile(file, write) {
  const decoder = new StringDecoder('utf8');
  let offset = 0;
  function readNew() {
    let size;
    try { size = fs.statSync(file).size; } catch { return; }
    if (size < offset) offset = 0;
    if (size === offset) return;
    const buf = Buffer.alloc(size - offset);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buf, 0, buf.length, offset); } finally { fs.closeSync(fd); }
    offset = size;
    const text = decoder.write(buf);
    if (text) write(text);
  }
  write(`${dim(`Following ${file}\n`)}\n`);
  readNew();
  const timer = setInterval(readNew, 400);
  return () => clearInterval(timer);
}

module.exports = { followFile, followSession };

if (require.main === module) {
  const [runDir, sessionId, rel] = process.argv.slice(2);
  if (!runDir || !sessionId || (sessionId === '--file' && !rel)) {
    console.error('usage: session-tail <runDir> <sessionId> | session-tail <runDir> --file <path in the run folder>');
    process.exit(1);
  }
  if (sessionId === '--file') {
    process.stdout.write(`\x1b]0;${rel} · multiagent\x07`); // window title
    followFile(path.join(runDir, rel), (text) => process.stdout.write(text));
  } else {
    process.stdout.write(`\x1b]0;${sessionId} · multiagent\x07`); // window title
    followSession(runDir, sessionId, (text) => process.stdout.write(text));
  }
}
