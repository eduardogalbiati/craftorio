# Multiagent Orchestrator

### PARA OS BETA USERS
Seus betinhas, obrigado por participar do beta

O que funciona hoje:
- Importação de Projetos (Existing Project)
- Tela de Projetos
- Criação de workflows (recomendo usar o Feature / Fix / Release) que já vem com o projeto

O que falta ajustar
- PO (não use o PO para priorizar, ele coloca as configs de workflow erradas, tem uma issue pra resolver isso)
- Plan & Design (está em progresso)
- Monitor (draft)


Depois de rodar o app com npm i && npm start
Importem algum projeto
E usem uma IA externa (claude, codex) para interagir com o sistema.
Peça para a sua IA priorizar itens, colocar no backlog, startar o roadmap, analisar performance etc....

Happy coding, qualquer problema podem abrir issues

O épico que preciso finalizar porém acabou meus credittos é
https://github.com/eduardogalbiati/multiagent-orchestrator/issues/785

Se forem importar o APP dentro do APP para poder contribuir use esse workflow
ai-development-remote-hero.yaml

Electron app that runs multi-agent workflows defined in YAML (`<workspace>/workflows/`), opening
**Claude Code**, **Codex CLI** and **Grok Build** sessions and recording the observability of each session
(open/active time, tokens, cost, prompts, thinking, tool calls, output).
