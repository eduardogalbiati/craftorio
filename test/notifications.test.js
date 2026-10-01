const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runNotice, interruptedNotice, sessionNotice, shouldNotify, attentionSignal, promptLine, WaitDetector } = require('../src/notifications');
const { setupWorkspace } = require('../src/workspace');
const { createService } = require('../src/service');

const RUN = { workflow: 'software-development', project: 'demo', mock: false };

test('a run notice names the workflow, the project and the new status', () => {
  const started = runNotice({ type: 'workflow.started', run_id: 'r1', workflow: 'software-development' }, RUN);
  assert.equal(started.title, 'Run started: software-development');
  assert.equal(started.body, 'Project: demo');
  assert.deepEqual(started.target, { runId: 'r1', workflow: 'software-development' });

  const gate = runNotice({ type: 'approval.requested', run_id: 'r1', step_id: 'human_review', message: 'Merge the PR?' }, RUN);
  assert.equal(gate.event, 'waiting');
  assert.equal(gate.title, 'Waiting for you: software-development');
  assert.equal(gate.body, 'Project: demo\nMerge the PR?');

  const ok = runNotice({ type: 'workflow.finished', run_id: 'r1', status: 'success', error: null }, RUN);
  assert.equal(ok.title, 'Run succeeded: software-development');
  assert.equal(ok.event, 'succeeded');

  const failed = runNotice({ type: 'workflow.finished', run_id: 'r1', status: 'failed', error: 'CI is red' }, { workflow: 'ai-arena', project: null, mock: true });
  assert.equal(failed.title, 'Run failed: ai-arena');
  assert.equal(failed.body, 'Project: none (simulation)\nCI is red');

  assert.equal(runNotice({ type: 'workflow.finished', run_id: 'r1', status: 'cancelled' }, RUN).title, 'Run cancelled: software-development');
  assert.equal(runNotice({ type: 'step.started', run_id: 'r1' }, RUN), null);
});

test('a run\'s display title (#84) is shown with its workflow; without one the workflow alone is used', () => {
  const titled = { ...RUN, title: 'Notifications, 2nd try after conflict' };
  const started = runNotice({ type: 'workflow.started', run_id: 'r1', workflow: 'software-development' }, titled);
  assert.equal(started.title, 'Run started: Notifications, 2nd try after conflict (software-development)');
  const gate = runNotice({ type: 'approval.requested', run_id: 'r1', step_id: 'human_review' }, titled);
  assert.equal(gate.title, 'Waiting for you: Notifications, 2nd try after conflict (software-development)');

  const interrupted = interruptedNotice({ runId: 'r1', workflow: 'software-development', project: 'demo', mock: false, title: 'Notifications' });
  assert.equal(interrupted.title, 'Run interrupted: Notifications (software-development)');
  const noTitle = interruptedNotice({ runId: 'r1', workflow: 'software-development', project: 'demo', mock: false });
  assert.equal(noTitle.title, 'Run interrupted: software-development');
});

test('notices respect the per-kind setting and what the focused window shows', () => {
  const gate = runNotice({ type: 'approval.requested', run_id: 'r1', message: 'ok?' }, RUN);
  const started = runNotice({ type: 'workflow.started', run_id: 'r1' }, RUN);
  const session = sessionNotice('t3', { title: 'fix the tests' });

  assert.equal(shouldNotify(gate, { settings: {}, context: null }), true);
  assert.equal(shouldNotify(gate, { settings: { notifyRuns: false }, context: null }), false);
  assert.equal(shouldNotify(session, { settings: { notifyRuns: false }, context: null }), true);
  assert.equal(shouldNotify(session, { settings: { notifySessions: false }, context: null }), false);

  // focused on the same run / terminal: nothing; on something else: shown
  assert.equal(shouldNotify(gate, { context: { focused: true, runId: 'r1' } }), false);
  assert.equal(shouldNotify(gate, { context: { focused: true, runId: 'r2' } }), true);
  assert.equal(shouldNotify(gate, { context: { focused: false, runId: 'r1' } }), true);
  assert.equal(shouldNotify(session, { context: { focused: true, terminalId: 't3' } }), false);
  assert.equal(shouldNotify(session, { context: { focused: true, terminalId: 't4' } }), true);
  // a run starting while the focused window shows another run (or none) is announced; not when it shows that run
  assert.equal(shouldNotify(started, { context: { focused: true, runId: 'r0' } }), true);
  assert.equal(shouldNotify(started, { context: { focused: true, runId: null } }), true);
  assert.equal(shouldNotify(started, { context: { focused: true, runId: 'r1' } }), false);
  assert.equal(shouldNotify(null, {}), false);
});

test('spots the attention signals CLIs write to a terminal', () => {
  assert.deepEqual(attentionSignal('\x1b]9;Claude needs your permission to use Bash\x07'), { message: 'Claude needs your permission to use Bash' });
  assert.deepEqual(attentionSignal('x\x1b]777;notify;Codex;Approval requested\x1b\\y'), { message: 'Codex: Approval requested' });
  assert.deepEqual(attentionSignal('done\x07'), { message: '' });
  // a progress bar (OSC 9;4), a window title (OSC 0) and plain text are not
  assert.equal(attentionSignal('\x1b]9;4;1;50\x07'), null);
  assert.equal(attentionSignal('\x1b]0;my title\x07working…'), null);
  assert.equal(attentionSignal('héllo ✓'), null);
});

// A detector on fake timers; returns it with the list of notices it raised.
function detector(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fired = [];
  const d = new WaitDetector({ idleMs: 8000, onWaiting: (id, info, message) => fired.push({ id, title: info.title, message }) });
  d.watch('t1', { title: 'fix the tests' });
  return { d, fired };
}

test('finds the prompt-like line a CLI leaves at the end of its output', () => {
  // Claude's permission prompt, drawn with cursor moves and colors
  const claude = '\x1b[2K\x1b[1G\x1b[1mBash command\x1b[22m\x1b[3;1H  npm test\x1b[5;1H Do you want to proceed?\x1b[6;1H\x1b[36m❯ 1. Yes\x1b[39m\r\n  2. No';
  assert.equal(promptLine(claude), '❯ 1. Yes');
  assert.equal(promptLine('Apply this change? [y/N] '), 'Apply this change? [y/N]');
  assert.equal(promptLine('Which database should I use?\r\n'), 'Which database should I use?');
  assert.equal(promptLine('Done. Tests pass.\r\n╭────╮\r\n│ >  │\r\n╰────╯\r\n  ? for shortcuts'), '? for shortcuts');
  assert.equal(promptLine('I fixed it.\r\n› '), '›');
  assert.equal(promptLine('Press Enter to continue'), 'Press Enter to continue');
  // still working, or just output: not a prompt
  assert.equal(promptLine('Which file?\r\n✻ Running npm test… (12s · esc to interrupt)'), null);
  assert.equal(promptLine('> npm test\r\n  PASS src/a.test.js\r\n  compiling…'), null);
  assert.equal(promptLine(''), null);
});

test('a CLI that goes quiet at a prompt after the user typed is waiting, once per answer', (t) => {
  const { d, fired } = detector(t);
  d.output('t1', 'Do you trust this folder? (y/n)');
  t.mock.timers.tick(20000);
  assert.deepEqual(fired, [], 'nothing before the user typed');

  d.input('t1');
  d.output('t1', 'thinking ⠋');
  t.mock.timers.tick(5000);
  d.output('t1', 'thinking ⠙'); // still working: the spinner keeps writing
  t.mock.timers.tick(5000);
  d.output('t1', '\r\nShould I also update the README?\r\n');
  t.mock.timers.tick(7000);
  assert.deepEqual(fired, []);
  t.mock.timers.tick(1000);
  assert.deepEqual(fired, [{ id: 't1', title: 'fix the tests', message: 'Should I also update the README?' }]);

  d.output('t1', 'redraw after a resize');
  t.mock.timers.tick(20000);
  assert.equal(fired.length, 1, 'not again until the user answers');

  d.input('t1');
  d.output('t1', '\x1b]9;Permission needed\x07');
  assert.deepEqual(fired[1], { id: 't1', title: 'fix the tests', message: 'Permission needed' });
});

test('a CLI that goes quiet with no prompt, like a silent tool call, is still working', (t) => {
  const { d, fired } = detector(t);
  d.input('t1');
  d.output('t1', 'Running the test suite\r\n  npm test\r\n');
  t.mock.timers.tick(60000);
  assert.deepEqual(fired, []);
  // the tool call ends and the CLI shows its empty input box: now it waits
  d.output('t1', 'All 42 tests pass.\r\n│ > │\r\n');
  t.mock.timers.tick(8000);
  assert.deepEqual(fired, [{ id: 't1', title: 'fix the tests', message: '' }]);
});

test('a closed terminal raises nothing', (t) => {
  const { d, fired } = detector(t);
  d.input('t1');
  d.output('t1', 'working');
  d.close('t1');
  t.mock.timers.tick(20000);
  d.output('t1', 'late output');
  d.input('unknown');
  assert.deepEqual(fired, []);
});

// ---- through the service ------------------------------------------------------------------
const WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-notify
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do the work"
  - id: review
    type: human_approval
    message: "Accept the work?"
`;

function makeService(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-ws-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  process.env.MULTIAGENT_SIMULATION_ONLY = '1'; // tests never call real models
  const service = createService({ host: { trashItem: async () => {}, appVersion: '0', isPackaged: false } });
  t.after(() => service.shutdown());
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-notify.yaml'), WORKFLOW);
  const shown = [];
  service.events.on('notify', (n) => shown.push(n));
  return { service, api: service.api, shown };
}

// Runs the fixture workflow to its end, approving its gate.
function runToEnd(service, api) {
  const finished = new Promise((resolve) => service.events.on('run:event', (ev) => {
    if (ev.type === 'approval.requested') setImmediate(() => api['approval:resolve']({ id: ev.approval_id, answer: true }));
    if (ev.type === 'workflow.finished') setImmediate(resolve);
  }));
  return api['run:start']({ file: 'fixture-notify.yaml', inputs: {}, mock: true }).then(async (r) => { await finished; return r; });
}

test('the service notifies a run starting, waiting at its gate and succeeding', async (t) => {
  const { service, api, shown } = makeService(t);
  const { runId } = await runToEnd(service, api);
  assert.deepEqual(shown.map((n) => n.title), ['Run started: fixture-notify', 'Waiting for you: fixture-notify', 'Run succeeded: fixture-notify']);
  assert.ok(shown.every((n) => n.kind === 'run' && n.target.runId === runId));
  assert.equal(shown[1].body, 'Project: none (simulation)\nAccept the work?');
  // the run ended: nothing left to report at the next start
  assert.equal(service.notifyInterruptedRun(), null);
});

test('the service stays quiet when run notifications are off, or about the run the focused window shows', async (t) => {
  const { service, api, shown } = makeService(t);
  api['settings:set']({ notifyRuns: false });
  await runToEnd(service, api);
  assert.deepEqual(shown, []);

  api['settings:set']({ notifyRuns: true });
  let focusedOn = null;
  service.events.on('run:event', (ev) => {
    if (ev.type === 'workflow.started' && !focusedOn) { focusedOn = ev.run_id; service.notifications['notify:context']({ focused: true, runId: ev.run_id }); }
  });
  await runToEnd(service, api);
  assert.deepEqual(shown, []);
});

test('a run that died with the app is notified as interrupted at the next start', async (t) => {
  const { service, api, shown } = makeService(t);
  const ws = service.workspace();
  const { runId } = await runToEnd(service, api);
  shown.length = 0;
  // the app closed in the middle of this run: no summary, its marker still there
  fs.rmSync(path.join(ws.runs, runId, 'summary.json'));
  fs.writeFileSync(ws.activeRun, JSON.stringify({ runId, workflow: 'fixture-notify', project: null, mock: true }));

  const notice = service.notifyInterruptedRun();
  assert.equal(notice.title, 'Run interrupted: fixture-notify');
  assert.deepEqual(shown.map((n) => n.title), ['Run interrupted: fixture-notify']);
  assert.equal(fs.existsSync(ws.activeRun), false);
  assert.equal(service.notifyInterruptedRun(), null, 'only once');
});

test('concurrent runs that died with the app are each notified as interrupted', async (t) => {
  const { service, api, shown } = makeService(t);
  const ws = service.workspace();
  const a = await runToEnd(service, api);
  const b = await runToEnd(service, api);
  shown.length = 0;
  for (const r of [a, b]) fs.rmSync(path.join(ws.runs, r.runId, 'summary.json'));
  fs.writeFileSync(ws.activeRun, JSON.stringify([a, b].map((r) => ({ runId: r.runId, workflow: 'fixture-notify', project: null, mock: true }))));

  assert.equal(service.notifyInterruptedRun().target.runId, a.runId);
  assert.deepEqual(shown.map((n) => n.target.runId), [a.runId, b.runId]);
  assert.equal(fs.existsSync(ws.activeRun), false);
});
