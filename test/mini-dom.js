// A test helper (not a test): a small real DOM for renderer tests that need markup parsed into
// elements (the shared agent chat of #274, src/renderer/agent-chat.js, and the drawers that render
// through it). Unlike test/renderer-app-harness.js (one fake element per selector, nothing parsed),
// this one builds a tree: `innerHTML` / `insertAdjacentHTML` parse the markup (a forgiving parser
// good for the app's own templates: void elements, raw text in <textarea>/<script>/<style>, entities),
// `querySelector(All)` / `matches` / `closest` understand compound selectors (tag, #id, .class,
// [attr], [attr="v"], ^= $= *= ~=, :not(), :first-child, :last-child, :checked, :disabled, :enabled)
// joined by descendant, `>`, `+` and `~` combinators, and events bubble from the target through its
// ancestors to the document and the window (listeners, then the `on<type>` property). A click on a
// disabled control does nothing; a click on a submit button inside a <form> fires the form's
// `submit`. Form controls keep a live `value` (textarea: its text until set), `checked`, `disabled`.
// No layout: scrollTop is a plain number, scrollHeight / clientHeight (and the other metrics) are 0
// unless a test sets them on an element or redefines them on classes.Element.prototype (elements the
// code creates later get them too); scrollTo({ top }) sets scrollTop and scrollIntoView() is recorded
// (`el.scrolledIntoView`). Usage: const { document, window } = createDom({ window: sandbox }).
'use strict';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
const BOOL_ATTRS = { disabled: 'disabled', hidden: 'hidden', readOnly: 'readonly', required: 'required', multiple: 'multiple', open: 'open', autofocus: 'autofocus', noValidate: 'novalidate' };
const STR_ATTRS = { title: 'title', name: 'name', placeholder: 'placeholder', href: 'href', src: 'src', alt: 'alt', htmlFor: 'for', rel: 'rel', target: 'target', lang: 'lang', dir: 'dir', accept: 'accept', autocomplete: 'autocomplete', download: 'download', min: 'min', max: 'max', step: 'step', pattern: 'pattern' };
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', middot: '·', mdash: '—', ndash: '–', rarr: '→', larr: '←', times: '×', check: '✓', copy: '©', bull: '•', laquo: '«', raquo: '»' };

const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return Object.hasOwn(ENTITIES, e) ? ENTITIES[e] : m;
});
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function createDom({ window: win = {} } = {}) {
  // ---- events ---------------------------------------------------------------------------------
  class Event {
    constructor(type, init = {}) {
      this.type = type;
      this.bubbles = !!init.bubbles;
      this.cancelable = !!init.cancelable;
      this.defaultPrevented = false;
      this.target = null;
      this.currentTarget = null;
      this.isTrusted = false;
      this.timeStamp = Date.now();
      for (const [k, v] of Object.entries(init)) if (!(k in this)) this[k] = v;
    }
    preventDefault() { if (this.cancelable !== false) this.defaultPrevented = true; }
    stopPropagation() { this._stop = true; }
    stopImmediatePropagation() { this._stop = true; this._stopNow = true; }
    composedPath() { return this._path || []; }
  }
  class CustomEvent extends Event { constructor(type, init = {}) { super(type, init); this.detail = init.detail; } }
  class UIEvent extends Event {}
  class MouseEvent extends UIEvent { constructor(type, init = {}) { super(type, { button: 0, ...init }); } }
  class KeyboardEvent extends UIEvent { constructor(type, init = {}) { super(type, { key: '', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...init }); } }
  class InputEvent extends UIEvent {}
  class FocusEvent extends UIEvent {}

  class EventTarget {
    constructor() { this._listeners = {}; }
    addEventListener(type, fn, opts) {
      if (!fn) return;
      const list = (this._listeners[type] ||= []);
      if (!list.some((l) => l.fn === fn)) list.push({ fn, once: !!(opts && opts.once) });
    }
    removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter((l) => l.fn !== fn); }
    _fire(ev) {
      ev.currentTarget = this;
      for (const l of [...(this._listeners[ev.type] || [])]) {
        if (l.once) this.removeEventListener(ev.type, l.fn);
        try { typeof l.fn === 'function' ? l.fn.call(this, ev) : l.fn.handleEvent(ev); } catch (e) { reportError(e); }
        if (ev._stopNow) return;
      }
      const prop = this[`on${ev.type}`];
      if (typeof prop === 'function') {
        try { if (prop.call(this, ev) === false) ev.preventDefault(); } catch (e) { reportError(e); }
      }
    }
    dispatchEvent(ev) {
      ev.target = this;
      const path = [this];
      if (ev.bubbles) {
        let cur = this.parentNode;
        while (cur) { path.push(cur); cur = cur.parentNode; }
        if (path.at(-1) === document && windowTarget) path.push(windowTarget);
      }
      ev._path = path;
      for (const node of path) {
        node._fire(ev);
        if (ev._stop) break;
      }
      ev.currentTarget = null;
      return !ev.defaultPrevented;
    }
  }

  const errors = [];
  function reportError(e) { errors.push(e); }

  // ---- nodes ----------------------------------------------------------------------------------
  class Node extends EventTarget {
    constructor() { super(); this.parentNode = null; this.childNodes = []; }
    get ownerDocument() { return this.nodeType === 9 ? null : document; }
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
    get firstChild() { return this.childNodes[0] || null; }
    get lastChild() { return this.childNodes.at(-1) || null; }
    get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
    get previousSibling() { const p = this.parentNode; if (!p) return null; const i = p.childNodes.indexOf(this); return i > 0 ? p.childNodes[i - 1] : null; }
    get isConnected() { let cur = this; while (cur) { if (cur === document) return true; cur = cur.parentNode; } return false; }
    get textContent() { return this.childNodes.map((c) => (c.nodeType === 8 ? '' : c.textContent)).join(''); }
    set textContent(v) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; const s = v == null ? '' : String(v); if (s) this.appendChild(new Text(s)); }
    hasChildNodes() { return this.childNodes.length > 0; }
    contains(n) { let cur = n; while (cur) { if (cur === this) return true; cur = cur.parentNode; } return false; }
    _adopt(n) {
      if (n == null) return [];
      if (typeof n === 'string') return [new Text(n)];
      if (n.nodeType === 11) { const kids = [...n.childNodes]; n.childNodes = []; for (const k of kids) k.parentNode = null; return kids; }
      if (n.parentNode) n.parentNode.removeChild(n);
      return [n];
    }
    appendChild(n) { for (const k of this._adopt(n)) { k.parentNode = this; this.childNodes.push(k); } return n; }
    insertBefore(n, ref) {
      if (!ref) return this.appendChild(n);
      const kids = this._adopt(n);
      const i = this.childNodes.indexOf(ref);
      for (const k of kids) k.parentNode = this;
      this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, ...kids);
      return n;
    }
    removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) { this.childNodes.splice(i, 1); n.parentNode = null; } return n; }
    replaceChild(n, old) { this.insertBefore(n, old); return this.removeChild(old); }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    append(...nodes) { for (const n of nodes) this.appendChild(typeof n === 'string' ? new Text(n) : n); }
    prepend(...nodes) { const first = this.firstChild; for (const n of nodes) this.insertBefore(typeof n === 'string' ? new Text(n) : n, first); }
    before(...nodes) { const p = this.parentNode; if (p) for (const n of nodes) p.insertBefore(typeof n === 'string' ? new Text(n) : n, this); }
    after(...nodes) { const p = this.parentNode; if (!p) return; const next = this.nextSibling; for (const n of nodes) p.insertBefore(typeof n === 'string' ? new Text(n) : n, next); }
    replaceWith(...nodes) { const p = this.parentNode; if (!p) return; this.before(...nodes); p.removeChild(this); }
    replaceChildren(...nodes) { this.textContent = ''; this.append(...nodes); }
  }

  class Text extends Node {
    constructor(data) { super(); this.nodeType = 3; this.nodeName = '#text'; this.data = String(data); }
    get textContent() { return this.data; }
    set textContent(v) { this.data = String(v ?? ''); }
    get nodeValue() { return this.data; }
    cloneNode() { return new Text(this.data); }
  }
  class Comment extends Node {
    constructor(data) { super(); this.nodeType = 8; this.nodeName = '#comment'; this.data = String(data); }
    get textContent() { return ''; }
    cloneNode() { return new Comment(this.data); }
  }

  // children, selectors and markup, shared by elements, fragments and the document
  const ParentMixin = (Base) => class extends Base {
    get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
    get childElementCount() { return this.children.length; }
    get firstElementChild() { return this.children[0] || null; }
    get lastElementChild() { return this.children.at(-1) || null; }
    _descendants() { const out = []; const walk = (n) => { for (const c of n.childNodes) if (c.nodeType === 1) { out.push(c); walk(c); } }; walk(this); return out; }
    querySelectorAll(sel) { const groups = parseSelector(sel); return this._descendants().filter((el) => groups.some((g) => matchComplex(el, g, this))); }
    querySelector(sel) { const groups = parseSelector(sel); return this._descendants().find((el) => groups.some((g) => matchComplex(el, g, this))) || null; }
    getElementsByTagName(tag) { const t = String(tag).toLowerCase(); return this._descendants().filter((el) => t === '*' || el.localName === t); }
    getElementsByClassName(cls) { const want = String(cls).split(/\s+/).filter(Boolean); return this._descendants().filter((el) => want.every((c) => el.classList.contains(c))); }
    getElementById(id) { return this._descendants().find((el) => el.id === id) || null; }
  };

  class DocumentFragment extends ParentMixin(Node) {
    constructor() { super(); this.nodeType = 11; this.nodeName = '#document-fragment'; }
    get innerHTML() { return this.childNodes.map(serialize).join(''); }
    cloneNode(deep) { const f = new DocumentFragment(); if (deep) for (const c of this.childNodes) f.appendChild(c.cloneNode(true)); return f; }
  }

  function classListOf(el) {
    const read = () => (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    const write = (list) => el.setAttribute('class', [...new Set(list)].join(' '));
    return {
      add: (...c) => write([...read(), ...c]),
      remove: (...c) => write(read().filter((x) => !c.includes(x))),
      toggle: (c, force) => { const has = read().includes(c); const on = force === undefined ? !has : !!force; if (on && !has) write([...read(), c]); if (!on && has) write(read().filter((x) => x !== c)); return on; },
      contains: (c) => read().includes(c),
      replace: (a, b) => { const list = read(); const i = list.indexOf(a); if (i < 0) return false; list[i] = b; write(list); return true; },
      item: (i) => read()[i] ?? null,
      forEach: (fn) => read().forEach(fn),
      get length() { return read().length; },
      get value() { return read().join(' '); },
      toString: () => read().join(' '),
      [Symbol.iterator]: () => read()[Symbol.iterator](),
    };
  }

  function datasetOf(el) {
    return new Proxy({}, {
      get: (_t, k) => (typeof k === 'string' ? el.getAttribute(`data-${kebab(k)}`) ?? undefined : undefined),
      set: (_t, k, v) => { el.setAttribute(`data-${kebab(String(k))}`, String(v)); return true; },
      has: (_t, k) => typeof k === 'string' && el.hasAttribute(`data-${kebab(k)}`),
      deleteProperty: (_t, k) => { el.removeAttribute(`data-${kebab(String(k))}`); return true; },
      ownKeys: () => Object.keys(el._attrs).filter((a) => a.startsWith('data-')).map((a) => camel(a.slice(5))),
      getOwnPropertyDescriptor: (_t, k) => (typeof k === 'string' && el.hasAttribute(`data-${kebab(k)}`)
        ? { value: el.getAttribute(`data-${kebab(k)}`), writable: true, enumerable: true, configurable: true } : undefined),
    });
  }

  function styleOf() {
    const s = {
      setProperty(k, v) { s[k] = String(v); },
      removeProperty(k) { const v = s[k]; delete s[k]; return v ?? ''; },
      getPropertyValue(k) { return s[k] ?? ''; },
      cssText: '',
    };
    return s;
  }

  class Element extends ParentMixin(Node) {
    constructor(tag) {
      super();
      this.nodeType = 1;
      this.localName = String(tag).toLowerCase();
      this.tagName = this.localName.toUpperCase();
      this.nodeName = this.tagName;
      this._attrs = {};
      this.classList = classListOf(this);
      this.dataset = datasetOf(this);
      this.style = styleOf();
      this.scrollTop = 0;
      this.scrollLeft = 0;
      this.selectionStart = 0;
      this.selectionEnd = 0;
      this.scrolledIntoView = false;
    }
    // attributes
    getAttribute(k) { const n = String(k).toLowerCase(); return Object.hasOwn(this._attrs, n) ? this._attrs[n] : null; }
    setAttribute(k, v) { this._attrs[String(k).toLowerCase()] = String(v); }
    removeAttribute(k) { delete this._attrs[String(k).toLowerCase()]; }
    hasAttribute(k) { return Object.hasOwn(this._attrs, String(k).toLowerCase()); }
    toggleAttribute(k, force) { const on = force === undefined ? !this.hasAttribute(k) : !!force; if (on) this.setAttribute(k, ''); else this.removeAttribute(k); return on; }
    getAttributeNames() { return Object.keys(this._attrs); }
    get attributes() { return Object.entries(this._attrs).map(([name, value]) => ({ name, value })); }
    get id() { return this.getAttribute('id') || ''; }
    set id(v) { this.setAttribute('id', v); }
    get className() { return this.getAttribute('class') || ''; }
    set className(v) { this.setAttribute('class', v); }
    get type() {
      const t = this.getAttribute('type');
      if (this.localName === 'button') return t || 'submit';
      if (this.localName === 'input') return (t || 'text').toLowerCase();
      return t || '';
    }
    set type(v) { this.setAttribute('type', v); }
    get tabIndex() { return Number(this.getAttribute('tabindex') ?? -1); }
    set tabIndex(v) { this.setAttribute('tabindex', v); }
    // form controls
    get value() {
      if (this.localName === 'textarea') return this._value ?? this.textContent;
      if (this.localName === 'input') return this._value ?? this.getAttribute('value') ?? (/^(checkbox|radio)$/.test(this.type) ? 'on' : '');
      if (this.localName === 'select') { const o = this._selectedOption(); return o ? o.value : ''; }
      if (this.localName === 'option') return this.getAttribute('value') ?? this.textContent;
      if (this.localName === 'button') return this.getAttribute('value') ?? '';
      return this._value;
    }
    set value(v) {
      const s = v == null ? '' : String(v);
      if (this.localName === 'select') { for (const o of this.querySelectorAll('option')) o._selected = o.value === s; return; }
      if (this.localName === 'option' || this.localName === 'button') { this.setAttribute('value', s); return; }
      this._value = s;
      this.selectionStart = this.selectionEnd = s.length;
    }
    get defaultValue() { return this.localName === 'textarea' ? this.textContent : this.getAttribute('value') ?? ''; }
    set defaultValue(v) { if (this.localName === 'textarea') this.textContent = v; else this.setAttribute('value', v); }
    get checked() { return this._checked ?? this.hasAttribute('checked'); }
    set checked(v) { this._checked = !!v; }
    get selected() { return this._selected ?? this.hasAttribute('selected'); }
    set selected(v) { this._selected = !!v; }
    get options() { return this.querySelectorAll('option'); }
    get selectedIndex() { return this.options.indexOf(this._selectedOption()); }
    set selectedIndex(i) { this.options.forEach((o, n) => { o._selected = n === i; }); }
    _selectedOption() { const opts = this.querySelectorAll('option'); return opts.find((o) => o.selected) || opts[0] || null; }
    get form() { return this.closest('form'); }
    get elements() { return this.querySelectorAll('input, textarea, select, button'); }
    get labels() { return []; }
    get files() { return this._files || []; }
    set files(v) { this._files = v; }
    // markup
    get innerHTML() { return this.childNodes.map(serialize).join(''); }
    set innerHTML(html) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; for (const n of parseHtml(html, this.localName)) this.appendChild(n); }
    get outerHTML() { return serialize(this); }
    set outerHTML(html) { const p = this.parentNode; if (!p) return; for (const n of parseHtml(html)) p.insertBefore(n, this); p.removeChild(this); }
    get innerText() { return this.textContent; }
    set innerText(v) { this.textContent = v; }
    insertAdjacentHTML(pos, html) {
      const nodes = parseHtml(html, pos === 'beforebegin' || pos === 'afterend' ? this.parentNode?.localName : this.localName);
      this._insertAt(pos, nodes);
    }
    insertAdjacentElement(pos, el) { this._insertAt(pos, [el]); return el; }
    insertAdjacentText(pos, text) { this._insertAt(pos, [new Text(text)]); }
    _insertAt(pos, nodes) {
      const p = String(pos).toLowerCase();
      if (p === 'beforebegin') for (const n of nodes) this.parentNode?.insertBefore(n, this);
      else if (p === 'afterbegin') { const first = this.firstChild; for (const n of nodes) this.insertBefore(n, first); }
      else if (p === 'beforeend') for (const n of nodes) this.appendChild(n);
      else if (p === 'afterend') { const next = this.nextSibling; for (const n of nodes) this.parentNode?.insertBefore(n, next); }
    }
    get nextElementSibling() { const p = this.parentNode; if (!p) return null; const kids = p.children; return kids[kids.indexOf(this) + 1] || null; }
    get previousElementSibling() { const p = this.parentNode; if (!p) return null; const kids = p.children; const i = kids.indexOf(this); return i > 0 ? kids[i - 1] : null; }
    matches(sel) { return parseSelector(sel).some((g) => matchComplex(this, g, null)); }
    closest(sel) { const groups = parseSelector(sel); let cur = this; while (cur && cur.nodeType === 1) { if (groups.some((g) => matchComplex(cur, g, null))) return cur; cur = cur.parentNode; } return null; }
    cloneNode(deep) {
      const el = document.createElement(this.localName);
      Object.assign(el._attrs, this._attrs);
      if (this._value !== undefined) el._value = this._value;
      if (deep) for (const c of this.childNodes) el.appendChild(c.cloneNode(true));
      return el;
    }
    // behaviour
    click() {
      if (this.disabled) return;
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
      this.dispatchEvent(ev);
      if (ev.defaultPrevented) return;
      if (this.localName === 'input' && /^(checkbox|radio)$/.test(this.type)) { this.checked = this.type === 'radio' ? true : !this.checked; this.dispatchEvent(new Event('change', { bubbles: true })); }
      const form = this.closest('form');
      if (form && ((this.localName === 'button' && this.type === 'submit') || (this.localName === 'input' && this.type === 'submit'))) form.requestSubmit();
    }
    requestSubmit() { this.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
    submit() { this.requestSubmit(); }
    reset() { for (const el of this.elements) { delete el._value; delete el._checked; } }
    focus() { document.activeElement = this; this.dispatchEvent(new FocusEvent('focus')); this.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); }
    blur() { if (document.activeElement === this) document.activeElement = document.body; this.dispatchEvent(new FocusEvent('blur')); }
    select() {}
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
    setRangeText() {}
    scrollTo(x, y) { if (x && typeof x === 'object') { if ('top' in x) this.scrollTop = Number(x.top) || 0; if ('left' in x) this.scrollLeft = Number(x.left) || 0; } else { this.scrollLeft = Number(x) || 0; this.scrollTop = Number(y) || 0; } }
    scroll(x, y) { this.scrollTo(x, y); }
    scrollBy(x, y) { if (x && typeof x === 'object') this.scrollTop += Number(x.top) || 0; else this.scrollTop += Number(y) || 0; }
    scrollIntoView() { this.scrolledIntoView = true; }
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }; }
    getClientRects() { return []; }
    showModal() { this.setAttribute('open', ''); }
    show() { this.setAttribute('open', ''); }
    close() { this.removeAttribute('open'); }
    animate() { return { finished: Promise.resolve(), cancel() {}, onfinish: null }; }
    attachShadow() { return new DocumentFragment(); }
    checkValidity() { return true; }
    reportValidity() { return true; }
    setPointerCapture() {}
    releasePointerCapture() {}
  }
  for (const [prop, attr] of Object.entries(BOOL_ATTRS)) {
    Object.defineProperty(Element.prototype, prop, {
      get() { return this.hasAttribute(attr); },
      set(v) { if (v) this.setAttribute(attr, ''); else this.removeAttribute(attr); },
      configurable: true,
    });
  }
  // layout metrics: 0 unless set (on an element, or with an accessor on Element.prototype for every element)
  for (const prop of ['scrollHeight', 'scrollWidth', 'clientHeight', 'clientWidth', 'offsetHeight', 'offsetWidth', 'offsetTop', 'offsetLeft']) {
    const key = `_${prop}`;
    Object.defineProperty(Element.prototype, prop, {
      get() { return this[key] ?? 0; },
      set(v) { this[key] = Number(v) || 0; },
      configurable: true,
    });
  }
  for (const [prop, attr] of Object.entries(STR_ATTRS)) {
    Object.defineProperty(Element.prototype, prop, {
      get() { return this.getAttribute(attr) ?? ''; },
      set(v) { this.setAttribute(attr, v); },
      configurable: true,
    });
  }

  // ---- the parser and the serializer -----------------------------------------------------------
  const TAG = /^<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/;
  const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  function parseHtml(html, _context) {
    const root = new DocumentFragment();
    const stack = [root];
    const top = () => stack.at(-1);
    let s = String(html ?? '');
    let i = 0;
    while (i < s.length) {
      const lt = s.indexOf('<', i);
      if (lt < 0) { top().appendChild(new Text(decode(s.slice(i)))); break; }
      if (lt > i) top().appendChild(new Text(decode(s.slice(i, lt))));
      const rest = s.slice(lt);
      if (rest.startsWith('<!--')) { const end = s.indexOf('-->', lt + 4); top().appendChild(new Comment(s.slice(lt + 4, end < 0 ? s.length : end))); i = end < 0 ? s.length : end + 3; continue; }
      if (/^<!/i.test(rest)) { const end = s.indexOf('>', lt); i = end < 0 ? s.length : end + 1; continue; }
      const close = /^<\/([a-zA-Z][\w:-]*)\s*>/.exec(rest);
      if (close) {
        const name = close[1].toLowerCase();
        for (let k = stack.length - 1; k > 0; k--) if (stack[k].localName === name) { stack.length = k; break; }
        i = lt + close[0].length;
        continue;
      }
      const open = TAG.exec(rest);
      if (!open) { top().appendChild(new Text('<')); i = lt + 1; continue; }
      const name = open[1].toLowerCase();
      const el = document.createElement(name);
      for (const m of open[2].matchAll(ATTR)) el._attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
      top().appendChild(el);
      i = lt + open[0].length;
      if (VOID.has(name) || open[3]) continue;
      if (RAW.has(name)) {
        const endRe = new RegExp(`</${name}\\s*>`, 'i');
        const m = endRe.exec(s.slice(i));
        const body = m ? s.slice(i, i + m.index) : s.slice(i);
        if (body) el.appendChild(new Text(name === 'textarea' || name === 'title' ? decode(body) : body));
        i = m ? i + m.index + m[0].length : s.length;
        continue;
      }
      stack.push(el);
    }
    const nodes = [...root.childNodes];
    for (const n of nodes) n.parentNode = null;
    root.childNodes = [];
    return nodes;
  }

  function serialize(n) {
    if (n.nodeType === 3) return n.parentNode && RAW.has(n.parentNode.localName) && n.parentNode.localName !== 'textarea' ? n.data : escText(n.data);
    if (n.nodeType === 8) return `<!--${n.data}-->`;
    if (n.nodeType === 11) return n.childNodes.map(serialize).join('');
    const attrs = Object.entries(n._attrs).map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${escAttr(v)}"`)).join('');
    if (VOID.has(n.localName)) return `<${n.localName}${attrs}>`;
    return `<${n.localName}${attrs}>${n.childNodes.map(serialize).join('')}</${n.localName}>`;
  }

  // ---- selectors ------------------------------------------------------------------------------
  const selectorCache = new Map();
  function splitTop(s, sep) {
    const out = [];
    let depth = 0; let quote = null; let cur = '';
    for (const ch of s) {
      if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
      if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth--;
      cur += ch;
    }
    out.push(cur);
    return out;
  }
  // a complex selector: [{ compound, combinator }] from left to right; the combinator joins it to the previous
  function parseSelector(sel) {
    const key = String(sel);
    if (selectorCache.has(key)) return selectorCache.get(key);
    const groups = splitTop(key, ',').map((g) => g.trim()).filter(Boolean).map(parseComplex);
    selectorCache.set(key, groups);
    return groups;
  }
  function parseComplex(s) {
    const parts = [];
    let i = 0; let comb = null; let cur = '';
    let depth = 0; let quote = null;
    const flush = () => { if (cur.trim()) { parts.push({ compound: parseCompound(cur.trim()), combinator: comb }); comb = null; } cur = ''; };
    while (i < s.length) {
      const ch = s[i];
      if (quote) { cur += ch; if (ch === quote) quote = null; i++; continue; }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; i++; continue; }
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth--;
      if (depth === 0 && /[\s>+~]/.test(ch)) {
        const hadCur = !!cur.trim();
        flush();
        let j = i; let explicit = null;
        while (j < s.length && /[\s>+~]/.test(s[j])) { if (s[j] !== ' ' && !/\s/.test(s[j])) explicit = s[j]; j++; }
        if (hadCur || explicit) comb = explicit || ' ';
        i = j;
        continue;
      }
      cur += ch;
      i++;
    }
    flush();
    return parts;
  }
  function parseCompound(s) {
    const c = { tag: null, ids: [], classes: [], attrs: [], pseudos: [] };
    let i = 0;
    const ident = () => { const m = /^(?:\\.|[\w-])+/.exec(s.slice(i)); i += m ? m[0].length : 0; return m ? m[0].replace(/\\(.)/g, '$1') : ''; };
    if (s[0] === '*') i = 1;
    else if (/[a-zA-Z]/.test(s[0])) c.tag = ident().toLowerCase();
    while (i < s.length) {
      const ch = s[i];
      if (ch === '#') { i++; c.ids.push(ident()); } else if (ch === '.') { i++; c.classes.push(ident()); } else if (ch === '[') {
        const end = splitTop(s.slice(i + 1), ']')[0];
        const m = /^\s*([^\s~|^$*!=\]]+)\s*(?:([~|^$*!]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*(i)?)?\s*$/.exec(end);
        if (m) c.attrs.push({ name: m[1].toLowerCase(), op: m[2] || null, value: m[3] ?? m[4] ?? m[5] ?? null });
        i += end.length + 2;
      } else if (ch === ':') {
        i++;
        if (s[i] === ':') i++;
        const name = ident().toLowerCase();
        let arg = null;
        if (s[i] === '(') { const inner = splitTop(s.slice(i + 1), ')')[0]; arg = inner; i += inner.length + 2; }
        c.pseudos.push({ name, arg, groups: name === 'not' || name === 'is' || name === 'where' || name === 'has' ? parseSelector(arg || '') : null });
      } else i++;
    }
    return c;
  }
  function matchCompound(el, c, scope) {
    if (!el || el.nodeType !== 1) return false;
    if (c.tag && el.localName !== c.tag) return false;
    for (const id of c.ids) if (el.id !== id) return false;
    for (const cl of c.classes) if (!el.classList.contains(cl)) return false;
    for (const a of c.attrs) {
      const v = el.getAttribute(a.name);
      if (v === null) return false;
      if (a.op === null) continue;
      const w = a.value ?? '';
      if (a.op === '=' && v !== w) return false;
      if (a.op === '~=' && !v.split(/\s+/).includes(w)) return false;
      if (a.op === '^=' && !(w && v.startsWith(w))) return false;
      if (a.op === '$=' && !(w && v.endsWith(w))) return false;
      if (a.op === '*=' && !(w && v.includes(w))) return false;
      if (a.op === '|=' && !(v === w || v.startsWith(`${w}-`))) return false;
    }
    for (const p of c.pseudos) {
      if (p.name === 'not') { if (p.groups.some((g) => matchComplex(el, g, scope))) return false; continue; }
      if (p.name === 'is' || p.name === 'where') { if (!p.groups.some((g) => matchComplex(el, g, scope))) return false; continue; }
      if (p.name === 'has') { if (!p.groups.some((g) => el._descendants().some((d) => matchComplex(d, g, el)))) return false; continue; }
      if (p.name === 'first-child') { if (el.parentNode?.children?.[0] !== el) return false; continue; }
      if (p.name === 'last-child') { if (el.parentNode?.children?.at(-1) !== el) return false; continue; }
      if (p.name === 'checked') { if (!el.checked && !el.selected) return false; continue; }
      if (p.name === 'disabled') { if (!el.disabled) return false; continue; }
      if (p.name === 'enabled') { if (el.disabled) return false; continue; }
      if (p.name === 'scope') { if (scope ? el !== scope : el !== document.documentElement) return false; continue; }
      if (p.name === 'focus' || p.name === 'focus-within') { if (document.activeElement !== el && !(p.name === 'focus-within' && el.contains(document.activeElement))) return false; continue; }
      if (p.name === 'hover' || p.name === 'active' || p.name === 'focus-visible') return false;
      // unknown pseudo-classes never match
      return false;
    }
    return true;
  }
  function matchComplex(el, parts, scope) {
    const match = (node, k) => {
      if (!matchCompound(node, parts[k].compound, scope)) return false;
      if (k === 0) return true;
      const comb = parts[k].combinator || ' ';
      if (comb === '>') return match(node.parentNode, k - 1);
      if (comb === ' ') { let cur = node.parentNode; while (cur && cur.nodeType === 1) { if (match(cur, k - 1)) return true; cur = cur.parentNode; } return false; }
      if (comb === '+') return match(node.previousElementSibling, k - 1);
      if (comb === '~') { let cur = node.previousElementSibling; while (cur) { if (match(cur, k - 1)) return true; cur = cur.previousElementSibling; } return false; }
      return false;
    };
    return match(el, parts.length - 1);
  }

  // ---- the document and the window --------------------------------------------------------------
  class Document extends ParentMixin(Node) {
    constructor() {
      super();
      this.nodeType = 9;
      this.nodeName = '#document';
      this.hidden = false;
      this.visibilityState = 'visible';
      this.readyState = 'loading';
      this.title = '';
      this.cookie = '';
      this.activeElement = null;
    }
    createElement(tag) { return new Element(tag); }
    createElementNS(_ns, tag) { return new Element(tag); }
    createTextNode(t) { return new Text(t); }
    createComment(t) { return new Comment(t); }
    createDocumentFragment() { return new DocumentFragment(); }
    createRange() { return { selectNodeContents() {}, collapse() {}, setStart() {}, setEnd() {}, createContextualFragment: (html) => { const f = new DocumentFragment(); for (const n of parseHtml(html)) f.appendChild(n); return f; } }; }
    get defaultView() { return win; }
    execCommand() { return false; }
    hasFocus() { return true; }
    getSelection() { return { toString: () => '', removeAllRanges() {}, addRange() {} }; }
    elementFromPoint() { return null; }
  }

  const document = new Document();
  const html = new Element('html');
  const head = new Element('head');
  const body = new Element('body');
  html.appendChild(head);
  html.appendChild(body);
  document.appendChild(html);
  document.documentElement = html;
  document.head = head;
  document.body = body;
  document.activeElement = body;

  // the window's own listeners (resize, keydown on window, custom app events): a node at the end of the bubbling path
  const windowTarget = new EventTarget();
  windowTarget.parentNode = null;
  win.addEventListener = (t, fn, o) => windowTarget.addEventListener(t, fn, o);
  win.removeEventListener = (t, fn) => windowTarget.removeEventListener(t, fn);
  win.dispatchEvent = (ev) => { ev.target = ev.target || windowTarget; ev._path = [windowTarget]; windowTarget._fire(ev); return !ev.defaultPrevented; };
  Object.defineProperty(windowTarget, 'onresize', { get: () => win.onresize, configurable: true });

  /** Parses a whole page's <body> markup into document.body (scripts left out). */
  function loadBody(pageHtml) {
    const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(String(pageHtml));
    const inner = (m ? m[1] : String(pageHtml)).replace(/<script\b[\s\S]*?<\/script>/gi, '');
    body.innerHTML = inner;
  }

  /** Types into a field: sets its value and fires `input` (bubbling), as a keystroke would. */
  function type(el, text) {
    el.value = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
  /** A keydown on an element (bubbling, cancelable); returns the event. */
  function keydown(el, key, extra = {}) {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
    el.dispatchEvent(ev);
    return ev;
  }

  return {
    document, window: win, errors, parseHtml, serialize, loadBody, type, keydown,
    classes: { Node, Text, Comment, Element, HTMLElement: Element, DocumentFragment, Document, Event, CustomEvent, UIEvent, MouseEvent, KeyboardEvent, InputEvent, FocusEvent, EventTarget },
  };
}

/** The text of an element as a reader sees it: spaces collapsed. */
const textOf = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();

module.exports = { createDom, textOf };
