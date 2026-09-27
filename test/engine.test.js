const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowRun, loadWorkflow, extractJson, validateSchema, evalExpr } = require('../src/engine/workflow');

process.env.MULTIAGENT_MOCK_DELAY_SCALE = '0.05';
const root = path.join(__dirname, '..');

test('extractJson pega o último bloco ```json da resposta', () => {
  const text = 'antes\n```json\n{"a":1}\n```\nmeio\n```json\n{"a":2}\n```\nfim';
  assert.deepEqual(extractJson(text), { a: 2 });
});

test('extractJson aceita JSON solto e falha sem JSON', () => {
  assert.deepEqual(extractJson('resultado: {"ok": true}'), { ok: true });
  assert.throws(() => extractJson('sem json aqui'), /Nenhum bloco JSON/);
});

test('validateSchema aponta tipo, enum e campos obrigatórios', () => {
  const schema = {
    type: 'object',
    required: ['state', 'n'],
    properties: { state: { type: 'string', enum: ['a', 'b'] }, n: { type: 'integer' } },
  };
  assert.deepEqual(validateSchema({ state: 'a', n: 1 }, schema), []);
  const errs = validateSchema({ state: 'x', n: 1.5 }, schema);
  assert.equal(errs.length, 2);
  assert.match(errs.join(), /fora de/);
  assert.match(validateSchema({}, schema).join(), /state: obrigatório/);
});

test('evalExpr avalia comparações, in e and', () => {
  assert.equal(evalExpr("output.state in ['merged','closed']", { output: { state: 'merged' } }), true);
  assert.equal(evalExpr("output.state in ['merged','closed']", { output: { state: 'open' } }), false);
  assert.equal(evalExpr('output.ok and output.n == 0', { output: { ok: true, n: 0 } }), true);
});

test('todos os workflows em workflows/ são válidos', () => {
  for (const f of fs.readdirSync(path.join(root, 'workflows'))) {
    assert.doesNotThrow(() => loadWorkflow(path.join(root, 'workflows', f)), f);
  }
});

test('loadWorkflow rejeita transição para step inexistente', () => {
  const tmp = path.join(os.tmpdir(), `wf-invalido-${process.pid}.yaml`);
  fs.writeFileSync(tmp, 'agents: { a: { provider: claude, model: m } }\nsteps:\n  - id: s1\n    agent: a\n    transitions:\n      - { when: "true", goto: nao_existe }\n');
  try {
    assert.throws(() => loadWorkflow(tmp), /inexistente "nao_existe"/);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('/goal + /loop: repete o step, delega a falha e repassa o resultado', { timeout: 60000 }, async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  const run = new WorkflowRun({
    file: path.join(__dirname, 'fixtures', 'loop-goal.yaml'),
    inputs: { repo_path: root },
    mock: true,
    runsDir,
  });
  const events = [];
  run.on('event', (ev) => {
    events.push(ev);
    if (ev.type === 'approval.requested') {
      assert.deepEqual(ev.choices.map((c) => c.id), ['seguir', 'parar']);
      setImmediate(() => run.resolveApproval(ev.approval_id, 'seguir'));
    }
  });
  await run.start();

  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);

  // pending → failed → pending → success: 4 iterações e o goal só é atingido na última
  const goals = events.filter((e) => e.type === 'step.goal').map((e) => e.met);
  assert.deepEqual(goals, [false, false, false, true]);
  assert.ok(events.some((e) => e.type === 'step.goal' && /CI verde no run \d{8}/.test(e.goal)), 'descrição do goal renderizada');

  const prompts = events.filter((e) => e.type === 'session.message_sent' && e.step_id === 'ci').map((e) => e.prompt);
  assert.match(prompts[0], /\/goal: CI verde/);
  assert.match(prompts[0], /\/loop: iteração 1/);
  assert.match(prompts[3], /\/loop: iteração 4/);
  // a iteração seguinte à falha recebe o resultado da delegação ao dev
  assert.match(prompts[2], /DELEGATE:dev/);
  assert.doesNotMatch(prompts[3], /DELEGATE/);

  const resolved = events.find((e) => e.type === 'approval.resolved');
  assert.equal(resolved.choice, 'seguir');
  // espera o intervalo do /loop também após a delegação (o CI precisa reiniciar)
  assert.equal(events.filter((e) => e.type === 'step.waiting').length, 3);
});
