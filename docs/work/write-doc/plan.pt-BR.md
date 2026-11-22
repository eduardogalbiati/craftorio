---
item: write-doc
issue: "#636 (phases 0 and 1)"
stage: build
scope: phase 0 (spike) and phase 1 (MVP); phases 2–5 get their own plan.md
status: accepted          # accepted by the owner (engineer / tech lead) on 2026-10-31
spec: spec.md (signed off)
date: 2026-10-31
source: plan.md (English)
---

# Plan: write doc, fases 0 e 1

Escopo: a fase 0 (o editor sobre o protótipo do leitor) e a fase 1 (MVP, R1–R13 para intent e spec, com um writer). Fica para as fases seguintes, cada uma com o seu plano:
- o modo Arena e a reorganização do Planning (R14): fase 2;
- a captura pelo comando do próprio projeto ou pelo Run App, e o "Write a document" no card do Discovery: fase 3;
- o documento vivo no Build, Test e Deploy (R16): fase 4;
- o Maintain a partir do Monitor, e um front para navegar pelos intents: fase 5.

**Pré-requisito:** o contrato do leitor de documentos (R4). Ele renderiza um `.md` num iframe e informa, por `postMessage`, as linhas de origem de cada bloco e a seleção. Vem do trabalho do próprio leitor, fora deste item.

## Arquivos que mudam

**Novos**
- `packages/shared/doc-model.js`: a carga da seleção (arquivo, âncora, linhas, trecho, contexto), o alinhamento da tradução por bloco e o lint do markdown (front matter, seções do playbook, R1…, `**Recommended:**`, imagens). Puro, dual-load.
- `fronts/plan/views/docs/docs.js` e `docs.css`: a tela Documents (itens e etapas, New item).
- `fronts/plan/views/docs/doc-editor.js`: o editor (o iframe do leitor, as etapas, o índice, o chat, o chip de seleção, as marcas de mudança, a fila de não revisadas).
- `fronts/plan/engine/channels/docs.js` e `fronts/plan/engine/domains/docs.js`: listam o `docs/work/`, leem os runs em andamento, trocam as linhas de uma seção na fonte e na tradução, e commitam cada pedido no worktree do run.
- O passo `human_edit` do engine: um gate que aceita pedidos enquanto espera; cada pedido é um turno do agente indicado; só a pessoa o encerra. Entra na lista de gates protegidos.
- `workflows/write-doc.yaml`: evidências → rascunho → `human_edit` → revisão → `human_approval`, para o `intent.md` ou o `spec.md`.
- `skills/intent-writing/SKILL.md` e `skills/spec-writing/SKILL.md`, com as rubricas.
- `scripts/screenshot/views/docs.js` e `features/docs.feature`.
- `poc/doc-editor.html` (fase 0).
- Testes em `fronts/plan/test/` e `packages/engine/test/`.

**Alterados**
- `packages/ui-kit/agent-chat.js`: o chip de seleção e as imagens coladas num pedido.
- `apps/desktop/host/main.js` e `window-guards.js`: o protocolo `doc://`, origem opaca, sem rede.
- `fronts/plan/views/duo` e `arena`: continuam no menu até a fase 2.
- `packages/shared/i18n/*`: as chaves `docs.*`.
- Docs: `docs/agents/renderer/documents.md`, `docs/agents/engine/gates-and-run-end.md` (`human_edit`) e as decisões assinadas em `docs/agents/decisions.md`.

## Ordem do trabalho

1. **Fase 0, o spike:** `poc/doc-editor.html` abre o exemplo do onboarding no protótipo do leitor, com um chat falso. Uma seleção, na fonte ou na tradução, gera a carga certa. Sem modelo.
2. **`doc-model.js` e os testes:** a carga, o alinhamento (com o plano B da seção inteira) e o lint.
3. **`human_edit` no engine:** o gate, os turnos, a lista protegida e os testes (nenhuma automação responde; um run retomado volta ao gate).
4. **`write-doc.yaml` e as duas skills,** com cenários do provedor mock para o rascunho, as edições e a revisão.
5. **O serviço:** listar, trocar linhas, um commit por pedido (fonte + tradução), a fila de não revisadas e o undo.
6. **O editor na UI:** o iframe do leitor, o chip de seleção, o chat com imagens coladas, as mudanças por pedido e as notas do reviewer.
7. **Os portões:** Accept intent / Sign off spec mudam o front matter e commitam; "Create epic and phase issues" e "Start the Build" viram propostas que esperam o clique do dono.
8. **A tela Documents, o seed de screenshot, a feature E2E, o i18n e os docs.**

## Fase 2 (#648): os nomes antigos

- `writer-reviewer` e `ai-arena` resolvem para `write-doc`, `issue-tracker` para `issue`; `rfc-to-issues` e `enrich-save-develop` para `spec-to-issues` e `enrich-issue`.
- Os inputs antigos não migram (aceito na assinatura): um estágio de roadmap salvo ou um manifest que roda `writer-reviewer` ou `ai-arena` com os inputs antigos (`prompt`, `goal`) resolve para `write-doc` e para no início com "Required input not provided: item". O dono dá ao estágio um `item` (e um `document`) uma vez.

## Riscos

- **O contrato do leitor muda:** o editor só conversa com ele por mensagens de `postMessage`, com um teste de contrato dos dois lados.
- **Um gate que nunca termina:** o `human_edit` guarda o estado no run; fechar o app volta ao mesmo gate, com o histórico do chat.
- **A tradução se descolar da fonte:** cada pedido atualiza a fonte e a tradução no mesmo commit; o lint compara os títulos e as âncoras do par.
- **Custo inesperado:** no simulado nada chama modelo (`CRAFTORIO_SIMULATION_ONLY=1`); no real, cada ação mostra a estimativa antes.
- **Escritas fora do run:** um passo de máquina recusa mudanças fora de `docs/work/<item>/`.

## Prova

- **Unitários:**
  - `doc-model` (a carga, o alinhamento e o plano B, o lint);
  - `human_edit` (pedidos viram turnos; só a pessoa encerra; retomada);
  - um commit por pedido e o undo.
- **E2E (`features/docs.feature`, no simulado):** New item → rascunho do intent → uma seleção e um pedido → a mudança mostrada por pedido → revisão → Accept intent; depois o spec até o Sign off.
- **Screenshots:** `npm run screenshot -- --view docs --mode <list|editor|changes|review|sign-off>`, com as checagens do axe.
- **Nenhum run real** nas checagens; uma sessão real curta só com aviso e consentimento do dono.

## Progresso

Preenchido pelos workflows de Code & Build a cada passo: o run, o commit e o PR (no modo remoto) ou o merge local. Ninguém edita esta tabela à mão.

| Passo | Status | Run | Commit / PR |
|---|---|---|---|
| 1. Spike da fase 0 | pendente | — | — |
| 2. `doc-model.js` e testes | pendente | — | — |
| 3. `human_edit` no engine | pendente | — | — |
| 4. `write-doc.yaml` e skills | pendente | — | — |
| 5. Serviço: linhas, commits, fila | pendente | — | — |
| 6. Editor na UI | pendente | — | — |
| 7. Os portões do SDLC | pendente | — | — |
| 8. Tela, seed, E2E, i18n, docs | pendente | — | — |
