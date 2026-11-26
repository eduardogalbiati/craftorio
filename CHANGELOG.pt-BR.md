---
source: CHANGELOG.md (English)
---

# Changelog

Todas as releases do app, da mais nova para a mais antiga. Os itens levam aos seus documentos do SDLC; `#123` leva à issue.

## [1.0.1] - 2026-11-26

> Correções do primeiro uso real da 1.0.0: importar e começar um projeto, a primeira run, o pt-BR e runs que paravam onde nada estava errado.

### Adicionado
- As runs procuram segredos nos próprios commits (gitleaks) antes da revisão; um achado volta para o desenvolvedor (#49).
- A checagem de regras acha o linter e o type checker do próprio projeto, também em fix e refactor (#50), e cobre Rust com cargo clippy (#82).
- A primeira tela de um projeto novo ganha capturas e a revisão visual (#57).
- Importar um projeto diz quanto as análises custam antes de rodar (#74), e uma run de custo desconhecido diz isso (#72).

### Mudado
- **A verificação da base vem desligada**: quem quiser liga em Configurações › Execução (#85).
- O Night watch tenta de novo um item que falhou e só pula um item com Pular ligado (#87).
- Um projeto sem test runner é avisado no começo, em vez de parar em test_failed (#81).
- O build só bloqueia por vulnerabilidade que a mudança traz; a que já estava na base é relatada, nunca corrigida de carona, e uma correção nunca sobe versão major.
- No projeto do usuário, o revisor de UI segue as convenções do próprio projeto, nunca as regras da casa deste app.
- O app tem um logotipo novo.
- **Aceite de novo os workflows do repositório**: os workflows hero mudaram.

### Corrigido
- Um repositório importado consegue fazer push: o clone usa um protocolo que funciona (#79); importar por caminho local mantém o nome do repositório, e repositório só de documentação não vira Backend (#84).
- As pastas de tela vêm dos arquivos do projeto: nenhuma run herda o `src/renderer/` deste app (#80).
- A verificação da base não registra mais testes cancelados ou que estouraram o tempo como vermelhos na base (#78).
- Um projeto Node com `node_modules/` no .gitignore não para mais no gate do passo de testes a cada rodada.
- Um script de teste que compila antes (`tsc && node --test dist`) roda a suíte inteira, nunca os fontes TypeScript sozinhos.
- A rodada test:affected da suíte guarda o relatório de cada workspace (#91).
- O onboarding, o workflow refactor, a run esperando na barra lateral e a primeira run aparecem em pt-BR (#37, #40, #41, #70, #83).
- O logotipo e a captura do Findings funcionam numa aba do navegador no servidor do engine.

## [1.0.0] - 2026-11-25

> A primeira release com o nome Craftorio. As versões recomeçam; as releases abaixo são do Multiagent Orchestrator, o mesmo app.

### Added
- **Craftorio**: o novo nome do app, dos pacotes e das variáveis. O que uma instalação antiga deixou (workspace, configurações, conta) continua sendo encontrado.
- **Instalação por um prompt**: uma sessão de IA instala o app e o workspace, pelo [INSTALL.md](INSTALL.md) (#44).
- **O Oracle no workspace**: uma sessão do Claude Code ou do Codex aberta na pasta do workspace gerencia o app, pelo canal de controle (#32, #42, #43).
- Um projeto sem remoto tem um backlog local (#25, #35).
- Uma run de release escolhe o produto, o app ou o engine (#46).
- O onboarding do primeiro projeto, escrito como documentos do AI-native SDLC ([first-project-onboarding](docs/work/first-project-onboarding/)).

### Changed
- O app e o engine são lançados separadamente, de um só repositório com Turborepo e Changesets.
- Os agentes rodam nos modelos atuais: Fable 5.2, Sonnet 5.5 e Haiku 5.5 (#56).
- Uma run que abre um pull request espera num monitor do PR em vez de uma etapa de Approve.
- O primeiro início depois da troca de nome usa o engine deste computador, mesmo que a instalação antiga fosse cliente de um remoto; o endereço e o token continuam salvos, e Configurações › Execução › Engine volta a ele (#64).
- **Aceite de novo os workflows do repositório**: uma cópia alterada precisa ser aceita na tela Workflows.
- O onboarding, a primeira issue e o roadmap falam pt-BR (#23, #28, #36).

### Fixed
- Os agentes de run do Claude voltam a carregar o CLAUDE.md / AGENTS.md do repositório (#45).
- Uma dependência faltando na primeira run para uma vez num gate, em vez de mandar o desenvolvedor de volta (#30).
- Uma run simulada não mostra gasto (#31).
- A gaveta do Product Owner não leva o texto não enviado de outro projeto (#26); Iniciar abre no workflow padrão do projeto (#27).
- O Backlog Refresh funciona num projeto criado de uma pasta local: acha o repositório no GitHub ou GitLab por trás da pasta, e para antes de qualquer chamada de modelo quando não há nenhum (#63, #65).
- O guarda de servidor deixado em primeiro plano para o servidor certo no Windows e no Linux, pela hora de início, nunca o que o agente iniciou em segundo plano (#66).

## [1.4.0] - 2026-10-26

> Release candidate antes de cada estável, e o app dividido num pacote de engine e fronts modulares.

### Added
- Releases como release candidate e estável: um rc por push, e uma pessoa promove a estável.
- O engine descobre canais e áreas pelos fronts instalados (#591).

### Changed
- npm workspaces: `packages/engine`, `packages/shared` e `packages/ui-kit`; as telas vão para os fronts build, plan, analyser e ai (#563, #580–#596).
- Electron 45, three 0.186 e Playwright 1.64.

### Fixed
- As simulações usam o keychain falso do Chromium: nenhum diálogo do keychain do macOS no smoke, nos screenshots ou no E2E (#584).

## [1.3.0] - 2026-10-23

> O app fala o seu idioma, aprende como o seu projeto trabalha e pode rodar em outro computador.

### Added
- Idioma da interface: todas as telas traduzidas, e os agentes escrevem no idioma escolhido (#330).
- Ways of working: um seed de análise lê o repositório e compõe os workflows (#487).
- Workflows do repositório: `.multiagent/project.yaml`, aceito por commit (#485).
- Engine remoto: o app desktop como janela para um engine em outro computador (#420).
- Um terminal ao vivo nos passos determinísticos: acompanhar a suíte, o E2E ou os screenshots enquanto rodam (#465).
- A barra do roadmap mostra quanto o roadmap planejado custa e quanto tempo leva, por release (#421).

### Fixed
- O roadmap não busca mais o backlog inteiro a cada evento de run (#491).
- A cópia de um workflow no repositório não esconde mais a cópia editada pelo dono (#554).

### Security
- Checklist de prontidão para open source e revisão de segurança (#484).

## [1.1.2] - 2026-10-13

### Changed
- Checagem de tipos com `checkJs` e tipos JSDoc, arquivo por arquivo, com uma catraca (#346).
- Simulação como adaptadores injetados em vez de ramos de mock no engine (#353).

## [1.1.1] - 2026-10-13

### Added
- Testes de contrato por HTTP contra qualquer URL de engine, e um handshake de versão (#339).
- O tail de sessão e o cliente de controle como binários Rust: o app empacotado não precisa de Node (#342).

## [1.1.0] - 2026-10-12

> Assista a um run de workflow como um andar em 3D.

### Added
- Visão 3D do run: um run como um andar de passos e agentes, ao vivo e em replay, claro ou escuro.
- Um passo de revisão escreve o resumo da release mostrado no gate Ship (#290).

## [orchestrator-1.0.0] - 2026-10-05

> A primeira release estável.

### Added
- Workflows multiagente em YAML, rodados por Claude Code, Codex CLI e Grok Build como agentes headless.
- Um engine determinístico, com um supervisor de IA chamado quando um passo falha.
- Gates de aprovação humana que nenhuma automação atravessa.
- O roadmap com linhas de corte, e o workflow de release com um gate Ship só humano (#260).
- Builds para Windows, macOS e Linux.
