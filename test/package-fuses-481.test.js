// #481 (SEC-17), scripts/package.js: the packaged binary's Electron fuses include
// EnableCookieEncryption (the session cookies on disk encrypted with the OS key). Read without
// building: packagerOptions' afterComplete hook flips the fuses through @electron/fuses, replaced
// here (the boundary that writes the binary) by a stub that records the config it was given.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');

test('#481 the packaged app flips EnableCookieEncryption on, with the existing fuses kept', async (t) => {
  const fusesId = require.resolve('@electron/fuses');
  const real = require('@electron/fuses');
  const entry = require.cache[fusesId];
  const saved = entry.exports;
  let config = null;
  entry.exports = { ...real, flipFuses: async (exe, cfg) => { config = cfg; } };
  t.after(() => { entry.exports = saved; });

  const { packagerOptions } = require('../scripts/package');
  const opts = packagerOptions({ platform: 'win32', arch: 'x64', out: os.tmpdir() });
  for (const hook of opts.afterComplete) await hook({ buildPath: os.tmpdir() });

  assert.ok(config, 'the hook flipped the fuses');
  const O = real.FuseV1Options;
  assert.equal(config[O.EnableCookieEncryption], true);
  assert.equal(config[O.RunAsNode], false);
  assert.equal(config[O.OnlyLoadAppFromAsar], true);
});
