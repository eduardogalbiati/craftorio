#!/usr/bin/env node
// The control channel's client (#336, packages/engine/control/index.js): calls one channel of the running app and
// prints its result as JSON. Plain Node, no dependencies.
//   node scripts/ctl.js <channel> [json-argument]
//   node scripts/ctl.js roadmap:start '{"projectId":"my-app"}'
//   node scripts/ctl.js watch <projectId> [--stall <seconds>] [--max <seconds>]
// The workspace is CRAFTORIO_WORKSPACE, or --workspace <dir>; the endpoint and its token come from
// <workspace>/control/endpoint.json (written while Settings › Execution › "Allow outside sessions to
// control this app" is on). A refused or failed call exits with 1 and prints the error on stderr.
//
// watch (#42) only reads (projects:list, roadmap:get, runs:active, runs:events): it returns, its last line
// `<reason>: <text>`, at the first of failed, finished, paused, gate, stage (the current stage is not the one of the
// first reading) and stalled (no run event for --stall seconds, 900 by default); --max seconds (3600 by default) later
// it returns `timeout`. Exit codes, craftorio-ctl's: 0 a reason, 1 a refused or failed call or a wrong use, 2 no
// endpoint, 3 the app speaks another contract version, 4 timeout. Its Rust twin (the same rules and texts):
// native/craftorio-ctl/src/watch.rs; both are tested on packages/engine/test/fixtures/ctl-watch-cases.json.

const fs = require('fs');
const http = require('http');
const path = require('path');

// The contract this client speaks: CONTROL_VERSION in packages/engine/control/index.js.
const CONTROL_VERSION = '1';
const POLL_MS = 1500;
// a run's whole event list is read to know whether it moved: at most this often
const EVENTS_MS = 30000;
const DEFAULT_STALL = '900';
const DEFAULT_MAX = '3600';
const MAX_SECONDS = 604800;

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const failure = (message, code = 1) => Object.assign(new Error(message), { exitCode: code });

function parseArgs(argv) {
  const rest = [];
  const options = { workspace: process.env.CRAFTORIO_WORKSPACE || '', stall: DEFAULT_STALL, max: DEFAULT_MAX };
  for (let i = 0; i < argv.length; i++) {
    const name = /^--(workspace|stall|max)$/.exec(argv[i])?.[1];
    if (name) options[name] = argv[++i] || '';
    else rest.push(argv[i]);
  }
  return { ws: options.workspace, channel: rest[0], json: rest[1], stall: options.stall, max: options.max };
}

// --stall and --max: a whole number of seconds, at most a week
function seconds(option, text) {
  const n = /^[0-9]{1,6}$/.test(text) ? Number(text) : 0;
  if (n < 1 || n > MAX_SECONDS) throw failure(`${option} must be a whole number of seconds, from 1 to ${MAX_SECONDS}.`);
  return n;
}

// `code`: the exit code without an endpoint
function readEndpoint(ws, code) {
  const file = path.join(ws, 'control', 'endpoint.json');
  try {
    const endpoint = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { url: new URL(endpoint.url).origin, token: endpoint.token };
  } catch {
    throw failure(`No control endpoint at ${file}: turn on Settings › Execution › "Allow outside sessions to control this app".`, code);
  }
}

// one request: the JSON the app answers on 200, else a failure with its error
function request(endpoint, { what, method, route, body }) {
  return new Promise((resolve, reject) => {
    const length = body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) };
    const req = http.request(`${endpoint.url}${route}`, {
      method,
      agent: false,
      headers: { authorization: `Bearer ${endpoint.token}`, ...length },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('error', (e) => reject(failure(`${what}: the app is not answering at ${endpoint.url} (${e.message}).`)));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { /* not JSON */ }
        if (res.statusCode !== 200) {
          const e = failure(`${what}: ${res.statusCode} ${(parsed && parsed.error) || data}`);
          reject(Object.assign(e, { status: res.statusCode }));
        } else resolve(parsed);
      });
    });
    req.on('error', (e) => reject(failure(`${what}: the app is not answering at ${endpoint.url} (${e.message}).`)));
    req.end(body);
  });
}

async function callChannel(endpoint, channel, arg) {
  const body = JSON.stringify(arg === undefined ? {} : { arg });
  const answer = await request(endpoint, { what: channel, method: 'POST', route: `/api/${encodeURIComponent(channel)}`, body });
  return answer ? answer.result : null;
}

// ---- watch ------------------------------------------------------------------------------------------------------

const list = (x) => (Array.isArray(x) ? x : []);
const oneLine = (text) => String(text || '').split(/\s+/).filter(Boolean).join(' ');
const isRelease = (entry) => entry.kind === 'release';
// the rules of packages/shared/roadmap-model.js (isFinished, isOpen, currentStage), which this file cannot load
const isFinished = (x) => ['done', 'parked', 'skipped'].includes(x.status) || (x.status === 'failed' && !!x.parked);
const isOpen = (stage) => !isRelease(stage) && !stage.disabled && list(stage.items).some((x) => !isFinished(x));
const atGate = (x) => !isFinished(x) && (!!x.waiting || !!x.run?.atGate);

// how an item is named: its issues, else its workflow
function itemLabel(x) {
  const numbers = list(x.issues).map((i) => i.number).filter((n) => Number.isInteger(n)).map((n) => `#${n}`);
  return numbers.join(', ') || oneLine(x.workflow) || 'an item';
}

// the gate an item waits at: its step's id (the run's trail, its waiting step) and name ("review (Review)")
function gateStep(x) {
  const id = oneLine(list(x.run?.progress).findLast((s) => s.status === 'waiting')?.step);
  const name = oneLine(x.run?.atGate);
  return id && name && id !== name ? `${id} (${name})` : id || name;
}

// the stage in progress as { id, label }; null: none is open
function currentStage(roadmap) {
  let number = 0;
  for (const stage of list(roadmap?.stages)) {
    if (!isRelease(stage)) number++;
    if (isOpen(stage)) {
      const name = oneLine(stage.name);
      return { id: String(stage.id || number), label: name && name !== `Stage ${number}` ? `stage ${number} (${name})` : `stage ${number}` };
    }
  }
  return null;
}

// the step of the gate a release's run waits at, or null (`active`: runs:active)
function releaseGate(roadmap, active) {
  for (const entry of list(roadmap?.stages).filter((s) => isRelease(s) && s.runId)) {
    const gate = list(list(active).find((r) => r.runId === entry.runId)?.gates)[0];
    if (gate) return { label: `release ${oneLine(entry.name)}`, step: gate.step_id };
  }
  return null;
}

/**
 * Why a watch returns on this roadmap (roadmap:get), or null. Pure. `first`: the stage in progress at the first reading.
 * A failed item first (it pauses the roadmap too); one interrupted at a gate, parked or in a disabled stage is no failure.
 */
function reasonOf(roadmap, { first, active = [] }) {
  const stages = list(roadmap?.stages);
  const failed = stages.filter((s) => !s.disabled).flatMap((s) => list(s.items)).find((x) => x.status === 'failed' && !isFinished(x) && !atGate(x));
  if (failed) return ['failed', [`${itemLabel(failed)} failed`, oneLine(failed.error || failed.run?.error)].filter(Boolean).join(': ')];
  if (roadmap?.state === 'done') return ['finished', 'the roadmap is done'];
  if (roadmap?.state === 'paused') return ['paused', ['the roadmap is paused', oneLine(roadmap.error)].filter(Boolean).join(': ')];
  const waiting = stages.flatMap((s) => list(s.items)).find(atGate);
  const gate = waiting ? { label: itemLabel(waiting), step: gateStep(waiting) } : releaseGate(roadmap, active);
  if (gate) return ['gate', `${gate.label} waits at a human gate: ${oneLine(gate.step) || 'its gate'}`];
  const now = currentStage(roadmap);
  if (first?.id !== now?.id) return ['stage', `from ${first?.label || 'no open stage'} to ${now?.label || 'no open stage'}`];
  return null;
}

// the runs of a roadmap in progress, with how they are named
function runningRuns(roadmap) {
  return list(roadmap?.stages).flatMap((s) => (isRelease(s)
    ? [{ runId: s.status === 'running' ? s.runId : null, label: `release ${oneLine(s.name)}` }]
    : list(s.items).map((x) => ({ runId: x.status === 'running' ? x.runId : null, label: itemLabel(x) })))).filter((r) => r.runId);
}

async function checkVersion(endpoint) {
  const speaks = (found) => failure(`The app's control channel speaks version ${found}, this client version ${CONTROL_VERSION}: use the client control/endpoint.json names.`, 3);
  const answer = await request(endpoint, { what: 'version', method: 'GET', route: '/api/version' }).catch((e) => {
    throw [404, 405].includes(e.status) ? speaks('(none: an older app)') : e;
  });
  if (answer?.version !== CONTROL_VERSION) throw speaks(answer?.version || '(none)');
}

// [reason, text] of the first thing to report
async function watchRoadmap(endpoint, projectId, stall) {
  await checkVersion(endpoint);
  const known = list(await callChannel(endpoint, 'projects:list')).some((p) => p.id === projectId);
  if (!known) throw failure(`watch: the app has no project "${projectId}" (projects:list names them).`);
  let first; // the stage in progress at the first reading
  let seen = null;
  let changedAt = 0;
  let sampledAt = 0;
  for (;;) {
    const roadmap = await callChannel(endpoint, 'roadmap:get', { projectId });
    if (first === undefined) first = currentStage(roadmap);
    const runs = runningRuns(roadmap);
    const releases = list(roadmap?.stages).some((s) => isRelease(s) && s.status === 'running' && s.runId);
    const active = releases ? await callChannel(endpoint, 'runs:active') : [];
    const reason = reasonOf(roadmap, { first, active });
    if (reason) return reason;
    const now = performance.now();
    if (seen === null || now - sampledAt >= Math.min(EVENTS_MS, stall * 250) || now - changedAt >= stall * 1000) {
      const marks = [];
      for (const { runId } of runs) {
        const events = list(await callChannel(endpoint, 'runs:events', { runId, activity: true }));
        marks.push([runId, events.length, events.at(-1) ?? null]);
      }
      const mark = JSON.stringify(marks);
      if (mark !== seen) changedAt = now;
      seen = mark;
      sampledAt = now;
      if (now - changedAt >= stall * 1000) return ['stalled', `no run event for ${stall} s (running: ${runs.map((r) => r.label).join(', ') || 'nothing'})`];
    }
    await new Promise((resolve) => { setTimeout(resolve, POLL_MS); });
  }
}

async function watch({ ws, projectId, stall, max }) {
  const [stallSeconds, maxSeconds] = [seconds('--stall', stall), seconds('--max', max)];
  const endpoint = readEndpoint(ws, 2);
  // also when the app accepts a call and never answers it
  const timeout = new Promise((resolve) => { setTimeout(() => resolve(['timeout', `nothing to report after ${maxSeconds} s`]), maxSeconds * 1000); });
  const [reason, text] = await Promise.race([watchRoadmap(endpoint, projectId, stallSeconds), timeout]);
  process.stdout.write(`${reason}: ${text}\n`, () => process.exit(reason === 'timeout' ? 4 : 0));
}

// ---- the command line -------------------------------------------------------------------------------------------

async function main() {
  const { ws, channel, json, stall, max } = parseArgs(process.argv.slice(2));
  if (!channel || (channel === 'watch' && !json)) {
    throw failure('Usage: node scripts/ctl.js <channel> [json-argument] [--workspace <dir>]\n       node scripts/ctl.js watch <projectId> [--stall <seconds>] [--max <seconds>] [--workspace <dir>]');
  }
  if (!ws) throw failure('No workspace: set CRAFTORIO_WORKSPACE or pass --workspace <dir>.');
  if (channel === 'watch') {
    await watch({ ws, projectId: json, stall, max });
    return;
  }
  const endpoint = readEndpoint(ws, 1);
  let arg;
  if (json !== undefined) {
    try { arg = JSON.parse(json); } catch { throw failure(`The argument is not valid JSON: ${json}`); }
  }
  const result = await callChannel(endpoint, channel, arg);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main().catch((e) => fail(e.message, e.exitCode || 1));

module.exports = {
  CONTROL_VERSION,
  currentStage,
  reasonOf,
  runningRuns,
};
