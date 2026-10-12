// Microphone permission before recording (#318). A packaged macOS app must ask the OS
// (Electron's systemPreferences.askForMediaAccess) before getUserMedia, or the OS denies the
// microphone silently; a denial becomes the voice-input error pointing to System Settings.
// Windows and Linux never ask. The host (src/main.js) passes Electron's systemPreferences to the
// service; the renderer calls it on 'voice:mic-access' (src/service/areas/speech.js).

const DENIED = 'Microphone access is denied. Allow it in System Settings › Privacy & Security › Microphone.';

// { ok: true } or { ok: false, error }.
async function ensureMicrophoneAccess({ platform = process.platform, systemPreferences } = {}) {
  if (platform !== 'darwin' || !systemPreferences?.askForMediaAccess) return { ok: true };
  const granted = await systemPreferences.askForMediaAccess('microphone');
  return granted ? { ok: true } : { ok: false, error: DENIED };
}

module.exports = {
  ensureMicrophoneAccess,
};
