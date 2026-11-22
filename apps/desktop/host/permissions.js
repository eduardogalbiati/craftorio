// Which web permissions the app's window gets (apps/desktop/host/main.js installs it on the session): the
// microphone for voice input (#82, `media` with audio only) and only for the app's own page
// (apps/desktop/renderer/index.html, a file: URL). Everything else (camera, geolocation, notifications
// from pages, ...) and every other page is denied.

const { fileURLToPath } = require('url');
const { pathKey } = require('@craftorio/engine/domains/machine/platform-paths');

const norm = (p) => pathKey(p);

// appPage: the absolute path of the app's index.html. url: the page asking.
function isAppPage(url, appPage) {
  try {
    const u = new URL(url);
    return u.protocol === 'file:' && norm(fileURLToPath(`file://${u.host}${u.pathname}`)) === norm(appPage);
  } catch {
    return false;
  }
}

// details: Electron's permission details ({ requestingUrl, mediaTypes } for a request,
// { requestingUrl, mediaType } for a check). Audio only: a request naming 'video' is denied.
function allowPermission(permission, details, appPage) {
  if (permission !== 'media') return false;
  if (!isAppPage(details?.requestingUrl || '', appPage)) return false;
  const types = details?.mediaTypes || (details?.mediaType ? [details.mediaType] : []);
  return !types.includes('video');
}

module.exports = {
  allowPermission,
  isAppPage,
};
