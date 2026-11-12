---
item: documentation-agent
issue: "#658"
stage: plan
status: proposed          # proposed → accepted | rejected (product owner)
author: Claude (Code session), from the owner's request
approver: Eduardo Galbiati (product owner)
date: 2026-11-01
depends_on:
  - first-project-onboarding   # phase 2 rebuilds feature / fix / release (#630), phase 5 adds the work model (#633)
  - write-doc                  # intent and spec stay with the write doc flow (#636)
source: intent.md (English)
---

# Intent: agente de documentação

## Problema

Os artefatos do AI-native SDLC em `docs/work/<item>/` só continuam verdadeiros se alguém os atualizar depois de cada run. Hoje isso é uma tarefa manual em cada item do roadmap:
- a linha da `## Progress` do `plan.md`;
- a evidência no `test.md`;
- os campos de release no `deploy.md`;
- a entrada no `CHANGELOG.md`.

Em 2026-11-01 a fase 1 do onboarding do primeiro projeto (#629) mostrou isso: sete runs de Code & Build rodaram a suíte, o E2E e os screenshots, o `test.md` continuou o esqueleto e a página manteve o item em Build, porque um plano aceito não é ponto de avanço e nada marca o plano como construído. As linhas da Progress só saíram certas porque cada issue (#638-#644) deu ao developer a tarefa de escrevê-las, e a evidência não pode vir assim: ela nasce depois do develop.

A página pública (`site/`) lê exatamente esses arquivos: "plan: N of M steps", entregue e lead time, os chips do changelog, os marcos. Arquivo que ninguém atualizou é página errada. E a ideia é que os agentes do dono só façam commit no git, com a página republicada a partir do `main`. Então as atualizações precisam vir dos próprios workflows.

## Resultado esperado

Um **agente de documentação** mantém os documentos de cada item em dia, em tempo real, como um **fluxo posterior fora do Code & Build**: o encadeamento (`then`) o inicia quando um run de Code & Build termina com sucesso, e ele lê as saídas declaradas desse run (branch, commit do merge, PR, os caminhos das evidências) e as registra. Os workflows `feature`, `fix` e `release` nunca leem nem escrevem em `docs/work/` (decisão do dono, 2026-11-01), então todo workflow, inclusive os do usuário, ganha os documentos sem precisar de um passo próprio. Os projetos aderem na hora do cadastro, por uma opção nova no onboarding, **"Add the realtime documentation model"**.

Ele chega em três partes:

1. **Depois dos workflows** (encadeado depois de `feature`, `fix`, `release`):
   - `plan.md`: o front matter (`status`, `date`) e a linha da `## Progress` (Status `done`/`pending`, o run, o commit ou PR), depois de cada run de feature ou fix;
   - `test.md`: uma linha por run (o run, as contagens de unidade e E2E, os screenshots tirados ou por que nenhum foi, os achados do axe), os screenshots finais de antes e depois copiados para `images/`, e `status: collecting`;
   - `deploy.md`: os achados da revisão e, na release, `release:` e `released:` (que a página precisa para entregue e lead time);
   - `CHANGELOG.md` (+ `CHANGELOG.pt-BR.md`) na raiz, no formato Keep a Changelog: o workflow `release` acrescenta cada versão, e um link `docs/work/<item>/` vira o chip do item.
2. **A etapa Test** (junto com a parte 1): quando todas as linhas da Progress estão `done`, o `sdlc-record` põe o `plan.md` em `status: built` e o reader passa o item de Build para Test. Um **workflow de Test** (`sdlc-test`), iniciado pelo Roadmap num item construído (nunca sozinho), roda os gates de qualidade na base integrada:
   - a suíte completa com cobertura e o E2E completo, cada cenário `@visual` com baseline commitado (#696);
   - cada tela do item comparada com o mockup da spec, com a cobertura listada (#670);
   - os evals, no modelo de trabalho Full;
   - depois `status: in review` e um `human_approval` do code owner, que aprova lendo o `test.md`: `passed` leva o item para Deploy, `failed` registra os achados como issues de correção.
3. **Com o modelo de trabalho e o Monitor** (depois da #633, com a #634):
   - `maintain.md`: incidentes e post-mortems;
   - marcos em `docs/work/<nome>/milestone.md` (`kind: milestone`, `expected:`, `reached:`);
   - um intent nascido de um incidente (o `intent.md` de um item novo, com o card no Inbox).

Ele **não escreve `intent.md` nem `spec.md`**. Isso é do fluxo de write doc (#636). Este agente só atualiza o status deles no front matter depois do gate humano.

## Usuários e sistemas afetados

- **Usuários:**
  - o dono e quem lê a página pública, que veem o progresso verdadeiro sem ninguém editar arquivos à mão;
  - os contribuidores, que acham o estado de cada item no repositório.
- **Sistemas:**
  - os workflows `feature`, `fix` e `release`: sem mudança, a não ser uma saída `evidence` que declaram para o fluxo posterior;
  - o encadeamento (`then`), que precisa de um padrão por projeto ou item do roadmap para o fluxo posterior começar sozinho;
  - um workflow `sdlc-test` novo e o gate do code owner;
  - as etapas do reader (`built` passa de Build para Test);
  - o assistente de onboarding (uma opção nova no cadastro do projeto);
  - o modelo de trabalho (#633) e o Monitor (#634);
  - o `docs/work/CONVENTIONS.md`, que o agente segue;
  - a página pública, que lê o que ele escreve.

## Restrições

- **Regras do AGENTS.md:**
  - o app em inglês;
  - os agentes rodam sem supervisão;
  - nenhuma automação atravessa um `human_approval`;
  - checagens só em simulação.
- Os testes dele usam fixtures, nunca um documento vivo em `docs/work/` (#695); um commit só de docs não roda testes, então o próprio fluxo posterior roda o lint do documento.
- Segue o `docs/work/CONVENTIONS.md`: primeiro o arquivo em inglês, depois a tradução `.pt-BR.md` ao lado.
- Escreve no repositório do usuário só como um run próprio, mesclado do jeito que o projeto trabalha (local ou PR), nunca dentro de um run de Code & Build. O onboarding nunca escreve.
- **Custo:** o passo é determinístico onde dá (tabelas, front matter, campos de release) e só chama modelo para o texto corrido (o resumo dos testes, a entrada do changelog). O custo aparece e conta no orçamento diário.

## Perguntas em aberto

1. Um turno de agente separado, ou um passo determinístico para as tabelas mais um modelo só para o texto? *Decidido (dono, 2026-11-01): um passo de máquina (sem modelo) no run `sdlc-record` encadeado depois de cada run de Code & Build com sucesso, para as tabelas e o front matter; um turno de modelo só para o texto.*
2. Padrão da opção no onboarding? *Proposta: ligada nos modelos de trabalho Standard e Full, desligada no Light.*
3. A release escreve o changelog a partir dos intents dos itens ou dos commits mesclados? *Proposta: a partir dos itens entregues na release (o título do intent e o link), com os commits como alternativa para mudanças fora de qualquer item.*
4. Quem atualiza os documentos de um run que falha ou para num gate? *Proposta: o passo roda só no fim de um run com sucesso. Um run parado deixa a Progress `pending`, e o gate dele mostra o porquê.*
