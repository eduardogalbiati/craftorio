// Who may call the main process's IPC channels (#467): only the app's own page (isAppPage in
// src/host/permissions.js, the Agents window's `?window=agents` included) in a window's top frame. Pure of
// Electron: guardIpc(ipcMain, { appPage, log }) → { handle(channel, fn), on(channel, fn) } registers
// listeners that call fn(arg, event) for a trusted sender. A refused call is logged once (log(...),
// src/host/main.js passes the console that src/main-log.js captures); a `handle` call throws (the renderer's
// invoke rejects), an `on` call does nothing (a sendSync caller gets null back).

const { isAppPage } = require('./permissions');

function guardIpc(ipcMain, { appPage, log = () => {} }) {
  const trusted = (e) => !!e?.senderFrame && e.senderFrame === e.sender?.mainFrame && isAppPage(e.senderFrame.url, appPage);
  const refuse = (channel, e) => {
    try { log(`refused ${channel} from`, e?.senderFrame?.url || '(no frame)'); } catch { /* logging never breaks a handler */ }
  };
  return {
    handle(channel, fn) {
      ipcMain.handle(channel, (e, arg) => {
        if (!trusted(e)) {
          refuse(channel, e);
          throw new Error('Only the app page can use this channel.');
        }
        return fn(arg, e);
      });
    },
    on(channel, fn) {
      ipcMain.on(channel, (e, arg) => {
        if (!trusted(e)) {
          refuse(channel, e);
          if (e) e.returnValue = null;
          return;
        }
        fn(arg, e);
      });
    },
  };
}

module.exports = { guardIpc };
