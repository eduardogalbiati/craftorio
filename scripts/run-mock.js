// Executa o workflow em modo mock no terminal (sem Electron), aprovando tudo.
// Uso: npm run test:engine

const path = require('path');
const { WorkflowRun } = require('../src/engine/workflow');
const { Recorder } = require('../src/engine/recorder');

const root = path.join(__dirname, '..');
const run = new WorkflowRun({
  file: path.join(root, 'workflows', 'software-development.yaml'),
  inputs: { task: 'Adicionar endpoint de health check', repo_path: root },
  mock: true,
  runsDir: path.join(root, 'runs'),
});
const rec = new Recorder(run.runDir, run.wf.observability?.capture?.redact);

run.on('event', (ev) => {
  rec.write(ev);
  switch (ev.type) {
    case 'step.started': console.log(`▶ ${ev.step_id} (visita ${ev.visit})`); break;
    case 'step.transition': console.log(`  → ${ev.to}   [${ev.when}]`); break;
    case 'session.opened': console.log(`  + sessão ${ev.session_id} ${ev.session.agent} (${ev.session.provider}/${ev.session.model})`); break;
    case 'session.closed': console.log(`  - sessão ${ev.session_id} ${ev.status}`); break;
    case 'approval.requested':
      console.log(`  ? ${ev.message} → aprovado automaticamente`);
      setTimeout(() => run.resolveApproval(ev.approval_id, true), 200);
      break;
    case 'log': console.log(`  [${ev.level}] ${ev.message}`); break;
    case 'workflow.finished':
      console.log(`\n■ ${ev.status}${ev.error ? ': ' + ev.error : ''}`);
      console.log(`  tokens: ${JSON.stringify(ev.summary.tokens)}  custo: US$ ${ev.summary.cost_usd}`);
      console.log(`  run salvo em ${run.runDir}`);
      break;
  }
});

run.start();
