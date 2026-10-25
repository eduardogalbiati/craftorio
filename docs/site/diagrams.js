#!/usr/bin/env node
// The documentation site's diagrams, written as SVG into docs/site/assets/ (run by
// scripts/docs-site.js before the pages, or alone: `node docs/site/diagrams.js`). One function per
// diagram, drawn on the app's theme tokens. The view box is 820 wide, the content column's width,
// so a diagram renders 1:1: text is 15–20px on the page. Few words per box, boxes stacked rather
// than squeezed into one row. Add a diagram here, never an SVG by hand.
// `wf-<name>.svg`, one per bundled workflow, is drawn from the YAML itself (workflows/, with the
// fragments/ a step includes): its step groups as stages, the steps as chips coloured by type,
// the transitions between stages as arrows, so the drawing follows the workflow when it changes.
'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const ROOT = path.resolve(__dirname, '..', '..');

const OUT = path.join(__dirname, 'assets');
const W = 820;
const C = { bg: '#0e1014', panel: '#151820', border: '#262b37', text: '#e6e8ee', muted: '#8a91a3', accent: '#7c9cff',
  green: '#4ade80', yellow: '#facc15', red: '#f87171', purple: '#c084fc', orange: '#fb923c', info: '#7dd3fc' };
const SANS = 'Segoe UI, system-ui, sans-serif';
const MONO = 'Cascadia Code, Consolas, SF Mono, Menlo, monospace';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MARKERS = { [C.muted]: 'g', [C.green]: 'ok', [C.orange]: 'warn', [C.red]: 'bad', [C.accent]: 'acc' };

class Svg {
  constructor(h) {
    this.parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" font-family="${SANS}" font-size="16">`,
      `<rect width="${W}" height="${h}" rx="12" fill="${C.bg}"/>`,
      '<defs>' + Object.entries(MARKERS).map(([c, n]) => `<marker id="a-${n}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`).join('') + '</defs>'];
  }
  text(x, y, s, { fill = C.text, size = 16, weight = 400, anchor = 'start', mono = false, spacing = 0 } = {}) {
    this.parts.push(`<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}"${mono ? ` font-family="${MONO}"` : ''}${spacing ? ` letter-spacing="${spacing}"` : ''}>${esc(s)}</text>`);
  }
  rect(x, y, w, h, { stroke = C.border, fill = C.panel, r = 10, opacity = 1 } = {}) {
    this.parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-opacity="${opacity}"/>`);
  }
  // a titled box: a coloured title, a muted subtitle, mono lines; returns its height
  box(x, y, w, color, title, sub, lines = []) {
    const h = 44 + (sub ? 24 : 0) + lines.length * 25 + 14;
    this.rect(x, y, w, h, { stroke: color, opacity: .7 });
    this.text(x + 18, y + 32, title, { fill: color, size: 19, weight: 700 });
    let yy = y + 32;
    if (sub) { yy += 24; this.text(x + 18, yy, sub, { fill: C.muted, size: 15 }); }
    for (const l of lines) { yy += 25; this.text(x + 18, yy, l, { size: 15.5, mono: true }); }
    return h;
  }
  arrow(x1, y1, x2, y2, { color = C.muted, dash = false } = {}) {
    this.parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2"${dash ? ' stroke-dasharray="6 5"' : ''} marker-end="url(#a-${MARKERS[color] || 'g'})"/>`);
  }
  path(d, { color = C.muted, dash = false } = {}) {
    this.parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2"${dash ? ' stroke-dasharray="6 5"' : ''} marker-end="url(#a-${MARKERS[color] || 'g'})"/>`);
  }
  write(name) {
    this.parts.push('</svg>');
    fs.writeFileSync(path.join(OUT, name), this.parts.join('\n') + '\n');
  }
}

// ---------- repo-map: the repository's folders, by layer (at most 3 boxes per line) ----------
function repoMap() {
  const rows = [
    ['What you run', C.accent, [['apps/desktop', 'the Electron app'], ['apps/web', 'the same UI in a browser']]],
    ['The UI', C.purple, [['packages/ui-kit', 'shell, controls, Home'], ['fronts/<id>', 'one per screen family']]],
    ['The engine', C.green, [['packages/engine', 'graph, service, server'], ['packages/shared', 'code both sides use'], ['native', 'Rust sidecars']]],
    ['What agents run', C.orange, [['workflows', 'the YAML workflows'], ['fragments', 'shared step groups'], ['pipelines', 'workflow chains'], ['skills', 'one per capability'], ['seeds', 'analysis seeds']]],
    ['Tooling', C.muted, [['scripts', 'run, test, build, docs'], ['test', 'unit tests'], ['features', 'E2E (Playwright)'], ['.github', 'CI and deploy']]],
    ['Docs', C.info, [['README.md', 'user docs'], ['docs/agents', 'for coding agents'], ['docs/site', 'this site'], ['poc', 'proofs of concept']]],
  ];
  const x0 = 170, boxH = 70, gap = 12, perLine = 3, bw = (W - x0 - 24 - gap * (perLine - 1)) / perLine;
  const lines = rows.reduce((n, [, , b]) => n + Math.ceil(b.length / perLine), 0);
  const s = new Svg(28 + lines * (boxH + gap) + rows.length * 14);
  let y = 28;
  for (const [label, color, boxes] of rows) {
    const rowLines = Math.ceil(boxes.length / perLine);
    s.text(24, y + (rowLines * (boxH + gap) - gap) / 2 + 6, label.toUpperCase(), { fill: color, size: 13, weight: 700, spacing: 1.2 });
    boxes.forEach(([name, what], i) => {
      const x = x0 + (i % perLine) * (bw + gap), yy = y + Math.floor(i / perLine) * (boxH + gap);
      s.rect(x, yy, bw, boxH, { r: 8 });
      s.parts.push(`<rect x="${x}" y="${yy}" width="3" height="${boxH}" rx="1.5" fill="${color}"/>`);
      s.text(x + 16, yy + 29, name, { size: 16, weight: 600, mono: true });
      s.text(x + 16, yy + 53, what, { fill: C.muted, size: 14.5 });
    });
    y += rowLines * (boxH + gap) + 14;
  }
  s.write('repo-map.svg');
}

// ---------- architecture: the four layers at run time, stacked ----------
function architecture() {
  const layers = [['UI', 'packages/ui-kit + fronts', 'the desktop window, or a browser', C.purple, 'window.api: IPC in the app, HTTP/WebSocket from a browser'],
    ['Service', 'packages/engine/service', 'channels, one per area of the UI', C.accent, 'calls'],
    ['Engine', 'packages/engine/engine', 'walks the workflow graph, stops at gates', C.green, 'spawns'],
    ['Agent CLIs', 'claude · codex · grok', 'one headless process per turn', C.orange, null]];
  const bw = 330, bh = 96, gap = 44;
  const s = new Svg(24 + layers.length * (bh + gap) - gap + 60);
  layers.forEach(([t, sub, what, c, link], i) => {
    const y = 24 + i * (bh + gap);
    s.rect(24, y, bw, bh, { stroke: c, opacity: .7 });
    s.text(42, y + 34, t, { fill: c, size: 20, weight: 700 });
    s.text(42, y + 60, sub, { size: 15.5, mono: true });
    s.text(42, y + 82, what, { fill: C.muted, size: 14.5 });
    if (link) {
      s.arrow(24 + bw / 2, y + bh + 3, 24 + bw / 2, y + bh + gap - 3);
      s.text(24 + bw / 2 + 14, y + bh + gap / 2 + 5, link, { fill: C.muted, size: 14 });
    }
  });
  const ry = 24 + layers.length * (bh + gap) - gap + 22;
  s.text(24, ry, 'Everything a run produces goes to <workspace>/runs/<run>/: the workspace is the product.', { fill: C.muted, size: 15 });
  // the right column: what crosses each boundary
  s.text(430, 60, 'The UI never reads files or runs code:', { size: 15.5, weight: 600 });
  s.text(430, 84, 'it asks the service, through one API,', { fill: C.muted, size: 15 });
  s.text(430, 106, 'whether it runs in Electron or a browser.', { fill: C.muted, size: 15 });
  s.text(430, 200, 'The engine is deterministic:', { size: 15.5, weight: 600 });
  s.text(430, 224, 'the YAML decides the next step; a model', { fill: C.muted, size: 15 });
  s.text(430, 246, 'only runs inside an agent turn.', { fill: C.muted, size: 15 });
  s.text(430, 340, 'A turn is a process:', { size: 15.5, weight: 600 });
  s.text(430, 364, 'claude -p, codex exec or grok, with the', { fill: C.muted, size: 15 });
  s.text(430, 386, "flags that match the agent's capabilities.", { fill: C.muted, size: 15 });
  s.write('architecture.svg');
}

// ---------- engine-workflow-anatomy: the parts of a workflow YAML, stacked ----------
function workflowAnatomy() {
  const s = new Svg(560);
  let y = 24;
  const half = (W - 48 - 16) / 2;
  const h1 = s.box(24, y, half, C.info, 'inputs', 'what the user fills in at Start', ['prompt, goal, max_rounds', 'writer_provider, writer_model']);
  s.box(24 + half + 16, y, half, C.purple, 'agents', 'who works, with which CLI and rules', ['writer: provider, model, session,', '  skills, capabilities, system_prompt']);
  y += h1 + 16;
  const h2 = s.box(24, y, W - 48, C.muted, 'providers · defaults · orchestrator', 'how each CLI is called, the limits, the supervisor', ['claude / codex / grok flags · timeout, max_context, retry', 'supervisor: max_interventions · limits: max_total_cost_usd']);
  y += h2 + 16;
  s.box(24, y, W - 48, C.accent, 'steps', 'the graph: who runs, what is asked, what must be answered, where to go next', [
    '- id: review    agent: reviewer',
    '  prompt: | … {{ steps.write.output.document }} …',
    '  output_schema: { score, summary, notes }',
    '  transitions:',
    '    - { when: "output.score >= inputs.threshold", goto: signoff }',
    '    - { when: "true", goto: write, loop: { max_iterations: 4 } }']);
  s.write('engine-workflow-anatomy.svg');
}

// ---------- engine-run-loop: one visit of a step, stacked with a note per step ----------
function runLoop() {
  const steps = [['Pick the step', C.accent, 'the one the last transition named'],
    ['Render the prompt', C.accent, 'a template: inputs, earlier outputs, feedback'],
    ['Agent turn', C.orange, 'one headless CLI process, with its session'],
    ['Check the answer', C.green, 'against output_schema; a wrong one is asked again'],
    ['Transitions', C.accent, 'the first when that holds says where to go']];
  const bw = 270, bh = 66, gap = 30, x = 60;
  const s = new Svg(24 + steps.length * (bh + gap) + 90);
  steps.forEach(([t, c, note], i) => {
    const y = 24 + i * (bh + gap);
    s.rect(x, y, bw, bh, { stroke: c, opacity: .7 });
    s.text(x + bw / 2, y + 41, t, { fill: c, size: 18, weight: 700, anchor: 'middle' });
    s.text(x + bw + 24, y + 41, note, { fill: C.muted, size: 15.5 });
    if (i < steps.length - 1) s.arrow(x + bw / 2, y + bh + 3, x + bw / 2, y + bh + gap - 3);
  });
  const last = 24 + (steps.length - 1) * (bh + gap);
  s.path(`M ${x} ${last + bh / 2} H 36 V ${24 + bh / 2} H ${x - 3}`);
  const ny = last + bh + 28;
  s.text(x, ny, 'then: the next step · the same step again · a human gate (the run waits) · end', { size: 15.5 });
  s.text(x, ny + 26, 'On a failure the supervisor is called, a few times per step at most; never for a gate.', { fill: C.red, size: 15 });
  s.text(x, ny + 50, 'Everything is recorded: events.jsonl, summary.json, sessions, handoffs, evidence.', { fill: C.green, size: 15 });
  s.write('engine-run-loop.svg');
}

// ---------- engine-writer-reviewer: the example graph ----------
function writerReviewer() {
  const nw = 140, nh = 70, y0 = 70, xs = [24, 214, 404, 594];
  const s = new Svg(345);
  s.text(24, 36, 'workflows/writer-reviewer.yaml: the engine decides by the score; yellow = a human gate', { fill: C.muted, size: 15 });
  const nodes = [['write', 'writer', C.purple], ['review', 'reviewer', C.purple], ['signoff', 'supervisor', C.accent], ['decide', 'you', C.yellow]];
  nodes.forEach(([id, who, c], i) => {
    s.rect(xs[i], y0, nw, nh, { stroke: c, opacity: .8 });
    s.text(xs[i] + nw / 2, y0 + 31, id, { size: 17, weight: 600, mono: true, anchor: 'middle' });
    s.text(xs[i] + nw / 2, y0 + 55, who, { fill: c, size: 15, anchor: 'middle' });
  });
  const ym = y0 + nh / 2;
  for (let i = 0; i < 3; i++) s.arrow(xs[i] + nw, ym, xs[i + 1], ym, { color: i === 1 ? C.green : C.muted });
  s.text(xs[1] + nw + (xs[2] - xs[1] - nw) / 2, y0 - 12, 'score ≥ threshold', { fill: C.green, size: 14, anchor: 'middle' });
  s.arrow(xs[3] + nw, ym, W - 24, ym, { color: C.green });
  s.text(xs[3] + nw + 8, ym - 12, 'accept', { fill: C.green, size: 14 });
  // review → write (below threshold)
  s.path(`M ${xs[1] + 40} ${y0 + nh} V ${y0 + nh + 40} H ${xs[0] + nw / 2} V ${y0 + nh + 2}`, { color: C.orange });
  s.text(xs[0] + 20, y0 + nh + 62, 'below threshold: back to the writer with the notes, up to max_rounds', { fill: C.orange, size: 14.5 });
  // review → out_of_rounds
  const oy = y0 + nh + 100;
  s.arrow(xs[1] + nw - 30, y0 + nh, xs[1] + nw - 30, oy, { color: C.red });
  s.rect(xs[1] + 40, oy, 170, 54, { stroke: C.yellow, opacity: .8 });
  s.text(xs[1] + 125, oy + 25, 'out_of_rounds', { size: 16, weight: 600, mono: true, anchor: 'middle' });
  s.text(xs[1] + 125, oy + 45, 'you', { fill: C.yellow, size: 14, anchor: 'middle' });
  s.text(xs[1] + 225, oy + 32, 'rounds used up: you decide', { fill: C.red, size: 14.5 });
  // decide → write (revise)
  s.path(`M ${xs[3] + nw / 2} ${y0 + nh} V ${oy + 92} H ${xs[0] + 30} V ${y0 + nh + 2}`, { dash: true });
  s.text(xs[0] + 44, oy + 80, 'revise: your instructions go into every next prompt', { fill: C.muted, size: 14.5 });
  s.write('engine-writer-reviewer.svg');
}

// ---------- wf-<name>: a bundled workflow's stages, steps and the transitions between stages ----------
const NO_MODEL = new Set(['suite', 'check', 'test_ids', 'screenshots', 'project_map', 'refactor_proposals', 'release_version']);
function stepKind(step, fragments) {
  const body = step.fragment ? (fragments[step.fragment] || {})[step.id] || {} : {};
  const type = step.type || body.type;
  if (type === 'human_approval') return ['gate', C.yellow, 'you'];
  if (type === 'workflow') return ['child', C.accent, 'child runs'];
  if (type && NO_MODEL.has(type)) return ['machine', C.green, 'no agent'];
  const agents = step.agents || body.agents;
  const agent = step.agent || body.agent;
  return ['agent', C.purple, agents ? `${agents.length} in parallel` : (agent || 'agent')];
}
function workflowGraph(file) {
  const w = yaml.load(fs.readFileSync(path.join(ROOT, 'workflows', file), 'utf8'));
  const fragments = {};
  for (const st of w.steps) if (st.fragment && !fragments[st.fragment]) fragments[st.fragment] = yaml.load(fs.readFileSync(path.join(ROOT, 'fragments', `${st.fragment}.yaml`), 'utf8')).steps || {};
  const byId = Object.fromEntries(w.steps.map((st) => [st.id, st]));
  const stages = (w.groups || []).map((g) => ({ name: g.name, steps: g.steps.filter((id) => byId[id]) }));
  const grouped = new Set(stages.flatMap((g) => g.steps));
  const rest = w.steps.filter((st) => !grouped.has(st.id)).map((st) => st.id);
  if (rest.length) stages.push({ name: 'Other steps', steps: rest });
  const stageOf = {};
  stages.forEach((g, i) => g.steps.forEach((id) => { stageOf[id] = i; }));
  // transitions between stages: forward (i → j, j > i), back (j < i), and to end
  const forward = new Map(), back = new Map(), toEnd = new Set();
  for (const st of w.steps) {
    const from = stageOf[st.id];
    const body = st.fragment ? (fragments[st.fragment] || {})[st.id] || {} : {};
    for (const t of st.transitions || body.transitions || []) {
      if (typeof t.goto !== 'string') continue;
      if (t.goto === 'end' || t.goto === 'fail') { toEnd.add(from); continue; }
      const to = stageOf[t.goto];
      if (to === undefined || to === from) continue;
      const m = to > from ? forward : back, k = `${from}>${to}`;
      m.set(k, (m.get(k) || 0) + 1);
    }
  }
  // layout: rows of chips
  const x0 = 60, x1 = W - 60, chipH = 48, chipGap = 10, rowGap = 40, pad = 16, titleH = 34;
  const charW = 8.2, size = 14;
  const rows = stages.map((g) => {
    const chips = g.steps.map((id) => {
      const [kind, color, who] = stepKind(byId[id], fragments);
      const label = who.length > 20 ? who.slice(0, 19) + '…' : who;
      return { id, kind, color, who: label, w: Math.max(id.length * charW, label.length * 7) + 2 * pad };
    });
    let x = 0, line = 0;
    for (const c of chips) {
      if (x + c.w > x1 - x0 - 2 * pad && x > 0) { x = 0; line++; }
      c.x = x; c.line = line; x += c.w + chipGap;
    }
    return { ...g, chips, h: titleH + (line + 1) * (chipH + chipGap) + pad - chipGap };
  });
  const H = 24 + rows.reduce((n, r) => n + r.h + rowGap, 0) - rowGap + 110;
  const s = new Svg(H);
  let y = 24;
  const rowY = [];
  rows.forEach((r, i) => {
    rowY.push([y, y + r.h]);
    s.rect(x0, y, x1 - x0, r.h, { r: 10 });
    s.text(x0 + pad, y + 23, r.name.toUpperCase(), { fill: C.muted, size: 12.5, weight: 700, spacing: 1.2 });
    if (toEnd.has(i)) s.text(x1 - pad, y + 23, '→ end', { fill: C.green, size: 13, weight: 700, anchor: 'end' });
    for (const c of r.chips) {
      const cx = x0 + pad + c.x, cy = y + titleH + c.line * (chipH + chipGap);
      s.rect(cx, cy, c.w, chipH, { stroke: c.color, opacity: .8, r: 8, fill: '#1b1f29' });
      s.text(cx + c.w / 2, cy + 20, c.id, { size, weight: 600, mono: true, anchor: 'middle' });
      s.text(cx + c.w / 2, cy + 38, c.who, { fill: c.color, size: 12.5, anchor: 'middle' });
    }
    if (i < rows.length - 1) {
      const n = forward.get(`${i}>${i + 1}`) || 0;
      s.arrow(W / 2, y + r.h + 3, W / 2, y + r.h + rowGap - 3, { color: n ? C.muted : C.border });
    }
    y += r.h + rowGap;
  });
  // forward skips on the right, back edges on the left (one arc per pair, its count as a label)
  let k = 0;
  for (const [key, n] of forward) {
    const [a, b] = key.split('>').map(Number);
    if (b === a + 1) continue;
    const x = x1 + 14 + (k++ % 3) * 14;
    s.path(`M ${x1} ${rowY[a][1] - 16} H ${x} V ${rowY[b][0] + 16} H ${x1 + 3}`, { color: C.muted });
  }
  k = 0;
  for (const [key, n] of back) {
    const [a, b] = key.split('>').map(Number);
    const x = x0 - 14 - (k++ % 3) * 14;
    s.path(`M ${x0} ${rowY[a][0] + 16} H ${x} V ${rowY[b][1] - 16} H ${x0 - 3}`, { color: C.orange });
    s.text(x - 4, (rowY[a][0] + rowY[b][1]) / 2 + 4, n > 1 ? `×${n}` : '', { fill: C.orange, size: 11.5, anchor: 'end' });
  }
  // legend
  const ly = H - 56;
  s.text(x0, ly, 'Stages top to bottom · a step is a chip:', { fill: C.muted, size: 13.5 });
  const legend = [[C.purple, 'an agent'], [C.yellow, 'you (a gate)'], [C.green, 'no model'], [C.accent, 'child runs'], [C.orange, 'back to an earlier stage']];
  let lx = x0;
  for (const [c, t] of legend) {
    s.parts.push(`<rect x="${lx}" y="${ly + 14}" width="12" height="12" rx="3" fill="${c}"/>`);
    s.text(lx + 18, ly + 25, t, { fill: C.muted, size: 13 });
    lx += 18 + t.length * 7 + 22;
  }
  s.text(x0, ly + 50, `${w.steps.length} steps · ${Object.keys(w.agents || {}).length} agents · gates: ${w.steps.filter((st) => st.type === 'human_approval').length}`, { fill: C.muted, size: 13 });
  s.write(`wf-${file.replace(/\.yaml$/, '')}.svg`);
}

fs.mkdirSync(OUT, { recursive: true });
repoMap(); architecture(); workflowAnatomy(); runLoop(); writerReviewer();
const workflowFiles = fs.readdirSync(path.join(ROOT, 'workflows')).filter((f) => f.endsWith('.yaml')).sort();
for (const f of workflowFiles) workflowGraph(f);
console.log(`${5 + workflowFiles.length} diagrams → docs/site/assets/`);
