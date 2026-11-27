// #110: the install prose a screen shows by its catalog key (installHintKey) is the engine's own English text
// (installHint): a hint changed in install-commands.js without its catalog entry fails here, not in pt-BR.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { installCommands, installHint, installHintKey } = require('../../domains/machine/install-commands');
const en = require('@craftorio/shared/i18n/en.json');
const ptBR = require('@craftorio/shared/i18n/pt-BR.json');

const CASES = [['linux', {}], ['win32', {}], ['darwin', { brew: false }], ['darwin', { brew: true }]];

test('#110 every install prose has a catalog key whose English text is the engine\'s hint', () => {
  let keyed = 0;
  for (const [platform, opts] of CASES) {
    for (const id of Object.keys(installCommands(platform, opts))) {
      const key = installHintKey(id, platform, opts);
      const hint = installHint(id, platform, opts);
      if (!key) continue;
      keyed++;
      assert.equal(en[key], hint, `${platform} ${id}: ${key}`);
      assert.equal(typeof ptBR[key], 'string', `${key} in pt-BR`);
    }
  }
  assert.ok(keyed >= 9, `prose hints found: ${keyed}`);
});

test('#110 a hint that is a command has no key', () => {
  assert.equal(installHintKey('codex', 'linux'), null);
  assert.equal(installHintKey('gh', 'win32'), null);
  assert.equal(installHintKey('gh', 'darwin', { brew: true }), null);
  assert.equal(installHintKey('grok', 'win32'), 'setup.install_text.grok');
});
