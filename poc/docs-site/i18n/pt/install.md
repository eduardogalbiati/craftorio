# Instalação

Baixe o arquivo para o seu sistema na última
[Release do GitHub](https://github.com/eduardogalbiati/multiagent-orchestrator/releases/latest). Os
builds ainda não são assinados, por isso cada sistema avisa uma vez antes da primeira abertura.

- **Windows** (x64): `MultiagentOrchestrator-win32-x64.zip`. Descompacte em qualquer pasta e execute
  `MultiagentOrchestrator.exe`. Se o SmartScreen disser "O Windows protegeu o computador", clique em
  **Mais informações** e depois em **Executar assim mesmo**.
- **macOS** (Apple Silicon: `MultiagentOrchestrator-darwin-arm64.zip`; Intel:
  `MultiagentOrchestrator-darwin-x64.zip`). Descompacte e mova `MultiagentOrchestrator.app` para
  Aplicativos. O app não é notarizado, então a primeira abertura é bloqueada: abra uma vez, depois vá
  em **Ajustes do Sistema › Privacidade e Segurança** e clique em **Abrir mesmo assim** ao lado da
  mensagem sobre o app (ou, no Terminal: `xattr -dr com.apple.quarantine /Applications/MultiagentOrchestrator.app`).
  A entrada por voz pede o microfone na primeira vez que você a usa.
- **Linux** (x64): `MultiagentOrchestrator-linux-x64.AppImage`. Dê permissão de execução e rode:
  `chmod +x MultiagentOrchestrator-linux-x64.AppImage && ./MultiagentOrchestrator-linux-x64.AppImage`
  (se não abrir por falta do FUSE, rode com `--appimage-extract-and-run`). Em sistemas que proíbem
  user namespaces sem privilégio (Ubuntu 23.10 em diante, o padrão do AppArmor) o AppImage só abre
  com o sandbox do Chromium desligado: ele avisa no stderr e em **Settings › About**. Sem o sandbox,
  uma página comprometida do app compromete o processo inteiro. Para manter o sandbox ligado, libere
  os user namespaces sem privilégio: `sudo sysctl kernel.apparmor_restrict_unprivileged_userns=0`
  (para valer em toda abertura: um arquivo em `/etc/sysctl.d/` com
  `kernel.apparmor_restrict_unprivileged_userns=0`). A escolha é sua, com o seu custo: vale para o
  sistema inteiro, então todo programa volta a poder criar user namespaces, uma superfície de ataque
  do kernel que o Ubuntu fechou de propósito. `MultiagentOrchestrator-linux-x64.tar.gz` é o mesmo
  app como pasta: rode `./MultiagentOrchestrator` dentro dela; se parar com "The SUID sandbox helper
  binary was found, but is not configured correctly", dê ao helper do sandbox as permissões uma vez:
  `sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox`.

**Dimensionamento.** Cada run em andamento usa cerca de 4 threads e 6 GB de RAM (a CLI do agente,
os testes, o ferramental). O app lê esta máquina ao abrir e propõe quantas runs em paralelo (1 a 6)
e quantos workers de teste por run (Settings › Execution › Concurrent runs, também mostrado no
Setup); um valor definido à mão sempre vence.

As CLIs que os workflows usam são instaladas à parte: veja
[Instalando as CLIs no Windows](#installing-the-clis-on-windows) e a parte de macOS e Linux.

**Ícone do app.** `apps/desktop/assets/icon.ico` (Windows), `apps/desktop/assets/icon.icns` (macOS) e
`apps/desktop/assets/icon.png` (Linux) são gerados de uma única imagem, `apps/desktop/assets/icon-source.png`
(origem e licença em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). Para trocar o ícone, coloque
um PNG quadrado de 1024 px ou mais em `apps/desktop/assets/icon-source.png` (ou passe o caminho) e
rode `npm run icons`, depois faça commit dos quatro arquivos.
