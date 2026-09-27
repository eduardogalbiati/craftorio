# Multiagent Orchestrator

App Electron que executa workflows multi-agente definidos em YAML (`workflows/`),
abrindo sessões de **Claude Code** e **Codex CLI** e registrando a observabilidade
de cada sessão (tempo aberta/ativa, tokens, custo, prompts, thinking, tool calls, output).

## Rodando

```bash
npm install
npm start
```

Deixe **Modo simulação** marcado para testar o fluxo sem chamar as CLIs.

Recomendado: Node 24 LTS (o build também roda em Node antigo, usando o Node embutido no Electron).

Pelo terminal (sem UI):

```bash
npm test
```

Roda os testes unitários (`test/`, node:test) e o fluxo completo em modo mock. É o que o CI usa.

```bash
npm run run -- --task "Descrição da tarefa" --repo C:/caminho/do/repo
```

Roda o workflow de verdade. `--auto-approve` aprova todos os portões humanos sem interação
(só para testes: na prática a IA não deve ultrapassar os portões).

Build local: `npm run build` (gera `build/`) ou `npm run package` (gera `dist/`, usado no deploy).

## Fluxo (Feature Workflow Agents)

| Etapa | Agente | Modelo | O que faz |
|---|---|---|---|
| Build & Test | Developer | Opus 5.5 | Implementa e corrige tudo que os outros agentes apontam |
| | Code Review | Codex gpt-6-luna | Revisa o diff; pede mudanças só para blocker/major |
| | Test Writer | Sonnet 5 | Escreve/atualiza testes e roda `npm test`; falhas voltam ao developer |
| | Builder | Sonnet 5 | `npm run build` + `npm audit`; build quebrado ou vulnerabilidade high/critical em produção voltam ao developer |
| CI/CD | CI Pusher | Opus 4.8 | Push, abre o PR, **/goal** CI passando com **/loop**; em falha pega o log e aciona o developer |
| | PR Babysitter | Opus 4.8 | **/goal** PR mergeable com **/loop**; comentários pertinentes → developer (responde no PR com o hash), duvidosos → humano |
| | Deployer | Opus 4.8 | Publica a versão de teste (pre-release `preview-pr-<n>`), e após o merge acompanha o deploy de produção |

Portões humanos: comentário duvidoso no PR (corrigir / justificar / ignorar) e o merge, que
gera a versão de produção. Os agentes nunca falam entre si: o orquestrador (engine) repassa
falhas ao developer e devolve o resultado ao agente que pediu.

`/goal` e `/loop` são declarados por step no YAML (`goal.until`, `loop.interval`,
`loop.max_duration`). O engine repete o step até o objetivo ser atingido e injeta no prompt
do agente as instruções de /goal e /loop (iteração atual, intervalo e limite).

## CI/CD

- `.github/workflows/ci.yml`: em cada PR roda sintaxe, `npm test` e `npm audit` de produção.
- `.github/workflows/preview.yml`: ambiente de teste. Disparado pelo Deployer, publica a
  pre-release `preview-pr-<n>` a partir da branch do PR.
- `.github/workflows/deploy.yml`: produção. Todo push na `main` testa, empacota e publica uma release.

Os agentes de CI/CD usam o GitHub CLI (`gh`), que precisa estar autenticado (`gh auth login`).

## Como as sessões são abertas (sem tmux)

Cada turno de cada agente é um processo headless filho do Electron:

| Provider | Comando | Stream |
|---|---|---|
| Claude Code | `claude -p --output-format stream-json --verbose --model <m>` | thinking, texto, tool_use, `result` com usage/custo |
| Codex CLI | `codex exec --json --skip-git-repo-check -m <m> -` | reasoning, agent_message, command_execution, `turn.completed` com usage |

- O prompt é enviado via **stdin** (evita problemas de escape no `cmd.exe`).
- Sessões `persistent` são retomadas com o `session_id` devolvido pelo provider
  (`--resume <id>` / `codex exec ... resume <id>`).
- As linhas de comando ficam em `providers:` no YAML e podem ser ajustadas sem mexer no código.

## Instalando as CLIs no Windows

Claude Code (instalador nativo, PowerShell):

```powershell
irm https://claude.ai/install.ps1 | iex
```

Codex CLI:

```bash
npm install -g @openai/codex
```

Depois faça login uma vez em cada uma, de forma interativa (`claude` e `codex login`).
O app mostra na barra lateral se encontrou cada comando no PATH.

## Observabilidade

Cada run grava em `runs/<run_id>/`:

- `events.jsonl`: todos os eventos (step, transição, sessão, aprovação…)
- `sessions/<id>.jsonl`: eventos de cada sessão (prompts, thinking, tools, output)
- `summary.json`: métricas finais por sessão (duração, ativa, ociosa, tokens, custo)

Observações:
- O Claude Code reporta custo; o Codex não, então o custo das sessões Codex aparece vazio.
- A API da Anthropic conta os tokens de thinking dentro de `output`; `reasoning` só é separado no Codex.

## Estrutura

```
src/main.js              processo principal do Electron + IPC
src/preload.js           API segura exposta ao renderer
src/engine/workflow.js   engine que executa o grafo do YAML
src/engine/providers.js  adapters claude / codex / mock
src/engine/recorder.js   gravação em disco (jsonl + summary)
src/renderer/            UI (HTML/CSS/JS puro)
.github/workflows/       CI (PRs) e deploy (merge na main)
workflows/               definições de workflow
scripts/                 runner de terminal, testes, build e smoke test da UI
test/                    testes unitários (node:test) e fixtures
```
