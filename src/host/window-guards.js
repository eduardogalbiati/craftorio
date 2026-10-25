// What a window of the app may load (#466): nothing but its own page. Pure of Electron:
// guardWindow(webContents, { openExternal }) prevents every navigation (the app is a single page; a
// form in untrusted markdown or a dropped file would otherwise load a local page with the preload's
// window.api), sends http(s) links to the browser through openExternal, denies window.open and
// prevents attaching a webview. src/host/main.js and src/host/agents-window.js install it on their windows.
// A reload the page starts itself (location.reload) is prevented too: the desktop app restarts
// through app:relaunch (code-banner.js's Reload button is for the app in a browser).

const isWeb = (url) => /^https?:\/\//i.test(String(url || ''));

function guardWindow(webContents, { openExternal }) {
  webContents.setWindowOpenHandler(({ url }) => {
    if (isWeb(url)) openExternal(url);
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (isWeb(url)) openExternal(url);
  });
  webContents.on('will-attach-webview', (e) => e.preventDefault());
}

module.exports = { guardWindow };
