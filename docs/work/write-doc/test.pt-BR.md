---
item: write-doc
issue: "#636"
stage: test
status: not started       # filled by the runs: suite, E2E, screenshots, evals
approver: code owner (at the PR or the developer's gate)
source: test.md (English)
---

# Test: evidência do write doc

Esta etapa não tem um arquivo escrito por alguém: ela junta a evidência que os runs produzem, para o code owner aprovar olhando o que foi provado. Fica vazia até o primeiro run do Build.

## Suíte e testes

Cada run acrescenta uma linha: a suíte unitária, os testes escritos (E2E primeiro na feature, quando há suíte E2E) e o resultado.

| Run | Unit | E2E | Resultado |
|---|---|---|---|
| — | — | — | ainda nada |

## Screenshots de antes e depois

Os pares original/modificado do passo `screenshots`, com as checagens do axe (contraste, tamanho de alvo). Entram aqui as telas do editor: Documents, o editor com uma seleção, as mudanças por pedido, a revisão e o gate de sign-off.

## Evals

Só no modelo de trabalho Completo: o resultado dos evals de skills e workflows no CI, e se a mudança baixou a taxa de acerto.
