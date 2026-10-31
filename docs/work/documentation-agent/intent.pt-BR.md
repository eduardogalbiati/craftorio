---
item: documentation-agent
issue: "#658"
stage: plan
status: proposed          # proposed → accepted | rejected (product owner)
author: Claude (Code session), from the owner's request
approver: Eduardo Galbiati (product owner)
date: 2026-10-31
depends_on: first-project-onboarding     # its phase 2 rebuilds feature / fix / release (#630) and phase 5 adds the work model (#633)
source: intent.md (English)
---

# Intent: agente de documentação

## Problema

Os artefatos do AI-native SDLC em `docs/work/<item>/` só continuam verdadeiros se alguém os atualizar depois de cada run. Hoje isso é uma tarefa manual em cada item do roadmap:
- a linha da `## Progress` do `plan.md`;
- a evidência no `test.md`;
- os campos de release no `deploy.md`;
- a entrada no `CHANGELOG.md`.

A página pública (`site/`) lê exatamente esses arquivos: "plan: N of M steps", entregue e lead time, os chips do changelog, os marcos. Arquivo que ninguém atualizou é página errada. E a ideia é que os agentes do dono só façam commit no git, com a página republicada a partir do `main`. Então as atualizações precisam vir dos próprios workflows.

## Resultado esperado

Um passo de **agente de documentação** nos workflows de Code & Build mantém os documentos de cada item em dia, em tempo real, como parte do run que mudou o item. É commitado por esse run, no gate de sempre. Os projetos aderem na hora do cadastro, por uma opção nova no onboarding, **"Add the realtime documentation model"**.

Ele chega em duas partes:

1. **Com os workflows** (`feature`, `fix`, `release`, depois da #630):
   - `plan.md`: o front matter (`status`, `date`) e a linha da `## Progress` (Status `done`/`pending`, o run, o commit ou PR), depois de cada run de feature ou fix;
   - `test.md`: os resultados da suíte e do E2E e os screenshots de antes e depois do run;
   - `deploy.md`: os achados da revisão e, na release, `release:` e `released:` (que a página precisa para entregue e lead time);
   - `CHANGELOG.md` (+ `CHANGELOG.pt-BR.md`) na raiz, no formato Keep a Changelog: o workflow `release` acrescenta cada versão, e um link `docs/work/<item>/` vira o chip do item.
2. **Com o modelo de trabalho e o Monitor** (depois da #633, com a #634):
   - `maintain.md`: incidentes e post-mortems;
   - marcos em `docs/work/<nome>/milestone.md` (`kind: milestone`, `expected:`, `reached:`);
   - um intent nascido de um incidente (o `intent.md` de um item novo, com o card no Inbox).

Ele **não escreve `intent.md` nem `spec.md`**. Isso é do fluxo de write doc (#636). Este agente só atualiza o status deles no front matter depois do gate humano.

## Usuários e sistemas afetados

- **Usuários:**
  - o dono e quem lê a página pública, que veem o progresso verdadeiro sem ninguém editar arquivos à mão;
  - os contribuidores, que acham o estado de cada item no repositório.
- **Sistemas:**
  - os workflows `feature`, `fix` e `release` (um passo final de documentação);
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
- Segue o `docs/work/CONVENTIONS.md`: primeiro o arquivo em inglês, depois a tradução `.pt-BR.md` ao lado.
- Escreve no repositório do usuário só pelo run, no gate de sempre. O onboarding nunca escreve.
- **Custo:** o passo é determinístico onde dá (tabelas, front matter, campos de release) e só chama modelo para o texto corrido (o resumo dos testes, a entrada do changelog). O custo aparece e conta no orçamento diário.

## Perguntas em aberto

1. Um turno de agente separado, ou um passo determinístico para as tabelas mais um modelo só para o texto? *Proposta: determinístico onde der, um turno de modelo só para o texto.*
2. Padrão da opção no onboarding? *Proposta: ligada nos modelos de trabalho Standard e Full, desligada no Light.*
3. A release escreve o changelog a partir dos intents dos itens ou dos commits mesclados? *Proposta: a partir dos itens entregues na release (o título do intent e o link), com os commits como alternativa para mudanças fora de qualquer item.*
4. Quem atualiza os documentos de um run que falha ou para num gate? *Proposta: o passo roda só no fim de um run com sucesso. Um run parado deixa a Progress `pending`, e o gate dele mostra o porquê.*
