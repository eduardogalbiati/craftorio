---
item: first-project-onboarding
issue: "#629 (phase 1 of epic #628)"
stage: build
scope: phase 1 (MVP): the wizard with what exists; phases 2–6 get their own plan.md
status: accepted          # accepted by the owner (engineer / tech lead) on 2026-10-31
spec: spec.md (signed off)
date: 2026-10-31
source: plan.md (English)
---

# Plan: onboarding do primeiro projeto, fase 1 (MVP)

Escopo desta fase: R1, R2, R3, R5, R7 (com os workflows de hoje), R10 e R11 (sem "Set up release CI" nem "Investigate screenshots"). Fica para as fases seguintes, cada uma com o seu plano:
- o perfil revisitado (R6) e o conjunto novo de workflows (R8): fase 2;
- o resto da reorganização: fase 3;
- criar novo (R4): fase 4;
- o modelo de trabalho (R9): fase 5;
- o Monitor (R12): fase 6.

## Arquivos que mudam

**Novos**
- `packages/shared/onboarding-model.js`: as etapas, o estado do assistente, as sugestões de fluxo a partir do perfil e a soma do custo. Puro, dual-load.
- `fronts/build/views/projects/project-wizard.js` e `project-wizard.css`: o assistente, a bandeja de progresso e a revisão.
- `packages/engine/service/areas/project-onboarding.js`: os jobs (clone → fatos → perfil ∥ project-map → ranking), o estado por projeto e o Retry.
- `packages/engine/service/channels/onboarding.js`: `onboarding:start`, `onboarding:status`, `onboarding:analyze` e `onboarding:retry`, com os eventos.
- `scripts/screenshot/views/onboarding.js`: o seed de cada etapa e estado (clonando, erro de acesso, analisando, revisão).
- `features/onboarding.feature`: o caminho do Home vazio ao projeto pronto, no simulado.
- Testes em `fronts/build/test/` e `packages/engine/test/`.

**Alterados**
- `packages/engine/domains/project/projects.js`: o clone sai do `createProject` para um job; entram o `status` (`cloning | ready | failed`) e o `checkAccess` (`git ls-remote`).
- `packages/ui-kit/setup.js` e `packages/shared/setup-model.js`: três passos, sem o Workflows; o último abre o assistente.
- `fronts/build/views/projects/projects.js`: New project abre o assistente; o diálogo fica para Edit.
- `fronts/analyser/views/project/project.js`: o cartão "Next steps".
- `packages/engine/service/areas/workflow-interview.js`: o perfil grátis sempre, e o modelo só para os campos nulos.
- `packages/shared/i18n/*`: as chaves `onboarding.*`.
- Docs: `docs/agents/renderer/` (uma página para o assistente), o header de cada arquivo novo, e `docs/agents/decisions.md` com as decisões assinadas.

## Ordem do trabalho

1. **`onboarding-model.js` e os testes dele:** etapas, sugestões pelas regras do R7 (com os workflows de hoje), custo.
2. **Clone em job:** `checkAccess`, o status do projeto, Retry, e os testes com git falso (sem rede).
3. **`project-onboarding.js` e os canais:** o encadeamento, os slots da máquina, os eventos, e os caminhos de erro (sem acesso, sem `gh`/`glab`, clone falhou).
4. **O assistente na UI:** as etapas 1 a 3, a bandeja de progresso, e o custo antes do clique.
5. **A revisão e o "Next steps":** a nota por arquivo no backlog de refatoração; refatorações escolhidas para o roadmap; capturar uma ideia.
6. **O Setup sem o passo Workflows**, abrindo o assistente; Projects › New project abrindo o assistente.
7. **O seed de screenshot, a feature E2E, i18n e os docs.**

## Riscos

- **Corrida entre o clone e as análises:** nenhuma análise começa antes de o clone terminar (testado com um clone lento falso).
- **Projeto meio criado:** se o app fecha durante o clone, ao reabrir ele aparece `failed`, com Retry, nunca como `ready`.
- **Custo inesperado:** em simulação nada chama modelo (`MULTIAGENT_SIMULATION_ONLY=1`); no real, a análise só começa com o clique, e o custo vem do `seeds:estimate`.
- **Setup em workspaces antigos:** `setupDone` existente nunca reabre o Setup; o passo Workflows some sem apagar o `hiddenWorkflows` de ninguém.

## Prova

- **Unit:**
  - `onboarding-model` (sugestões para os perfis local/remote × CI × testes; soma do custo);
  - o clone em job (sucesso, sem acesso, falha e Retry);
  - o encadeamento dos jobs (a ordem e os slots).
- **E2E (`features/onboarding.feature`, simulado):** do Home vazio, import de um repositório de exemplo, etapa 3 com as análises simuladas, revisão com cidade e backlog, Finish, cartão "Next steps".
- **Screenshots:** `npm run screenshot -- --view onboarding --mode <start|repository|cloning|access-error|analysis|review>`, com as checagens do axe.
- **Nenhum run real** nas checagens; uma sessão real curta só com o aviso e o aceite do dono.

## Progresso

Preenchido pelos workflows de Code & Build a cada passo: o run que fez, o commit e o PR (no modo remote) ou o merge local. Ninguém edita esta tabela à mão.

| Passo | Status | Run | Commit / PR |
|---|---|---|---|
| 1. `onboarding-model.js` e testes | concluído | 20261031-143716-3710e990 | d7ba344d, merge local na main |
| 2. Clone em job | concluído | 20261031-145746-8dfe137a | 674ddc38, merge local na main |
| 3. Jobs e canais | pendente | — | — |
| 4. Assistente na UI | pendente | — | — |
| 5. Revisão e Next steps | pendente | — | — |
| 6. Setup e Projects | pendente | — | — |
| 7. Seed, E2E, i18n, docs | pendente | — | — |
