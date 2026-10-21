// Service area: the interface language (#329, src/shared/i18n.js) of what the service writes for
// the user, the OS notifications' text (src/notifications.js). Settings › General › Language ›
// Interface (settings.language.interface), else the computer's language (host.locale, Electron's
// app.getLocale()) when it has a catalog, else English. Applied when a workspace opens and on each
// 'settings:changed'. Engine errors and logs stay English. It also sets the AI agents' "Same as the
// interface" default for an unset interface: the computer's language, as the screens resolve it (#424).

const workspace = require('../../workspace');
const I18n = require('../../shared/i18n');
const Language = require('../../shared/language');

module.exports = (ctx) => {
  function applyInterfaceLanguage(settings) {
    let chosen = settings?.language?.interface;
    if (!settings) {
      try { if (ctx.ws) chosen = workspace.readSettings(ctx.ws).language?.interface; } catch { /* defaults */ }
    }
    I18n.setLanguage(I18n.resolveLanguage(chosen, ctx.host?.locale));
    Language.setComputerLanguage(I18n.resolveLanguage(null, ctx.host?.locale));
  }

  ctx.events.on('settings:changed', (settings) => applyInterfaceLanguage(settings));

  return {
    applyInterfaceLanguage,
  };
};
