---
item: first-project-onboarding
issue: "#628"
stage: test
status: not started       # filled by the runs: suite, E2E, screenshots, evals
approver: code owner (at the PR or the developer's gate)
source: test.md (English)
---

# Test: evidência do onboarding

Esta etapa não tem um arquivo escrito por alguém: ela junta a evidência que os runs produzem, para o code owner aprovar olhando o que foi provado. Fica vazia até o primeiro run do Build.

## Suíte e testes

Cada run acrescenta uma linha: a suíte unitária, os testes escritos (E2E primeiro na feature, quando há suíte E2E) e o resultado.

| Run | Unit | E2E | Resultado |
|---|---|---|---|
| — | — | — | ainda nada |

## Screenshots de antes e depois

Os pares original/modificado do passo `screenshots`, com as checagens do axe (contraste, tamanho de alvo). Entram aqui as telas do assistente: start, repository, cloning, access-error, analysis e review.

## Evals

Só no modelo de trabalho Completo: o resultado dos evals de skills e workflows no CI, e se a mudança baixou a taxa de acerto.
