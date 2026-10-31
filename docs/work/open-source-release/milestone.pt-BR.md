---
kind: milestone
title: Revisão final para liberar como open source
summary: "Um beta fechado valida o app; depois o repositório vira público."
status: planned           # planned → in progress → done (o dono)
after: write-doc          # aparece depois deste item em Next
expected: 2026-11-05      # o dia em que o beta abre
date: 2026-10-31
source: milestone.md (English)
---

# Marco: revisão final para liberar como open source

## O que acontece

1. **Revisão final** do app e do repositório: o [checklist de open source](https://github.com/eduardogalbiati/multiagent-orchestrator/blob/main/docs/open-source-checklist.md) e a revisão de segurança de 22/10/2026 (#466 a #483).
2. **Beta fechado**, previsto para quinta-feira, 5 de novembro: os beta testers instalam o app e ajudam a validar com os próprios projetos (o onboarding do primeiro projeto, os workflows, os builds de release).
3. O que eles encontrarem vira issue no backlog; o que bloqueia a liberação é corrigido primeiro.
4. **Open source**: o repositório vira público, e com ele esta página e as releases.

## Não é um item do SDLC

Um marcador no histórico do projeto. Não tem intent, spec nem plan próprios: o trabalho que ele reúne fica nos seus próprios itens e issues. Quando for alcançado, o `status` vira `done` com o dia em `reached:`, e ele aparece no Changelog.
