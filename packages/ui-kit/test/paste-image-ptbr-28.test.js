// #28 acceptance, written before the code: the paste hint packages/ui-kit/paste-image.js adds to an AI prompt
// field's placeholder follows the interface language. paste-image.js is evaluated in a vm sandbox (as
// renderer-paste-image.test.js does) with the page's I18n set to pt-BR before it loads.
//
// The contract assumed here: in pt-BR the hint reads "Colar uma imagem (Ctrl+V)" and the English
// "Paste an image (Ctrl+V)" does not appear.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const I18n = require('@craftorio/shared/i18n');
const { VOICE_FIELDS } = require('../voice.js');

// a textarea with an id, enough for paste-image.js's scan/attach (matches by #id only)
function field(id) {
  const attrs = {};
  const el = {
    tagName: 'TEXTAREA',
    nodeType: 1,
    id,
    classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    setAttribute: (n, v) => { attrs[n] = String(v); },
    addEventListener() {},
    after() {},
    matches: (sel) => String(sel).split(',').some((s) => [`#${id}`, `textarea#${id}`].includes(s.trim())),
    querySelectorAll: () => [],
  };
  return el;
}

function placeholderInPortuguese() {
  const ta = field('arena-task'); // 'textarea#arena-task' is one of voice.js's VOICE_FIELDS
  assert.ok(VOICE_FIELDS.includes('textarea#arena-task'), 'voice.js still lists textarea#arena-task');
  const sandbox = {
    api: {},
    voice: { VOICE_FIELDS },
    document: {
      body: { nodeType: 1, matches: () => false, querySelectorAll: (sel) => [ta].filter((f) => f.matches(sel)) },
      createElement: () => field('div'),
      addEventListener() {},
      readyState: 'complete',
    },
    FileReader: class {},
    MutationObserver: class { observe() {} },
    I18n,
    t: I18n.t,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const before = I18n.getLanguage();
  I18n.setLanguage('pt-BR');
  try {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'paste-image.js'), 'utf8'), sandbox);
  } finally {
    I18n.setLanguage(before);
  }
  return ta.getAttribute('placeholder');
}

test('#28 pt-BR: the paste hint on a prompt field is "Colar uma imagem (Ctrl+V)"', () => {
  assert.equal(placeholderInPortuguese(), 'Colar uma imagem (Ctrl+V)');
});
