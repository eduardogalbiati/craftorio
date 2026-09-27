// Executa um workflow pelo terminal (sem Electron).
//
//   node scripts/run.js --task "..." [--repo <path>] [--file <yaml>] [--mock] [--auto-approve] [--input chave=valor]
//
// --auto-approve aprova todos os gates humanos (use com cuidado fora do mock).
// Sai com código 0 se o workflow terminar com sucesso, 1 caso contrário.

const path = require('path');
const { WorkflowRun } = require('../src/engine/workflow');
const { Recorder } = require('../src/engine/recorder');
const { resolveWorkspace, setupWorkspace } = require('../src/workspace');

const root = path.join(__dirname, '..');

function parseArgs(argv) {
  const a = { inputs: {}, mock: false, autoApprove: false, file: 'software-development.yaml' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--mock') a.mock = true;
    else if (k === '--auto-approve') a.autoApprove = true;
    else if (k === '--file') a.file = next();
    else if (k === '--task') a.inputs.task = next();
    else if (k === '--repo') a.inputs.repo_path = next();
    else if (k === '--input') { const [key, ...v] = next().split('='); a.inputs[key] = v.join('='); }
    else throw new Error(`Argumento desconhecido: ${k}`);
  }
  a.inputs.repo_path ??= root;
  return a;
}

const args = parseArgs(process.argv.slice(2));
// Mesmo workspace do app (MULTIAGENT_WORKSPACE > caminho registrado > ~/multiagent-workspace).
// Sem terminal interativo, cria a pasta padrão se nenhuma existir.
const found = resolveWorkspace();
const ws = setupWorkspace(found.dir || found.fallback, { persist: found.source !== 'env' });
const run = new WorkflowRun({
  file: path.isAbsolute(args.file) ? args.file : path.join(root, 'workflows', args.file),
  inputs: args.inputs,
  mock: args.mock,
  runsDir: ws.runs,
});
const rec = new Recorder(run.runDir, run.wf.observability?.capture?.redact);

const t = () => new Date().toLocaleTimeString('pt-BR');
const short = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);

run.on('event', (ev) => {
  rec.write(ev);
  switch (ev.type) {
    case 'step.started': console.log(`${t()} ▶ ${ev.step_id} (visita ${ev.visit})`); break;
    case 'step.finished': console.log(`${t()}   ✓ ${ev.step_id}: ${short(JSON.stringify(ev.output), 300)}`); break;
    case 'step.transition': console.log(`${t()}   → ${ev.to}   [${ev.when}]`); break;
    case 'step.waiting': console.log(`${t()}   ⏳ /loop: próxima verificação em ${Math.round(ev.interval_ms / 1000)}s`); break;
    case 'step.goal': console.log(`${t()}   🎯 /goal ${ev.met ? 'atingido' : 'ainda não atingido'}: ${ev.goal} (iteração ${ev.iteration})`); break;
    case 'session.opened': console.log(`${t()}   + sessão ${ev.session_id} ${ev.session.agent} (${ev.session.provider}/${ev.session.model})`); break;
    case 'session.closed': console.log(`${t()}   - sessão ${ev.session_id} ${ev.status}`); break;
    case 'session.stream':
      if (ev.item.kind === 'tool_call') console.log(`${t()}     [${ev.session_id}] tool ${ev.item.name}: ${short(ev.item.input?.command ?? JSON.stringify(ev.item.input), 120)}`);
      break;
    case 'session.message_received':
      console.log(`${t()}     [${ev.session_id}] turno ${ev.turn} ok em ${Math.round(ev.duration_ms / 1000)}s · in ${ev.usage.input} · cache ${ev.usage.cache_read} · out ${ev.usage.output}${ev.cost_usd != null ? ` · US$ ${ev.cost_usd.toFixed(4)}` : ''}`);
      break;
    case 'action.executed': console.log(`${t()}   $ ${ev.command} → ${ev.skipped ? 'pulado (mock)' : 'exit ' + ev.exit_code}\n${short(ev.output, 400)}`); break;
    case 'approval.requested':
      console.log(`${t()}   ? ${short(ev.message, 200)}${ev.choices ? `  [${ev.choices.map((c) => c.id).join(' | ')}]` : ''}`);
      if (args.autoApprove) {
        // com choices, escolhe a primeira opção
        const answer = ev.choices ? ev.choices[0].id : true;
        console.log(`${t()}     → ${ev.choices ? `escolhido "${answer}"` : 'aprovado'} automaticamente (--auto-approve)`);
        setTimeout(() => run.resolveApproval(ev.approval_id, answer), 200);
      } else {
        console.log('     aguardando aprovação: use a UI ou rode com --auto-approve');
      }
      break;
    case 'log': console.log(`${t()}   [${ev.level}] ${short(ev.message, 400)}`); break;
    case 'workflow.finished':
      console.log(`\n■ ${ev.status}${ev.error ? ': ' + ev.error : ''}`);
      console.log(`  duração: ${Math.round(ev.summary.duration_ms / 1000)}s · tokens: ${JSON.stringify(ev.summary.tokens)} · custo: US$ ${ev.summary.cost_usd}`);
      console.log(`  run salvo em ${run.runDir}`);
      process.exitCode = ev.status === 'success' ? 0 : 1;
      break;
  }
});

process.on('SIGINT', () => run.stop());
run.start();
