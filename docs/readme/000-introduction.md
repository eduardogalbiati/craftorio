# Craftorio

## Install with an AI session

Paste this in Claude Code or Codex (you need access to this repository):

```
Install Craftorio following INSTALL.md of https://github.com/eduardogalbiati/craftorio
```

It installs the app (the executable, or from the source code: you choose), creates the workspace folder and tells you the last step: open a session in that folder,
which then works as the **Oracle** and manages the app for you, also from the phone. The steps it follows:
[INSTALL.md](INSTALL.md).

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


Instalem colando o prompt acima no Claude ou no Codex (ele pergunta se você quer o executável ou o código; o executável depende de já existir uma release)
Depois abram uma sessão nova do Claude ou do Codex NA PASTA DO WORKSPACE: ela assume o papel de Oracle
Importem algum projeto
Peça para o Oracle priorizar itens, colocar no backlog, startar o roadmap, analisar performance etc....

Happy coding, qualquer problema podem abrir issues

O épico que preciso finalizar porém acabou meus credittos é
https://github.com/eduardogalbiati/multiagent-orchestrator/issues/785

Se forem importar o APP dentro do APP para poder contribuir use esse workflow
ai-development-remote-hero.yaml

Electron app that runs multi-agent workflows defined in YAML (`<workspace>/workflows/`), opening
**Claude Code**, **Codex CLI** and **Grok Build** sessions and recording the observability of each session
(open/active time, tokens, cost, prompts, thinking, tool calls, output).
