// The desktop app's keychain (`host.secrets`, #634 R12): the Monitor's source tokens (Sentry), kept
// in one file of the app's user-data folder encrypted by the system (safeStorage: DPAPI, Keychain,
// libsecret). Without system encryption nothing is written: the tokens live in memory until the
// app quits (never plain text on disk). { get(key), set(key, value) }, both async; set(key, '')
// forgets a token.

'use strict';

const fs = require('fs');
const path = require('path');

function createSecrets({ file, safeStorage, log = console }) {
  let cache = null;
  let encrypted = null;

  async function canEncrypt() {
    if (encrypted === null) {
      encrypted = !!(await safeStorage.isAsyncEncryptionAvailable().catch(() => false));
      if (!encrypted) log.warn('secrets: this computer offers no encryption (safeStorage): the Monitor\'s tokens stay in memory only.');
    }
    return encrypted;
  }

  async function load() {
    if (cache) return cache;
    cache = {};
    if (!(await canEncrypt())) return cache;
    try {
      cache = JSON.parse(safeStorage.decryptString(fs.readFileSync(file))) || {};
    } catch {
      cache = {}; // no file yet, or one this user's keys can't read
    }
    return cache;
  }

  async function save() {
    if (!(await canEncrypt())) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(cache)));
    fs.renameSync(tmp, file);
  }

  return {
    async get(key) {
      const all = await load();
      return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : null;
    },
    async set(key, value) {
      const all = await load();
      if (value) all[key] = String(value);
      else delete all[key];
      await save();
    },
  };
}

module.exports = { createSecrets };
