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

Outros scripts:

```bash
npm run test:engine
```

Executa o workflow em modo mock no terminal, aprovando os gates automaticamente.

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
workflows/               definições de workflow
scripts/                 teste do engine e smoke test da UI
```
