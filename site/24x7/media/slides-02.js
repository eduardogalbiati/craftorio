// Slide decks of chapter 2 (the same model as the "Diário do Orchestrator" decks): each
// <div class="deck" data-deck="name"> becomes a titled SVG slide with a description, arrows, dots
// and keyboard navigation. Everything is drawn here; the Markdown only places the empty divs.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const mono = 'IBM Plex Mono, ui-monospace, monospace';
  const sans = 'IBM Plex Sans, system-ui, sans-serif';
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const pen = (svg) => {
    const el = (t, a, txt) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (txt != null) e.textContent = txt; svg.appendChild(e); return e; };
    const text = (x, y, s, o = {}) => el('text', { x, y, 'font-size': o.size || 12, 'font-family': o.mono ? mono : sans, 'font-weight': o.bold ? 600 : 400, fill: o.fill || 'var(--d-ink)', 'text-anchor': o.anchor || 'start' }, s);
    const box = (x, y, w, h, o = {}) => el('rect', { x, y, width: w, height: h, rx: o.rx == null ? 6 : o.rx, fill: o.fill || 'var(--d-paper)', stroke: o.stroke || 'var(--d-rule)', 'stroke-width': o.sw || 1.2, 'stroke-dasharray': o.dash || '' });
    const arrow = (x1, y1, x2, y2, c = 'var(--d-muted)', dash = '') => {
      el('line', { x1, y1, x2, y2, stroke: c, 'stroke-width': 1.6, 'stroke-dasharray': dash });
      const a = Math.atan2(y2 - y1, x2 - x1), s = 7;
      el('path', { d: `M${x2},${y2}L${x2 - s * Math.cos(a - 0.45)},${y2 - s * Math.sin(a - 0.45)}L${x2 - s * Math.cos(a + 0.45)},${y2 - s * Math.sin(a + 0.45)}Z`, fill: c });
    };
    return { el, text, box, arrow };
  };
  const counters = (p, items) => {
    let x = 20;
    items.forEach(([k, v, c]) => { p.text(x, 288, k, { size: 11, fill: 'var(--d-muted)', mono: true }); const w = k.length * 6.8 + 8; p.text(x + w, 288, String(v), { size: 15, bold: true, fill: c || 'var(--d-ink)', mono: true }); x += w + String(v).length * 9 + 40; });
  };
  const chip = (p, x, y, w, label, bg, fg) => { p.box(x, y, w, 22, { fill: bg, stroke: fg, rx: 11 }); p.text(x + w / 2, y + 15, label, { size: 11, fill: fg, anchor: 'middle', bold: true }); };
  const file = (p, x, y, w, name, role, o = {}) => {
    p.box(x, y, w, 40, { stroke: o.stroke || 'var(--d-rule)', sw: o.stroke ? 2 : 1.2, fill: o.fill });
    p.text(x + 10, y + 17, name, { bold: true, size: 12 });
    p.text(x + 10, y + 32, role, { size: 10.5, fill: 'var(--d-muted)' });
  };
  const meter = (p, x, y, label, v, reason) => {
    p.text(x, y, label, { bold: true, size: 13 });
    for (let i = 0; i < 5; i++) p.box(x + i * 52, y + 12, 46, 22, { fill: i < v ? 'var(--d-accent)' : 'var(--d-paper)', stroke: i < v ? 'var(--d-accent)' : 'var(--d-rule)', rx: 4 });
    for (let i = 0; i < 5; i++) p.text(x + i * 52 + 23, y + 27, String(i + 1), { anchor: 'middle', mono: true, size: 11, bold: true, fill: i < v ? 'var(--d-paper)' : 'var(--d-muted)' });
    p.text(x, y + 56, reason, { size: 12, fill: 'var(--d-muted)' });
  };
  const SOFT = { accent: ['var(--d-soft-accent)', 'var(--d-accent)'], ok: ['var(--d-soft-ok)', 'var(--d-ok)'], bad: ['var(--d-soft-bad)', 'var(--d-bad)'], teal: ['var(--d-soft-teal)', 'var(--d-teal)'] };

  // ---- deck: the two validation modes
  const pipe = (p, y, stopAfter) => {
    const steps = ['desenvolver', 'revisar', 'testar', 'integrar'];
    steps.forEach((s, i) => {
      const x = 30 + i * 160;
      p.box(x, y, 120, 44, { fill: i === 3 ? 'var(--d-soft-ok)' : 'var(--d-paper)', stroke: i === 3 ? 'var(--d-ok)' : 'var(--d-rule)' });
      p.text(x + 60, y + 27, s, { anchor: 'middle', bold: true, size: 13 });
      if (i < 3) p.arrow(x + 122, y + 22, x + 158, y + 22, stopAfter === i ? 'var(--d-rule)' : 'var(--d-muted)', stopAfter === i ? '3 3' : '');
    });
  };
  const screen = (p, x, y, label, withRepo) => {
    p.box(x, y, 250, 150, { fill: 'var(--d-paper)' });
    p.text(x + 12, y + 20, label, { bold: true, size: 12, fill: 'var(--d-muted)' });
    p.box(x + 12, y + 34, 226, 96, { fill: 'var(--d-bg)' });
    p.text(x + 24, y + 58, 'Comprar café', { bold: true, size: 12 });
    p.text(x + 24, y + 78, 'a fazer', { size: 11, fill: 'var(--d-muted)' });
    if (withRepo) { p.box(x + 24, y + 92, 120, 24, { fill: 'var(--d-soft-accent)', stroke: 'var(--d-accent)', sw: 2, rx: 12 }); p.text(x + 84, y + 108, 'prevista: 12/10', { anchor: 'middle', size: 11, bold: true, fill: 'var(--d-accent)' }); }
  };
  const modos = [
    { t: 'Automático', d: 'A tarefa vai do código até a integração sem parar. Serve para o que não tem tela: motor, testes, documentação, reorganização. É o modo das noites.', draw: (p) => {
      p.text(30, 70, 'Uma tarefa sem tela', { bold: true, size: 13 });
      pipe(p, 100, -1);
      p.text(30, 190, 'Ninguém precisa olhar no meio do caminho. O resultado é conferido de manhã.', { size: 12, fill: 'var(--d-muted)' });
      counters(p, [['Paradas para mim:', 0, 'var(--d-ok)']]);
    } },
    { t: 'Validated', d: 'O fluxo para logo depois do desenvolvimento. Se a tela não é o que eu queria, descubro antes de pagar revisão e testes.', draw: (p) => {
      p.text(30, 70, 'Uma mudança de tela', { bold: true, size: 13 });
      pipe(p, 100, 0);
      p.box(148, 160, 120, 50, { fill: 'var(--d-soft-accent)', stroke: 'var(--d-accent)', sw: 2 });
      p.text(208, 181, 'para aqui', { anchor: 'middle', bold: true, size: 12, fill: 'var(--d-accent)' });
      p.text(208, 199, 'eu olho a tela', { anchor: 'middle', size: 11, fill: 'var(--d-accent)' });
      p.arrow(176, 158, 176, 148, 'var(--d-accent)');
      p.text(300, 190, 'Revisão e testes só rodam depois do meu ok.', { size: 12, fill: 'var(--d-muted)' });
      counters(p, [['Paradas para mim:', 1, 'var(--d-accent)'], ['Revisão antes do ok:', 'não']]);
    } },
    { t: 'O antes e o depois, lado a lado', d: 'Na tela de aprovação, cada tela mudada aparece duas vezes: como era e como ficou. Aprovar vira olhar o resultado.', draw: (p) => {
      screen(p, 40, 50, 'antes', false);
      screen(p, 390, 50, 'depois', true);
      p.arrow(296, 125, 384, 125, 'var(--d-accent)');
      counters(p, [['Telas mudadas:', 1], ['Linhas que eu li:', 0, 'var(--d-ok)']]);
    } },
    { t: 'Run App', d: 'Um botão abre a versão nova do aplicativo com um clique, para eu testar na hora. Depois aprovo ou devolvo com um comentário.', draw: (p) => {
      p.box(60, 40, 560, 200, { fill: 'var(--d-paper)' });
      p.text(80, 68, 'Aprovação: data prevista nas tarefas', { bold: true, size: 13 });
      p.text(80, 92, 'O fluxo está esperando você.', { size: 12, fill: 'var(--d-muted)' });
      p.box(80, 120, 150, 44, { fill: 'var(--d-accent)', stroke: 'var(--d-accent)' });
      p.text(155, 147, '▶  Run App', { anchor: 'middle', bold: true, size: 14, fill: 'var(--d-paper)' });
      p.box(250, 120, 120, 44); p.text(310, 147, 'Aprovar', { anchor: 'middle', bold: true, size: 13 });
      p.box(390, 120, 170, 44); p.text(475, 147, 'Pedir mudança', { anchor: 'middle', bold: true, size: 13 });
      p.text(80, 200, 'Abre uma cópia do app com a mudança, separada da versão que estou usando.', { size: 12, fill: 'var(--d-muted)' });
      counters(p, [['Para testar:', '1 clique', 'var(--d-ok)']]);
    } },
  ];

  // ---- deck: the PO's triage
  const FRASE = ['"Quero adicionar uma data prevista', 'nas tarefas."'];
  const triagem = [
    { t: 'A frase', d: 'Eu mando uma frase curta no chat do PO, do jeito que falaria com alguém do time.', draw: (p) => {
      p.text(620, 48, 'Eu', { anchor: 'end', bold: true, size: 12, fill: 'var(--d-muted)' });
      p.box(150, 58, 470, 64, { fill: 'var(--d-soft-accent)', stroke: 'var(--d-accent)', rx: 14 });
      p.text(170, 85, FRASE[0], { size: 14, bold: true }); p.text(170, 106, FRASE[1], { size: 14, bold: true });
      p.box(40, 160, 300, 64, { fill: 'var(--d-soft-teal)', stroke: 'var(--d-teal)', rx: 14 });
      p.text(60, 186, 'Product Owner', { bold: true, size: 13, fill: 'var(--d-teal)' });
      p.text(60, 206, 'lendo o backlog e o código…', { size: 12, fill: 'var(--d-teal)' });
      counters(p, [['Tarefa no backlog:', 'ainda não']]);
    } },
    { t: 'Procura no código', d: 'Ele lê o mapa do código, um resumo do papel de cada arquivo, e procura os nomes que a frase usa. Lê só o necessário, porque cada arquivo lido custa.', draw: (p) => {
      p.text(30, 40, 'Mapa do código', { bold: true, size: 13 });
      const rows = [['Formulário da tarefa', 'cria e edita a tarefa', 1], ['Card da tarefa', 'mostra a tarefa na lista', 1], ['API das tarefas', 'grava e lê as tarefas', 1], ['Backup', 'agendador do backup diário', 0], ['Login', 'entrada no app', 0]];
      rows.forEach(([n, r, hit], i) => file(p, 30, 52 + i * 44, 250, n, r, hit ? { stroke: 'var(--d-accent)', fill: 'var(--d-soft-accent)' } : {}));
      p.box(400, 70, 250, 60, { fill: 'var(--d-bg)' });
      p.text(414, 94, 'procura: "tarefa"', { mono: true, size: 12 });
      p.text(414, 114, 'procura: "data"', { mono: true, size: 12 });
      p.arrow(398, 98, 284, 72, 'var(--d-accent)'); p.arrow(398, 102, 284, 116, 'var(--d-accent)'); p.arrow(398, 106, 284, 160, 'var(--d-accent)');
      counters(p, [['Arquivos abertos:', 3, 'var(--d-ok)'], ['De:', 'centenas']]);
    } },
    { t: 'Mede', d: 'Complexidade e impacto, cada um de 1 a 5, com uma frase de justificativa que aponta a evidência.', draw: (p) => {
      meter(p, 40, 50, 'Complexidade', 3, 'quatro arquivos em duas áreas: tela e API');
      meter(p, 380, 50, 'Impacto', 2, 'ajuda a planejar, mas dá para viver sem');
      p.text(40, 170, '1 = um arquivo, poucas linhas', { size: 11.5, fill: 'var(--d-muted)' });
      p.text(40, 188, '5 = motor, dados gravados ou empacotamento', { size: 11.5, fill: 'var(--d-muted)' });
      p.text(380, 170, '1 = cosmético', { size: 11.5, fill: 'var(--d-muted)' });
      p.text(380, 188, '5 = bloqueia, perde dados ou cruza uma regra', { size: 11.5, fill: 'var(--d-muted)' });
      counters(p, [['Complexidade:', 3], ['Impacto:', 2]]);
    } },
    { t: 'Evita duplicata', d: 'Procura tarefas parecidas, abertas e fechadas. Se uma já cobre o pedido, sugere acrescentar nela. Aqui achou outra coisa: uma tarefa diferente que mexe no mesmo card.', draw: (p) => {
      file(p, 30, 110, 210, 'Tarefa nova', 'data prevista', { stroke: 'var(--d-accent)', fill: 'var(--d-soft-accent)' });
      p.text(330, 40, 'Backlog', { bold: true, size: 13 });
      const list = [['Exportar tarefas em CSV', 'outro pedido', 0], ['Prioridade no card da tarefa', 'mesmo card, outro pedido', 1], ['Backup diário', 'outro pedido', 0]];
      list.forEach(([n, r, hit], i) => file(p, 330, 52 + i * 56, 320, n, r, hit ? { stroke: 'var(--d-teal)', fill: 'var(--d-soft-teal)' } : {}));
      p.arrow(244, 130, 326, 128, 'var(--d-teal)');
      p.text(330, 236, 'Não é duplicata. É vizinha: vale rodar junto.', { size: 12, bold: true, fill: 'var(--d-teal)' });
      counters(p, [['Duplicata:', 'não', 'var(--d-ok)'], ['Vizinha:', 'sim', 'var(--d-teal)']]);
    } },
    { t: 'Confere a clareza', d: 'Uma nota de 0 a 100%. Abaixo de 85%, a tarefa não entra no roadmap. Faltava dizer se a data é obrigatória: o PO assume que é opcional e deixa a pergunta registrada.', draw: (p) => {
      const L = 40, W = 600, y = 70, X = (v) => L + v / 100 * W;
      p.box(L, y, W, 30, { fill: 'var(--d-bg)', rx: 15 });
      p.el('rect', { x: L, y, width: X(90) - L, height: 30, rx: 15, fill: 'var(--d-ok)' });
      p.text(X(90) + 10, y + 20, '90%', { bold: true, size: 13, fill: 'var(--d-ok)' });
      p.el('line', { x1: X(85), x2: X(85), y1: y - 14, y2: y + 44, stroke: 'var(--d-ink)', 'stroke-width': 2, 'stroke-dasharray': '4 3' });
      p.text(X(85), y - 20, 'mínimo para entrar: 85%', { anchor: 'middle', size: 11.5, bold: true });
      p.box(40, 140, 600, 76, { fill: 'var(--d-soft-accent)', stroke: 'var(--d-accent)' });
      p.text(56, 164, 'Pergunta aberta', { bold: true, size: 12, fill: 'var(--d-accent)' });
      p.text(56, 184, 'A data prevista é obrigatória?', { size: 12.5 });
      p.text(56, 204, 'Assumido por enquanto: opcional.', { size: 12.5, fill: 'var(--d-muted)' });
      counters(p, [['Clareza:', '90%', 'var(--d-ok)'], ['Perguntas no chat:', 'até 2']]);
    } },
    { t: 'Estima com dados', d: 'Tempo e esforço não são palpite da IA. O próprio aplicativo pega execuções passadas de complexidade parecida, calcula e diz em quantas se baseou.', draw: (p) => {
      const L = 60, W = 300, B = 230, X = (c) => L + (c - 1) / 4 * W;
      p.el('line', { x1: L, x2: L + W, y1: B, y2: B, stroke: 'var(--d-rule)' });
      [1, 2, 3, 4, 5].forEach((c) => p.text(X(c), B + 18, String(c), { anchor: 'middle', mono: true, size: 11, fill: 'var(--d-muted)' }));
      p.text(L, B + 36, 'complexidade das execuções passadas', { size: 11, fill: 'var(--d-muted)' });
      p.el('rect', { x: X(2) - 14, y: 40, width: X(4) - X(2) + 28, height: B - 44, rx: 8, fill: 'var(--d-soft-accent)' });
      const pts = [[1, 60], [1, 120], [2, 90], [2, 150], [2, 70], [3, 110], [3, 170], [3, 60], [4, 140], [4, 80], [5, 100], [5, 160], [2, 190], [1, 180], [3, 200]];
      pts.forEach(([c, y], i) => p.el('circle', { cx: X(c) + ((i * 7) % 15) - 7, cy: y, r: 6, fill: c >= 2 && c <= 4 ? 'var(--d-accent)' : 'var(--d-rule)' }));
      p.arrow(X(4) + 24, 130, 420, 130, 'var(--d-accent)');
      p.box(424, 90, 230, 84, { fill: 'var(--d-paper)', stroke: 'var(--d-accent)', sw: 2 });
      p.text(440, 114, 'Estimativa', { bold: true, size: 13 });
      p.text(440, 136, 'base: execuções parecidas', { size: 12, fill: 'var(--d-muted)' });
      p.text(440, 156, '(complexidade de 2 a 4)', { size: 12, fill: 'var(--d-muted)' });
      counters(p, [['Quem calcula:', 'o aplicativo', 'var(--d-ok)']]);
    } },
    { t: 'A tarefa pronta', d: 'Sai escrita com contexto, critérios de aceite, a triagem e o conselho de agrupamento. Nada é gravado sem o meu clique.', draw: (p) => {
      p.box(40, 24, 600, 236, { fill: 'var(--d-paper)' });
      p.text(58, 50, 'Data prevista nas tarefas', { bold: true, size: 14 });
      chip(p, 58, 62, 100, 'enhancement', ...SOFT.teal); chip(p, 166, 62, 110, 'complexity:3', ...SOFT.accent); chip(p, 284, 62, 90, 'impact:2', ...SOFT.accent); chip(p, 382, 62, 110, 'area:tarefas', ...SOFT.teal);
      p.text(58, 112, 'Critérios de aceite', { bold: true, size: 12 });
      ['o formulário tem um campo de data, opcional', 'o card mostra a data prevista', 'um teste cobre tarefas com e sem data'].forEach((s, i) => { p.box(58, 122 + i * 22, 12, 12, { rx: 2 }); p.text(78, 133 + i * 22, s, { size: 12 }); });
      p.text(58, 210, 'Triagem: 4 arquivos previstos · rodar junto com "Prioridade no card da tarefa"', { size: 11.5, fill: 'var(--d-muted)' });
      p.box(520, 222, 104, 30, { fill: 'var(--d-accent)', stroke: 'var(--d-accent)' });
      p.text(572, 242, 'Registrar', { anchor: 'middle', bold: true, size: 12.5, fill: 'var(--d-paper)' });
      counters(p, [['Gravado:', 'só com o meu clique', 'var(--d-accent)']]);
    } },
  ];

  // ---- deck: placing the task on the roadmap
  const lane = (p, y, label) => { p.text(20, y + 26, label, { bold: true, size: 12 }); p.el('line', { x1: 90, x2: 670, y1: y + 56, y2: y + 56, stroke: 'var(--d-rule)' }); };
  const grp = (p, x, y, w, title, files, o = {}) => {
    p.box(x, y, w, 48, { stroke: o.stroke || 'var(--d-rule)', sw: o.stroke ? 2 : 1.2, fill: o.fill || 'var(--d-paper)', dash: o.dash || '' });
    p.text(x + 10, y + 19, title, { bold: true, size: 12, fill: o.stroke || 'var(--d-ink)' });
    p.text(x + 10, y + 36, files, { size: 10.5, fill: 'var(--d-muted)' });
  };
  const ACC = { stroke: 'var(--d-accent)', fill: 'var(--d-soft-accent)' };
  const encaixe = [
    { t: 'O roadmap antes', d: 'Já existem tarefas planejadas, cada uma com os arquivos que deve mexer. A tarefa nova chega da triagem.', draw: (p) => {
      lane(p, 40, 'Etapa 1'); lane(p, 140, 'Etapa 2');
      grp(p, 100, 46, 230, 'Prioridade no card', 'card da tarefa');
      grp(p, 340, 46, 200, 'Backup diário', 'agendador');
      grp(p, 100, 146, 230, 'Exportar tarefas em CSV', 'API das tarefas');
      grp(p, 440, 210, 230, 'Tarefa nova: data prevista', 'formulário + card + API', ACC);
      counters(p, [['Etapas:', 2]]);
    } },
    { t: 'Junta o que pertence junto', d: 'A data prevista e a prioridade mexem no mesmo card. Vão para o mesmo grupo e a mesma execução: um conflito a menos e o contexto em um lugar só.', draw: (p) => {
      lane(p, 40, 'Etapa 1'); lane(p, 140, 'Etapa 2');
      p.box(94, 34, 252, 122, { stroke: 'var(--d-teal)', sw: 2, dash: '5 3', fill: 'none' });
      p.text(104, 150, 'um grupo · uma execução', { size: 11, bold: true, fill: 'var(--d-teal)' });
      grp(p, 100, 40, 240, 'Prioridade no card', 'card da tarefa');
      grp(p, 100, 84, 240, 'Data prevista', 'formulário + card + API', ACC);
      grp(p, 360, 46, 200, 'Backup diário', 'agendador');
      grp(p, 100, 180, 230, 'Exportar tarefas em CSV', 'API das tarefas');
      counters(p, [['Execuções:', 2, 'var(--d-ok)'], ['Se fossem separadas:', 3, 'var(--d-muted)']]);
    } },
    { t: 'Separa o que vai brigar', d: 'A exportação edita a mesma API das tarefas. Ela espera a etapa 1 terminar, com o motivo escrito no roadmap.', draw: (p) => {
      lane(p, 40, 'Etapa 1'); lane(p, 150, 'Etapa 2');
      grp(p, 100, 40, 240, 'Card: prioridade + data', 'formulário + card + API', ACC);
      grp(p, 360, 46, 200, 'Backup diário', 'agendador');
      grp(p, 100, 160, 240, 'Exportar tarefas em CSV', 'API das tarefas', { stroke: 'var(--d-bad)', fill: 'var(--d-soft-bad)' });
      p.arrow(220, 92, 220, 156, 'var(--d-bad)', '4 3');
      p.text(232, 128, 'edita o mesmo arquivo: espera a etapa 1', { size: 11.5, bold: true, fill: 'var(--d-bad)' });
      counters(p, [['Rodam juntos:', 'card · backup'], ['Depois:', 'exportação']]);
    } },
    { t: 'Escolhe o modo de cada grupo', d: 'O grupo do card é uma mudança de tela: roda em Validated, para eu olhar antes de pagar revisão e testes. O backup não tem tela: roda em Automático.', draw: (p) => {
      lane(p, 40, 'Etapa 1');
      grp(p, 100, 40, 240, 'Card: prioridade + data', 'formulário + card + API', ACC);
      grp(p, 360, 46, 200, 'Backup diário', 'agendador');
      chip(p, 100, 120, 100, 'Validated', ...SOFT.accent); p.text(210, 136, '"é uma tela: olhe antes de pagar revisão e testes"', { size: 11.5, fill: 'var(--d-muted)' });
      chip(p, 100, 160, 100, 'Automático', ...SOFT.ok); p.text(210, 176, '"sem tela: roda até integrar"', { size: 11.5, fill: 'var(--d-muted)' });
      counters(p, [['Cada escolha:', 'com o motivo no card']]);
    } },
    { t: 'O roadmap depois', d: 'Etapa 1 com dois grupos em paralelo, porque não dividem arquivo. Etapa 2 com o que precisava esperar. O PO propõe; eu aplico com um clique.', draw: (p) => {
      lane(p, 30, 'Etapa 1'); lane(p, 130, 'Etapa 2');
      grp(p, 100, 30, 240, 'Card: prioridade + data', 'Validated', ACC);
      grp(p, 360, 36, 200, 'Backup diário', 'Automático');
      grp(p, 100, 136, 240, 'Exportar tarefas em CSV', 'Automático');
      p.box(500, 220, 160, 34, { fill: 'var(--d-accent)', stroke: 'var(--d-accent)' });
      p.text(580, 242, 'Add to roadmap', { anchor: 'middle', bold: true, size: 12.5, fill: 'var(--d-paper)' });
      counters(p, [['Em paralelo na etapa 1:', 2, 'var(--d-ok)'], ['Etapas:', 2]]);
    } },
  ];

  const DECKS = { modos, triagem, encaixe };

  function deck(root, slides) {
    root.innerHTML = '<div class="deck-head"><span class="deck-pos"></span><b class="deck-title"></b></div>'
      + '<svg viewBox="0 0 680 300" role="img"></svg><p class="deck-desc"></p>'
      + '<div class="deck-nav"><button type="button" class="deck-prev" aria-label="Slide anterior">←</button><div class="deck-dots"></div><button type="button" class="deck-next" aria-label="Próximo slide">→</button></div>';
    root.tabIndex = 0; root.setAttribute('role', 'group'); root.setAttribute('aria-roledescription', 'slides');
    const svg = root.querySelector('svg'), title = root.querySelector('.deck-title'), desc = root.querySelector('.deck-desc'), pos = root.querySelector('.deck-pos'), dots = root.querySelector('.deck-dots');
    const prev = root.querySelector('.deck-prev'), next = root.querySelector('.deck-next');
    svg.setAttribute('aria-label', root.getAttribute('aria-label') || '');
    dots.innerHTML = slides.map((s, i) => `<button type="button" aria-label="Slide ${i + 1}: ${s.t}"></button>`).join('');
    let i = 0;
    function go(n) {
      i = Math.max(0, Math.min(slides.length - 1, n));
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      slides[i].draw(pen(svg));
      title.textContent = slides[i].t; desc.textContent = slides[i].d; pos.textContent = (i + 1) + ' / ' + slides.length;
      prev.disabled = i === 0; next.disabled = i === slides.length - 1;
      [...dots.children].forEach((d, k) => d.setAttribute('aria-current', k === i ? 'step' : 'false'));
      if (!reduce) { svg.classList.remove('fade'); svg.getBoundingClientRect(); svg.classList.add('fade'); }
    }
    prev.addEventListener('click', () => go(i - 1)); next.addEventListener('click', () => go(i + 1));
    [...dots.children].forEach((d, k) => d.addEventListener('click', () => go(k)));
    root.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { go(i + 1); e.preventDefault(); } if (e.key === 'ArrowLeft') { go(i - 1); e.preventDefault(); } });
    go(0);
  }
  document.querySelectorAll('.deck[data-deck]').forEach((root) => { const s = DECKS[root.dataset.deck]; if (s) deck(root, s); });
})();
