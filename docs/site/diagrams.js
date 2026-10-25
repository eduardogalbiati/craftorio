#!/usr/bin/env node
// The documentation site's diagrams, written as SVG into docs/site/assets/ (run by
// scripts/docs-site.js before the pages, or alone: `node docs/site/diagrams.js`). One function per
// diagram, drawn on the app's theme tokens with a 1000-wide view box and 15–17px text, so the text
// reads at the content column's width. Add a diagram here, never an SVG by hand.
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'assets');
const C = { bg: '#0e1014', panel: '#151820', border: '#262b37', text: '#e6e8ee', muted: '#8a91a3', accent: '#7c9cff',
  green: '#4ade80', yellow: '#facc15', red: '#f87171', purple: '#c084fc', orange: '#fb923c', info: '#7dd3fc' };
const SANS = 'Segoe UI, system-ui, sans-serif';
const MONO = 'Cascadia Code, Consolas, SF Mono, Menlo, monospace';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MARKERS = { [C.muted]: 'g', [C.green]: 'ok', [C.orange]: 'warn', [C.red]: 'bad', [C.accent]: 'acc' };

class Svg {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" font-family="${SANS}" font-size="15">`,
      `<rect width="${w}" height="${h}" rx="12" fill="${C.bg}"/>`,
      '<defs>' + Object.entries(MARKERS).map(([c, n]) => `<marker id="a-${n}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`).join('') + '</defs>'];
  }
  text(x, y, s, { fill = C.text, size = 15, weight = 400, anchor = 'start', mono = false, spacing = 0 } = {}) {
    this.parts.push(`<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}"${mono ? ` font-family="${MONO}"` : ''}${spacing ? ` letter-spacing="${spacing}"` : ''}>${esc(s)}</text>`);
  }
  rect(x, y, w, h, { stroke = C.border, fill = C.panel, r = 10, opacity = 1 } = {}) {
    this.parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-opacity="${opacity}"/>`);
  }
  // a titled box: a coloured title, a muted subtitle, mono lines
  box(x, y, w, h, color, title, sub, lines = []) {
    this.rect(x, y, w, h, { stroke: color, opacity: .7 });
    this.text(x + 16, y + 28, title, { fill: color, size: 16, weight: 700 });
    let yy = y + 28;
    if (sub) { yy += 22; this.text(x + 16, yy, sub, { fill: C.muted, size: 14 }); }
    for (const l of lines) { yy += 21; this.text(x + 16, yy, l, { size: 14, mono: true }); }
  }
  arrow(x1, y1, x2, y2, { color = C.muted, label, dash = false } = {}) {
    this.parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.8"${dash ? ' stroke-dasharray="6 5"' : ''} marker-end="url(#a-${MARKERS[color] || 'g'})"/>`);
    if (label) this.text((x1 + x2) / 2, (y1 + y2) / 2 - 9, label, { fill: color, size: 13, anchor: 'middle' });
  }
  path(d, { color = C.muted, dash = false } = {}) {
    this.parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="1.8"${dash ? ' stroke-dasharray="6 5"' : ''} marker-end="url(#a-${MARKERS[color] || 'g'})"/>`);
  }
  write(name) {
    this.parts.push('</svg>');
    fs.writeFileSync(path.join(OUT, name), this.parts.join('\n') + '\n');
  }
}

// ---------- repo-map: the repository's folders, by layer ----------
function repoMap() {
  const rows = [
    ['What you run', C.accent, [['apps/desktop', 'the Electron app'], ['apps/web', 'the same UI in a browser']]],
    ['The UI', C.purple, [['packages/ui-kit', 'shell, controls, Home, Settings'], ['fronts/<id>', 'one folder per screen family']]],
    ['The engine', C.green, [['packages/engine', 'runs the graph, service, server'], ['packages/shared', 'code both sides use'], ['native', 'Rust sidecars']]],
    ['What agents run', C.orange, [['workflows', 'the YAML workflows'], ['fragments', 'shared step groups'], ['pipelines', 'workflow chains'], ['skills', 'per capability'], ['seeds', 'analysis seeds']]],
    ['Tooling', C.muted, [['scripts', 'run, test, build, docs'], ['test', 'unit tests'], ['features', 'E2E (Playwright)'], ['.github', 'CI and deploy']]],
    ['Docs', C.info, [['README.md', 'user docs'], ['docs/agents', 'for coding agents'], ['docs/site', 'this site'], ['poc', 'proofs of concept']]],
  ];
  const W = 1000, x0 = 190, rowH = 98, boxH = 64, gap = 10;
  const s = new Svg(W, 28 + rowH * rows.length);
  let y = 28;
  for (const [label, color, boxes] of rows) {
    s.text(24, y + boxH / 2 + 5, label.toUpperCase(), { fill: color, size: 12.5, weight: 700, spacing: 1.2 });
    const bw = (W - x0 - 24 - gap * (boxes.length - 1)) / boxes.length;
    let x = x0;
    for (const [name, what] of boxes) {
      s.rect(x, y, bw, boxH, { r: 8 });
      s.parts.push(`<rect x="${x}" y="${y}" width="3" height="${boxH}" rx="1.5" fill="${color}"/>`);
      s.text(x + 16, y + 26, name, { size: 14.5, weight: 600, mono: true });
      s.text(x + 16, y + 48, what, { fill: C.muted, size: 13.5 });
      x += bw + gap;
    }
    y += rowH;
  }
  s.write('repo-map.svg');
}

// ---------- architecture: the four layers at run time ----------
function architecture() {
  const boxes = [['UI', 'packages/ui-kit + fronts', 'desktop window or browser', C.purple],
    ['Service', 'packages/engine/service', 'channels, one per area', C.accent],
    ['Engine', 'packages/engine/engine', 'walks the workflow graph', C.green],
    ['Agent CLIs', 'claude · codex · grok', 'one headless process per turn', C.orange]];
  const links = ['window.api (IPC or HTTP/WS)', 'calls', 'spawns'];
  const W = 1000, H = 230, bw = 205, bh = 108, gapx = (W - 48 - bw * 4) / 3, y = 44;
  const s = new Svg(W, H);
  boxes.forEach(([t, sub, what, c], i) => {
    const x = 24 + i * (bw + gapx);
    s.rect(x, y, bw, bh, { stroke: c, opacity: .7 });
    s.text(x + bw / 2, y + 36, t, { fill: c, size: 18, weight: 700, anchor: 'middle' });
    s.text(x + bw / 2, y + 62, sub, { size: 13.5, mono: true, anchor: 'middle' });
    s.text(x + bw / 2, y + 86, what, { fill: C.muted, size: 13.5, anchor: 'middle' });
    if (i < 3) s.arrow(x + bw + 4, y + bh / 2, x + bw + gapx - 4, y + bh / 2, { label: links[i] });
  });
  s.text(W / 2, H - 26, 'Everything a run produces is written to <workspace>/runs/<run>/ · the workspace is the product', { fill: C.muted, size: 14, anchor: 'middle' });
  s.write('architecture.svg');
}

// ---------- engine-workflow-anatomy: the parts of a workflow YAML ----------
function workflowAnatomy() {
  const W = 1000, gap = 16, colW = (W - 48 - gap * 2) / 3;
  const s = new Svg(W, 400);
  s.box(24, 24, colW, 148, C.info, 'inputs', 'what the user fills in at Start', ['prompt, goal, max_rounds', 'writer_provider, writer_model']);
  s.box(24 + colW + gap, 24, colW, 148, C.purple, 'agents', 'who works, with which CLI and rules', ['writer: provider, model, session,', '  skills, capabilities, system_prompt', 'reviewer: …']);
  s.box(24 + (colW + gap) * 2, 24, colW, 148, C.muted, 'providers · defaults · orchestrator', 'how the CLIs are called, limits', ['claude / codex / grok flags', 'timeout, max_context, retry', 'supervisor: max_interventions']);
  s.box(24, 196, W - 48, 180, C.accent, 'steps', 'the graph: each step says who runs, what it is asked, what it must answer, and where to go next', [
    '- id: review   agent: reviewer   prompt: | … {{ steps.write.output.document }} …',
    '  output_schema: { score, summary, notes }',
    '  transitions:',
    '    - { when: "output.score >= inputs.threshold", goto: signoff }',
    '    - { when: "true", goto: write, loop: { max_iterations: 4, on_exhausted: out_of_rounds } }']);
  s.write('engine-workflow-anatomy.svg');
}

// ---------- engine-run-loop: one visit of a step ----------
function runLoop() {
  const steps = [['Pick the step', C.accent, 'by the last transition'], ['Render the prompt', C.accent, 'inputs, outputs, feedback'],
    ['Agent turn', C.orange, 'one headless CLI process'], ['Check the answer', C.green, 'output_schema, retries'], ['Transitions', C.accent, 'when → goto, loops']];
  const W = 1000, bw = 172, gap = (W - 48 - bw * 5) / 4, y = 74, bh = 92;
  const s = new Svg(W, 346);
  s.text(24, 44, 'One visit of a step', { size: 17, weight: 600 });
  steps.forEach(([t, c, sub], i) => {
    const x = 24 + i * (bw + gap);
    s.rect(x, y, bw, bh, { stroke: c, opacity: .7 });
    s.text(x + bw / 2, y + 38, t, { fill: c, size: 15.5, weight: 700, anchor: 'middle' });
    s.text(x + bw / 2, y + 64, sub, { fill: C.muted, size: 13, anchor: 'middle' });
    if (i < 4) s.arrow(x + bw + 3, y + bh / 2, x + bw + gap - 3, y + bh / 2);
  });
  s.path(`M ${24 + 4 * (bw + gap) + bw / 2} ${y + bh} V ${y + bh + 44} H ${24 + bw / 2} V ${y + bh + 2}`);
  s.text(W / 2, y + bh + 38, 'next step · the same step again (a visit) · a human gate (the run waits) · end', { fill: C.muted, size: 13.5, anchor: 'middle' });
  const ny = 262, nw = (W - 48 - 16) / 2;
  s.rect(24, ny, nw, 60, { r: 8 });
  s.text(40, ny + 25, 'On a failure', { fill: C.red, size: 14.5, weight: 700 });
  s.text(40, ny + 47, 'the supervisor is called, a few times per step at most; never for a gate', { fill: C.muted, size: 13.5 });
  s.rect(24 + nw + 16, ny, nw, 60, { r: 8 });
  s.text(40 + nw + 16, ny + 25, 'Everything is recorded', { fill: C.green, size: 14.5, weight: 700 });
  s.text(40 + nw + 16, ny + 47, 'events.jsonl, summary.json, sessions, handoffs, evidence', { fill: C.muted, size: 13.5 });
  s.write('engine-run-loop.svg');
}

// ---------- engine-writer-reviewer: the example graph ----------
function writerReviewer() {
  const W = 1000, nw = 150, nh = 64;
  const s = new Svg(W, 330);
  s.text(24, 40, 'workflows/writer-reviewer.yaml', { size: 17, weight: 600 });
  s.text(24, 62, "the engine decides by the reviewer's score; two steps are human gates (yellow)", { fill: C.muted, size: 13.5 });
  const nodes = { write: [60, 96, C.purple, 'writer'], review: [310, 96, C.purple, 'reviewer'], signoff: [560, 96, C.accent, 'supervisor'], decide: [810, 96, C.yellow, 'you'], out_of_rounds: [310, 210, C.yellow, 'you'] };
  for (const [id, [x, y, c, who]] of Object.entries(nodes)) {
    s.rect(x, y, nw, nh, { stroke: c, opacity: .8 });
    s.text(x + nw / 2, y + 28, id, { size: 15, weight: 600, mono: true, anchor: 'middle' });
    s.text(x + nw / 2, y + 50, who, { fill: c, size: 13.5, anchor: 'middle' });
  }
  const y = 96 + nh / 2;
  s.arrow(60 + nw, y, 310, y);
  s.arrow(310 + nw, y, 560, y, { color: C.green });
  s.text(510, y - 12, 'score ≥ threshold', { fill: C.green, size: 12.5, anchor: 'middle' });
  s.arrow(560 + nw, y, 810, y);
  s.path(`M ${310 + 90} ${96 + nh} V 182 H ${60 + 75} V ${96 + nh + 2}`, { color: C.orange });
  s.text(255, 176, 'below threshold · up to max_rounds', { fill: C.orange, size: 13, anchor: 'middle' });
  s.arrow(310 + 120, 96 + nh, 310 + 120, 210, { color: C.red });
  s.text(310 + 130, 200, 'rounds used up', { fill: C.red, size: 13 });
  s.path(`M ${810 + 75} ${96 + nh} V 300 H ${60 + 40} V ${96 + nh + 2}`, { dash: true });
  s.text(640, 294, 'revise: your instructions go into every next prompt', { fill: C.muted, size: 13, anchor: 'middle' });
  s.arrow(810 + nw, y, W - 14, y, { color: C.green });
  s.text(810 + nw + 2, y + 22, 'accept', { fill: C.green, size: 12.5 });
  s.write('engine-writer-reviewer.svg');
}

fs.mkdirSync(OUT, { recursive: true });
repoMap(); architecture(); workflowAnatomy(); runLoop(); writerReviewer();
console.log('5 diagrams → docs/site/assets/');
