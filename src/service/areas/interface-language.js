// Service area: the interface language (#329, src/shared/i18n.js) of what the service writes for
// the user, the OS notifications' text (src/notifications.js). Settings › General › Language ›
// Interface (settings.language.interface), else the computer's language (host.locale, Electron's
// app.getLocale()) when it has a catalog, else English. Applied when a workspace opens and on each
// 'settings:changed'. Engine errors and logs stay English.

const workspace = require('../../workspace');
const I18n = require('../../shared/i18n');

module.exports = (ctx) => {
  function applyInterfaceLanguage(settings) {
    let chosen = settings?.language?.interface;
    if (!settings) {
      try { if (ctx.ws) chosen = workspace.readSettings(ctx.ws).language?.interface; } catch { /* defaults */ }
    }
    I18n.setLanguage(I18n.resolveLanguage(chosen, ctx.host?.locale));
  }

  ctx.events.on('settings:changed', (settings) => applyInterfaceLanguage(settings));

  return {
    applyInterfaceLanguage,
  };
};
