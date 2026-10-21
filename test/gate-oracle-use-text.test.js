// #183 review round 1: "Use this text" (window.GateOracle.useText, src/renderer/gate-oracle.js) in the
// browser. The module's browser half runs in a vm sandbox (no `module`, so it takes the window branch)
// over a small fake DOM: elements with classes, attributes, a parent and children, enough for
// querySelector(All) / closest with simple selectors (tag, .class, [attr="v"], comma lists).
// Covered: the text goes to the gate card on screen, never to the same gate's card on a hidden screen;
// a gate whose run is not on screen opens the run and fills the box once the screen is drawn; a gate
// with no card even then gets the "no feedback box" toast. The gate is never answered.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('./i18n-sandbox');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'gate-oracle.js'), 'utf8');

// ---- fake DOM ----------------------------------------------------------------------------------
function matchesOne(el, sel) {
  const m = sel.trim().match(/^([a-z]+)?((?:\.[\w-]+)*)(?:\[([\w-]+)="([^"]*)"\])?$/i);
  if (!m) throw new Error(`fake DOM: unsupported selector ${sel}`);
  const [, tag, classes, attr, val] = m;
  if (tag && el.tag !== tag.toLowerCase()) return false;
  for (const c of classes.split('.').filter(Boolean)) if (!el.classes.has(c)) return false;
  if (attr && el.attrs[attr] !== val) return false;
  return true;
}
const matches = (el, sel) => sel.split(',').some((s) => matchesOne(el, s));

class El {
  constructor(tag, { cls = '', attrs = {} } = {}, children = []) {
    Object.assign(this, { tag, classes: new Set(cls.split(' ').filter(Boolean)), attrs, children: [], parent: null, value: '', disabled: false, events: [] });
    children.forEach((c) => this.append(c));
  }
  append(c) { c.parent = this; this.children.push(c); return c; }
  get dataset() {
    const d = {};
    for (const [k, v] of Object.entries(this.attrs)) if (k.startsWith('data-')) d[k.slice(5).replace(/-(\w)/g, (_, x) => x.toUpperCase())] = v;
    return d;
  }
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
  querySelectorAll(sel) { return [...this.walk()].filter((e) => matches(e, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { for (let e = this; e; e = e.parent) if (e.tag && matches(e, sel)) return e; return null; }
  dispatchEvent(ev) { this.events.push(ev.type); return true; }
  focus() {}
}

// a gate card as the renderers draw it: the Oracle button and the feedback box
const card = (cls, approvalId) => new El('div', { cls, attrs: { 'data-gate': approvalId } }, [
  new El('textarea', { cls: 'duo-ask-text' }),
  new El('button', { cls: 'btn', attrs: { 'data-choice': 'changes' } }),
  new El('button', { cls: 'btn gate-oracle', attrs: { 'data-gate-oracle': approvalId, 'data-run': 'R1', 'data-step': 'developer_check' } }),
]);

function sandbox({ body, runs = new Map(), onSelectRun = () => {} }) {
  const frames = [];
  const toasts = [];
  const selected = [];
  const answered = [];
  const doc = new El('#document', {}, [body]);
  doc.addEventListener = () => {};
  doc.createElement = (tag) => new El(tag);
  const ctx = {
    document: doc,
    CSS: { escape: (s) => String(s) },
    Event: class { constructor(type) { this.type = type; } },
    state: { runs },
    showToast: (title) => toasts.push(title),
    selectRun: (id) => { selected.push(id); onSelectRun(id, frames); },
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    api: { resolveApproval: (...a) => answered.push(a) },
  };
  ctx.window = ctx;
  withI18n(ctx);
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'gate-oracle.js' });
  const flushFrames = () => { while (frames.length) frames.shift()(); };
  return { GateOracle: ctx.GateOracle, toasts, selected, answered, flushFrames };
}

test('#183 Use this text fills the gate card on screen, not the same gate\'s card on the hidden Run screen', () => {
  const hidden = card('run-gate', 'A1');
  const visible = card('duo-ask', 'A1');
  const body = new El('body', {}, [
    new El('section', { cls: 'view hidden', attrs: { id: 'view-run' } }, [hidden]),
    new El('section', { cls: 'view', attrs: { id: 'view-runchat' } }, [visible]),
  ]);
  const s = sandbox({ body });
  s.GateOracle.useText('gate:A1', 'Please also change software-development-local-hero.yaml');
  assert.equal(visible.querySelector('textarea').value, 'Please also change software-development-local-hero.yaml');
  assert.equal(hidden.querySelector('textarea').value, '');
  assert.deepEqual(s.toasts, []);
  assert.deepEqual(s.answered, [], 'the gate is never answered');
});

test('#183 Use this text for a gate whose run is not on screen opens the run and fills its box once it is drawn', () => {
  const view = new El('section', { cls: 'view', attrs: { id: 'view-run' } });
  const body = new El('body', {}, [view]);
  const runs = new Map([['R1', { approvals: new Map([['A1', { approval_id: 'A1' }]]) }]]);
  let drawn = null;
  // like scheduleRender: opening the run draws its gate card in the next frame
  const s = sandbox({ body, runs, onSelectRun: (id, frames) => frames.push(() => { drawn = view.append(card('run-gate', 'A1')); }) });
  s.GateOracle.useText('gate:A1', 'Add the missing scenario');
  assert.deepEqual(s.selected, ['R1']);
  s.flushFrames();
  assert.ok(drawn, 'the run was drawn');
  assert.equal(drawn.querySelector('textarea').value, 'Add the missing scenario');
  assert.deepEqual(s.toasts, []);
  assert.deepEqual(s.answered, []);
});

test('#183 Use this text says there is no feedback box when the gate card is still missing after the run is drawn', () => {
  const body = new El('body', {}, [new El('section', { cls: 'view' })]);
  const runs = new Map([['R1', { approvals: new Map([['A1', { approval_id: 'A1' }]]) }]]);
  const s = sandbox({ body, runs });
  s.GateOracle.useText('gate:A1', 'Add the missing scenario');
  s.flushFrames();
  assert.equal(s.toasts.length, 1);
  assert.match(s.toasts[0], /no feedback box/i);
});
