// #129: image attachments on agent turns. Unit tests for the per-CLI prompt contract
// (src/engine/providers.js: checkAttachments, storeAttachments, cliInvocation, imageInput) and
// integration tests for how a run collects and routes them (src/engine/workflow.js: input
// attachments, the attachments_unsupported warning, resolveApproval's gate feedback images).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ATTACHMENT_LIMITS,
  checkAttachments,
  cliInvocation,
  imageInput,
  storeAttachments,
} = require('../src/engine/providers');
const { WorkflowRun, render } = require('../src/engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';
const root = path.join(__dirname, '..');

// A valid, minimal 1x1 PNG (its first 8 bytes are the real PNG signature sniffImage checks).
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function writePng(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG_1PX);
  return file;
}

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---------------------------------------------------------------------------
// checkAttachments / storeAttachments: the limits, checked before anything is spawned.
// ---------------------------------------------------------------------------

test('checkAttachments resolves relative paths and defaults the name to the file\'s basename', (t) => {
  const dir = tmpDir(t, 'img-check-');
  const file = writePng(path.join(dir, 'shot.png'));
  const relative = path.relative(process.cwd(), file);
  const [a] = checkAttachments([relative]);
  assert.equal(a.path, file);
  assert.equal(a.name, 'shot.png');
});

test('checkAttachments refuses more than 10 images per turn', (t) => {
  const dir = tmpDir(t, 'img-count-');
  const files = Array.from({ length: 11 }, (_, i) => writePng(path.join(dir, `s${i}.png`)));
  assert.throws(() => checkAttachments(files), /Too many attached images: 11 \(at most 10 per turn\)\./);
  assert.doesNotThrow(() => checkAttachments(files.slice(0, 10)));
});

test('checkAttachments refuses a file type that is not PNG/JPEG/GIF/WebP, naming the file', (t) => {
  const dir = tmpDir(t, 'img-type-');
  const file = path.join(dir, 'notes.txt');
  fs.writeFileSync(file, 'plain text');
  assert.throws(() => checkAttachments([file]), /Attached file "notes\.txt" is not a supported image: only PNG, JPEG, GIF and WebP files can be attached\./);
});

test('checkAttachments refuses a file whose content does not match its image extension', (t) => {
  const dir = tmpDir(t, 'img-sniff-');
  const file = path.join(dir, 'fake.png');
  fs.writeFileSync(file, 'this is not actually a png');
  assert.throws(() => checkAttachments([file]), /Attached file "fake\.png" is not a valid PNG image/);
});

test('checkAttachments refuses an image over the per-file size limit, naming the file and the limit', (t) => {
  const dir = tmpDir(t, 'img-size-');
  const file = path.join(dir, 'big.png');
  fs.writeFileSync(file, Buffer.alloc(ATTACHMENT_LIMITS.bytes + 1024 * 1024));
  assert.throws(() => checkAttachments([file]), /Attached image "big\.png" is 11\.0 MB: the limit is 10\.0 MB per image\./);
});

test('checkAttachments refuses a path that does not exist, naming the file', (t) => {
  const dir = tmpDir(t, 'img-missing-');
  const missing = path.join(dir, 'ghost.png');
  assert.throws(() => checkAttachments([missing]), /Attached image "ghost\.png" was not found/);
});

test('storeAttachments copies checked images into the given folder, de-duplicating same-named files', (t) => {
  const src = tmpDir(t, 'img-src-');
  const dest = path.join(tmpDir(t, 'img-dest-'), 'attachments', 'task');
  const a = writePng(path.join(src, 'a', 'shot.png'));
  const b = writePng(path.join(src, 'b', 'shot.png'));
  const stored = storeAttachments([a, b], dest);
  assert.equal(stored.length, 2);
  assert.equal(stored[0].path, path.join(dest, 'shot.png'));
  assert.equal(stored[1].path, path.join(dest, 'shot-2.png'));
  assert.ok(fs.existsSync(stored[0].path) && fs.existsSync(stored[1].path));
  // originals untouched, copies survive even if the sources are removed later
  assert.ok(fs.existsSync(a) && fs.existsSync(b));
});

// ---------------------------------------------------------------------------
// imageInput: how each provider type opens attached images, per #129's confirmation task.
// ---------------------------------------------------------------------------

test('imageInput: Claude Code reads attachments, the mock records them; Codex and Grok have no confirmed way yet', () => {
  assert.equal(imageInput('claude-code'), 'read');
  assert.equal(imageInput('mock'), 'record');
  assert.equal(imageInput('codex-cli'), null, 'off until a real codex exec --image call confirms it');
  assert.equal(imageInput('grok-cli'), null);
});

// ---------------------------------------------------------------------------
// cliInvocation: the per-CLI arguments and the "Attached images" prompt block.
// ---------------------------------------------------------------------------

const CLAUDE_PROVIDER = {
  type: 'claude-code',
  args: ['-p', '--output-format', 'stream-json', '--verbose', '--model', '{{ model }}'],
  resume_args: ['--resume', '{{ session_id }}'],
};
const CODEX_PROVIDER = {
  type: 'codex-cli',
  args: ['exec', '--json', '--skip-git-repo-check', '-m', '{{ model }}'],
  resume_args: ['resume', '{{ session_id }}'],
  stdin_arg: '-',
};
const GROK_PROVIDER = {
  type: 'grok-cli',
  args: ['--output-format', 'streaming-json', '-m', '{{ model }}'],
  resume_args: ['--resume', '{{ session_id }}'],
  prompt_file_arg: ['--prompt-file', '{{ prompt_file }}'],
};

test('cliInvocation: without attachments, the args and prompt are exactly the provider\'s own, for every provider', () => {
  const base = { model: 'm1', effort: null, providerSessionId: null, prompt: 'Do the thing.', extraArgs: ['--tools', 'Read,Glob'], render };

  const claude = cliInvocation({ ...base, provider: CLAUDE_PROVIDER });
  assert.deepEqual(claude.args, ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'm1', '--tools', 'Read,Glob']);
  assert.equal(claude.prompt, 'Do the thing.');
  assert.equal(claude.promptFile, null);

  const codex = cliInvocation({ ...base, provider: CODEX_PROVIDER });
  assert.deepEqual(codex.args, ['exec', '--json', '--skip-git-repo-check', '-m', 'm1', '--tools', 'Read,Glob', '-']);
  assert.equal(codex.prompt, 'Do the thing.');
  assert.equal(codex.promptFile, null);

  const grok = cliInvocation({ ...base, provider: GROK_PROVIDER });
  assert.equal(grok.args[grok.args.length - 2], '--prompt-file');
  assert.match(grok.args[grok.args.length - 1], /multiagent-prompt-.*\.md$/);
  assert.equal(grok.prompt, 'Do the thing.', 'no attachments: the prompt text itself is unchanged');
  assert.ok(grok.promptFile);
});

test('cliInvocation: Claude gets --add-dir on each attachment folder and Read added to --tools; the prompt lists the absolute paths', (t) => {
  const dir = tmpDir(t, 'img-claude-');
  const a = writePng(path.join(dir, 'a', 'bug.png'));
  const b = writePng(path.join(dir, 'b', 'mock.png'));
  const attachments = [{ name: 'bug.png', path: a }, { name: 'mock.png', path: b }];
  const { args, prompt, promptFile } = cliInvocation({
    provider: CLAUDE_PROVIDER, model: 'm1', effort: null, providerSessionId: null,
    prompt: 'Review this.', extraArgs: ['--tools', 'Glob,Grep,Bash'], render, attachments,
  });
  const addDirAt = (dirArg) => args[args.indexOf(dirArg) - 1] === '--add-dir';
  assert.ok(addDirAt(path.dirname(a)), args.join(' '));
  assert.ok(addDirAt(path.dirname(b)), args.join(' '));
  assert.equal(args[args.indexOf('--tools') + 1], 'Glob,Grep,Bash,Read', 'Read is offered even to a read-only agent');
  assert.match(prompt, /^Review this\.\n\n## Attached images\nOpen each one with your Read tool before you start\.\n- bug\.png: .*bug\.png\n- mock\.png: .*mock\.png$/s);
  assert.equal(promptFile, null);
});

test('cliInvocation: Codex gets no --image args while it is not a confirmed image reader; the prompt still lists the paths', (t) => {
  const dir = tmpDir(t, 'img-codex-');
  const a = writePng(path.join(dir, 'one.png'));
  const b = writePng(path.join(dir, 'two.png'));
  const attachments = [{ name: 'one.png', path: a }, { name: 'two.png', path: b }];
  const { args, prompt } = cliInvocation({
    provider: CODEX_PROVIDER, model: 'm1', effort: null, providerSessionId: null,
    prompt: 'Look at these.', extraArgs: [], render, attachments,
  });
  assert.ok(!args.some((x) => String(x).startsWith('--image')), args.join(' '));
  assert.match(prompt, /## Attached images\nOpen each file if you can read images\.\n- one\.png: .*one\.png\n- two\.png: .*two\.png/);
});

test('cliInvocation: Grok Build gets the paths only too, with its own prompt file', (t) => {
  const dir = tmpDir(t, 'img-grok-');
  const a = writePng(path.join(dir, 'shot.png'));
  const { args, prompt, promptFile } = cliInvocation({
    provider: GROK_PROVIDER, model: 'm1', effort: null, providerSessionId: null,
    prompt: 'Look.', extraArgs: [], render, attachments: [{ name: 'shot.png', path: a }],
  });
  assert.ok(!args.some((x) => String(x).startsWith('--image')));
  assert.match(prompt, /## Attached images\nOpen each file if you can read images\.\n- shot\.png: .*shot\.png/);
  assert.ok(promptFile);
});

// ---------------------------------------------------------------------------
// Integration: images attached to a workflow input (src/engine/workflow.js).
// ---------------------------------------------------------------------------

test('images attached to separate workflow inputs are checked individually and together: either over 10 throws before the run starts, even though a single turn stays within the per-turn limit', (t) => {
  const dir = tmpDir(t, 'img-combined-');
  const make = (n, sub) => Array.from({ length: n }, (_, i) => writePng(path.join(dir, sub, `${i}.png`)));
  const request = make(6, 'request');
  const related = make(6, 'related');

  assert.throws(() => new WorkflowRun({
    file: path.join(root, 'workflows', 'issue-tracker.yaml'),
    inputs: { request: 'x', project_path: root },
    mock: true,
    runsDir: path.join(dir, 'runs1'),
    attachments: { request, related },
  }), /Too many attached images: 12 \(at most 10 per turn\)\./);

  // each input alone (6 images) stays within the limit
  assert.doesNotThrow(() => new WorkflowRun({
    file: path.join(root, 'workflows', 'issue-tracker.yaml'),
    inputs: { request: 'x', project_path: root },
    mock: true,
    runsDir: path.join(dir, 'runs2'),
    attachments: { request },
  }));
});

test('images attached to an input that does not exist on the workflow are refused', (t) => {
  const dir = tmpDir(t, 'img-badinput-');
  const png = writePng(path.join(dir, 'a.png'));
  assert.throws(() => new WorkflowRun({
    file: path.join(root, 'workflows', 'issue-tracker.yaml'),
    inputs: { request: 'x', project_path: root },
    mock: true,
    runsDir: path.join(dir, 'runs'),
    attachments: { not_an_input: [png] },
  }), /Images are attached to "not_an_input", which is not an input of this workflow\./);
});

test('a mock run of issue-tracker with an image attached to an input copies it into <run_dir>/attachments/<input>/ and gives it to every step whose prompt uses that input', { timeout: 60000 }, async (t) => {
  const dir = tmpDir(t, 'img-run-');
  const png = writePng(path.join(dir, 'bug.png'));
  const run = new WorkflowRun({
    file: path.join(root, 'workflows', 'issue-tracker.yaml'),
    inputs: { request: 'The run chat hides the gate when the window is small', project_path: root },
    mock: true,
    runsDir: path.join(dir, 'runs'),
    attachments: { request: [png] },
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices[0].id, 'user'));
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  const started = events.find((e) => e.type === 'workflow.started');
  assert.equal(started.attachments.request.length, 1);
  const storedPath = started.attachments.request[0].path;
  assert.ok(fs.existsSync(storedPath), 'the copy survives in the run folder');
  assert.ok(storedPath.startsWith(path.join(run.runDir, 'attachments', 'request')), storedPath);

  for (const stepId of ['analyze', 'write']) {
    const sent = events.find((e) => e.type === 'session.message_sent' && e.step_id === stepId);
    assert.equal(sent.attachments?.length, 1, stepId);
    assert.equal(sent.attachments[0].path, storedPath, stepId);
  }
});

// ---------------------------------------------------------------------------
// Integration: images pasted into a resume instruction (#130, src/engine/workflow.js resume.images).
// ---------------------------------------------------------------------------

test('resume: an invalid image in resume.images throws when the run is constructed, before anything starts', (t) => {
  const dir = tmpDir(t, 'img-resume-bad-');
  const invalid = path.join(dir, 'notes.txt');
  fs.writeFileSync(invalid, 'not an image');
  assert.throws(() => new WorkflowRun({
    file: path.join(root, 'workflows', 'issue-tracker.yaml'),
    inputs: { request: 'x', project_path: root },
    mock: true,
    runsDir: path.join(dir, 'runs'),
    resume: { runId: 'prev-run', fromStep: 'analyze', steps: {}, sessions: {}, handoffs: {}, images: [invalid] },
  }), /is not a supported image/);
});

test('resume: an image pasted into the instruction is copied into <run_dir>/attachments/<step>-instruction/ and reaches the first resumed agent step', { timeout: 30000 }, async (t) => {
  const dir = tmpDir(t, 'img-resume-');
  const png = writePng(path.join(dir, 'shot.png'));
  const run = new WorkflowRun({
    file: path.join(root, 'workflows', 'issue-tracker.yaml'),
    inputs: { request: 'x', project_path: root },
    mock: true,
    runsDir: path.join(dir, 'runs'),
    resume: { runId: 'prev-run', fromStep: 'analyze', steps: {}, sessions: {}, handoffs: {}, images: [png] },
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') setImmediate(() => run.resolveApproval(ev.approval_id, ev.choices[0].id, 'user'));
  });
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  const sent = events.find((e) => e.type === 'session.message_sent' && e.step_id === 'analyze');
  assert.equal(sent.attachments?.length, 1);
  assert.ok(fs.existsSync(sent.attachments[0].path), 'the copy survives in the run folder');
  assert.ok(sent.attachments[0].path.startsWith(path.join(run.runDir, 'attachments', 'analyze-instruction')), sent.attachments[0].path);

  const next = events.find((e) => e.type === 'session.message_sent' && e.step_id === 'write');
  assert.equal(next?.attachments?.length ?? 0, 0, 'only the first resumed step gets the instruction\'s images');
});

test('attachments_unsupported: a provider that cannot read images gets one warning per step and agent, and the step still succeeds', { timeout: 30000 }, async (t) => {
  const dir = tmpDir(t, 'img-unsupported-');
  const png = writePng(path.join(dir, 'bug.png'));
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, [
    'apiVersion: multiagent/v1',
    'kind: Workflow',
    'metadata: { name: fixture-image-unsupported }',
    'inputs:',
    '  task: { type: string, required: true }',
    'providers:',
    '  codex: { type: codex-cli, command: codex, args: ["exec", "--json", "-m", "{{ model }}"] }',
    'agents:',
    '  worker: { provider: codex, model: mock-model, session: persistent, capabilities: { tools: [read] } }',
    'steps:',
    '  - id: work',
    '    agent: worker',
    '    prompt: "Task: {{ inputs.task }}"',
    '    loop: { interval: 1ms, max_duration: 5s }',
    '    output_schema:',
    '      type: object',
    '      required: [status]',
    '      properties:',
    '        status: { type: string, enum: [pending, done] }',
    '    transitions:',
    '      - when: "output.status == \'done\'"',
    '        goto: end',
    '      - when: "output.status == \'pending\'"',
    '        goto: work',
  ].join('\n'));
  const run = new WorkflowRun({
    file, inputs: { task: 'investigate the bug' }, mock: true, runsDir: path.join(dir, 'runs'),
    attachments: { task: [png] },
    mockSequences: { status: ['pending', 'done'] },
  });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  const warnings = events.filter((e) => e.type === 'log' && e.kind === 'attachments_unsupported');
  assert.equal(warnings.length, 1, 'one warning despite two visits of the looping step (same step and agent)');
  assert.equal(warnings[0].step_id, 'work');
  assert.equal(warnings[0].agent, 'worker');
  assert.equal(warnings[0].provider, 'codex-cli');
  assert.match(warnings[0].message, /codex-cli cannot open attached images; it only gets their paths \(bug\.png\)/);
});

// ---------------------------------------------------------------------------
// Integration: resolveApproval's gate feedback images (src/engine/workflow.js).
// ---------------------------------------------------------------------------

test('resolveApproval: a failed copy or an invalid image leaves the gate open to answer again; a later valid call still resolves it', { timeout: 30000 }, async (t) => {
  const dir = tmpDir(t, 'img-gate-');
  const png = writePng(path.join(dir, 'shot.png'));
  const invalid = path.join(dir, 'notes.txt');
  fs.writeFileSync(invalid, 'not an image');

  const run = new WorkflowRun({
    file: path.join(root, 'test', 'fixtures', 'loop-goal.yaml'),
    inputs: { repo_path: root },
    mock: true,
    runsDir: path.join(dir, 'runs'),
  });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  const gateReady = new Promise((resolve) => {
    run.on('event', function onEvent(ev) {
      if (ev.type === 'approval.requested') { run.off('event', onEvent); resolve(ev.approval_id); }
    });
  });
  const started = run.start();

  const approvalId = await gateReady;
  assert.ok(run.approvals.has(approvalId));

  // an invalid attachment throws before the approval is taken
  assert.throws(() => run.resolveApproval(approvalId, 'proceed', 'user', '', null, [invalid]), /is not a supported image/);
  assert.ok(run.approvals.has(approvalId), 'still open after an invalid image');

  // a copy failure (e.g. an unwritable run folder) throws too, and leaves the gate open
  const realCopy = run.copyAttachments.bind(run);
  run.copyAttachments = () => { throw new Error('simulated copy failure'); };
  assert.throws(() => run.resolveApproval(approvalId, 'proceed', 'user', '', null, [png]), /simulated copy failure/);
  assert.ok(run.approvals.has(approvalId), 'still open after a failed copy');
  run.copyAttachments = realCopy;

  // a later call with a valid image resolves the gate
  assert.equal(run.resolveApproval(approvalId, 'proceed', 'user', '', null, [png]), true);
  assert.ok(!run.approvals.has(approvalId));

  const resolved = events.find((e) => e.type === 'approval.resolved' && e.approval_id === approvalId);
  assert.equal(resolved.attachments.length, 1);
  assert.ok(fs.existsSync(resolved.attachments[0].path));

  await started;
});
