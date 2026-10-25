// A test helper (not a test): gives a bare vm sandbox the catalog the page loads before the
// renderer's scripts (#330), `t` and `I18n` on the sandbox and on its `window`, in the language
// I18n is set to (English by default). The page harnesses use page-i18n.js instead.
const I18n = require('../i18n.js');

function withI18n(sandbox) {
  sandbox.I18n = I18n;
  sandbox.t = I18n.t;
  if (sandbox.window && typeof sandbox.window === 'object' && sandbox.window !== sandbox) {
    sandbox.window.I18n = I18n;
    sandbox.window.t = I18n.t;
  }
  return sandbox;
}

module.exports = { withI18n };
