/* global api */
// Voice input (#82): a mic button on the long text fields (VOICE_FIELDS). Click to record, click
// again to stop; hold it to talk and release to stop; Ctrl+Shift+M toggles it in the focused
// field, Escape discards a recording. The audio is recorded here (MediaRecorder), converted to a
// 16 kHz mono WAV (OfflineAudioContext, no ffmpeg) and transcribed by the service
// ('audio:transcribe', src/speech.js). The transcript is inserted at the cursor for review, never
// sent. While it is transcribed the field shows a "Transcribing…" badge (class voice-transcribing,
// aria-busy) and stays editable. Fields rendered later (gate cards, chats) get their button from a MutationObserver.
// Pure helpers (encodeWav, insertText, formatElapsed) are exported for the tests; the DOM part
// uses app.js globals when present (showToast, errMsg).
(function (root) {
  // fields where talking helps: supervisor questions, gate feedback, the Start drawer (task, issue
  // intake), Write & Review and Arena prompts, the backlog PO question, the resume instruction
  const VOICE_FIELDS = [
    '#arena-task',
    '#duo-goal',
    '#duo-prompt',
    '#po-question',
    '#sup-question',
    '.duo-ask-text',
    '.run-gate-feedback',
    '.svc-input',
    '[id^="in-"]',
    '[id$="-ins"]',
  ].map((s) => `textarea${s}`).join(', ');
  const MAX_SECONDS = 120; // 2 min of 16 kHz 16-bit WAV, base64, fits the server's 5 MB body limit
  const HOLD_MS = 500; // a press longer than this is push-to-talk: releasing stops
  const SAMPLE_RATE = 16000;

  // 16-bit PCM mono WAV of float samples in [-1, 1].
  function encodeWav(samples, sampleRate = SAMPLE_RATE) {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(buf);
  }

  // The field's value with `text` put between start and end, spaced from its neighbours.
  // Returns { value, caret } (caret: right after the inserted text).
  function insertText(value, text, start = value.length, end = start) {
    const t = String(text || '').trim();
    if (!t) return { value, caret: end };
    const before = value.slice(0, start);
    const after = value.slice(end);
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const trail = after && !/^\s/.test(after) ? ' ' : '';
    const ins = lead + t + trail;
    return { value: before + ins + after, caret: before.length + lead.length + t.length };
  }

  const formatElapsed = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  const helpers = { encodeWav, formatElapsed, insertText, MAX_SECONDS, VOICE_FIELDS };
  if (typeof module === 'object' && module.exports) module.exports = helpers;
  if (typeof document === 'undefined') return;

  const MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>';
  let rec = null; // { ta, btn, recorder, stream, chunks, startedAt, timer, sel, cancelled }

  function notify(title, detail) {
    if (typeof root.showToast === 'function') root.showToast(title, detail);
    else console.warn(title, detail);
  }
  const message = (e) => (typeof root.errMsg === 'function' ? root.errMsg(e) : String(e?.message || e));

  function setState(btn, st, elapsed = '') {
    btn.dataset.state = st;
    btn.setAttribute('aria-pressed', st === 'recording' ? 'true' : 'false');
    const label = st === 'recording' ? 'Stop recording and transcribe' : st === 'busy' ? 'Transcribing…' : 'Dictate (Ctrl+Shift+M; hold to talk)';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.disabled = st === 'busy';
    btn.innerHTML = MIC + (st === 'recording' ? `<span class="voice-time">${elapsed || '0:00'}</span>` : st === 'busy' ? '<span class="voice-time">…</span>' : '');
    place(btn);
  }

  // While its recording is transcribed, the field says so (#131): a `voice-transcribing` class,
  // aria-busy and a "Transcribing…" badge in its bottom-left corner. The field stays enabled (a
  // disabled field hides the mic) so the user can keep typing.
  function setTranscribing(ta, on) {
    ta.classList.toggle('voice-transcribing', on);
    if (on) ta.setAttribute('aria-busy', 'true'); else ta.removeAttribute('aria-busy');
    let ind = ta._voiceInd;
    if (on && !ind && ta.parentElement) {
      ind = document.createElement('span');
      ind.className = 'voice-busy';
      ind.setAttribute('role', 'status');
      ind.innerHTML = '<span class="voice-busy-spin" aria-hidden="true"></span>Transcribing…';
      ta._voiceInd = ind;
      ta._voiceBtn.after(ind);
    }
    if (!ind) return;
    ind.classList.toggle('hidden', !on);
    if (on) place(ta._voiceBtn);
  }

  // the button sits in the field's bottom-right corner, the transcribing badge in its bottom-left
  // one (their parent is the positioning box)
  function place(btn) {
    const ta = btn._voiceField;
    const parent = ta.parentElement;
    const shown = ta.offsetParent !== null && !ta.disabled;
    btn.classList.toggle('hidden', !shown);
    if (!shown || ta.offsetParent !== parent) return;
    const bottom = `${parent.clientHeight - (ta.offsetTop + ta.offsetHeight) + 6}px`;
    btn.style.right = `${parent.clientWidth - (ta.offsetLeft + ta.offsetWidth) + 16}px`; // clear of the resize grip
    btn.style.bottom = bottom;
    if (ta._voiceInd) {
      ta._voiceInd.style.left = `${ta.offsetLeft + 8}px`;
      ta._voiceInd.style.bottom = bottom;
    }
  }

  let starting = false;
  async function start(ta, btn) {
    if (starting) return;
    if (rec) await stop();
    starting = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('The microphone needs a secure page (the app, localhost or HTTPS).');
      const st = await api.speechStatus();
      if (!st.path) throw new Error(`The speech-to-text CLI is not installed (command "${st.command}" not found). Install: ${st.installHint}`);
      if (!st.modelReady) throw new Error(`The speech model "${st.model}" is not downloaded: Settings › General › Voice input.`);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const recorder = new MediaRecorder(stream);
      const r = { ta, btn, recorder, stream, chunks: [], startedAt: Date.now(), sel: { start: ta.selectionStart, end: ta.selectionEnd }, cancelled: false };
      recorder.ondataavailable = (e) => { if (e.data.size) r.chunks.push(e.data); };
      recorder.onstop = () => finish(r);
      r.timer = setInterval(() => {
        const ms = Date.now() - r.startedAt;
        if (ms >= MAX_SECONDS * 1000) return stop();
        setState(btn, 'recording', formatElapsed(ms));
      }, 250);
      rec = r;
      recorder.start();
      setState(btn, 'recording');
    } catch (e) {
      setState(btn, 'idle');
      notify('Voice input', message(e));
    } finally {
      starting = false;
    }
  }

  function stop(cancel = false) {
    const r = rec;
    if (!r) return Promise.resolve();
    rec = null;
    r.cancelled = cancel;
    clearInterval(r.timer);
    return new Promise((resolve) => {
      r.done = resolve;
      if (r.recorder.state !== 'inactive') r.recorder.stop(); else finish(r);
    });
  }

  async function finish(r) {
    r.stream.getTracks().forEach((t) => t.stop());
    try {
      if (r.cancelled || !r.chunks.length) return setState(r.btn, 'idle');
      setState(r.btn, 'busy');
      setTranscribing(r.ta, true);
      const wav = await toWav(new Blob(r.chunks, { type: r.recorder.mimeType }));
      const { text } = await api.transcribeAudio(toBase64(wav));
      setTranscribing(r.ta, false);
      setState(r.btn, 'idle');
      if (!String(text || '').trim()) return notify('Voice input', 'Nothing was recognised in the recording.');
      const ta = r.ta;
      const focused = document.activeElement === ta;
      const s = focused ? ta.selectionStart : Math.min(r.sel.start ?? ta.value.length, ta.value.length);
      const e = focused ? ta.selectionEnd : Math.min(r.sel.end ?? s, ta.value.length);
      const out = insertText(ta.value, text, s, e);
      ta.value = out.value;
      ta.focus();
      ta.setSelectionRange(out.caret, out.caret);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {
      setTranscribing(r.ta, false);
      setState(r.btn, 'idle');
      notify('Voice input', message(e));
    } finally {
      r.done?.();
    }
  }

  async function toWav(blob) {
    const ctx = new AudioContext();
    let decoded;
    try { decoded = await ctx.decodeAudioData(await blob.arrayBuffer()); } finally { ctx.close(); }
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE)), SAMPLE_RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination); // a 1-channel destination mixes stereo down to mono
    src.start();
    const rendered = await off.startRendering();
    return encodeWav(rendered.getChannelData(0), SAMPLE_RATE);
  }

  function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  const toggle = (ta, btn) => (rec && rec.ta === ta ? stop() : start(ta, btn));

  function attach(ta) {
    if (ta._voiceBtn || !ta.parentElement) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'voice-mic';
    btn._voiceField = ta;
    ta._voiceBtn = btn;
    ta.classList.add('voice-field');
    if (getComputedStyle(ta.parentElement).position === 'static') ta.parentElement.classList.add('voice-host');
    ta.after(btn);
    setState(btn, 'idle');
    let pressedAt = 0;
    btn.onmousedown = (e) => e.preventDefault(); // keeps the field's focus and cursor
    btn.onpointerdown = (e) => {
      if (e.button !== 0) return;
      if (rec && rec.ta === ta) { pressedAt = 0; stop(); return; }
      pressedAt = Date.now();
      start(ta, btn);
    };
    btn.onpointerup = () => {
      if (pressedAt && Date.now() - pressedAt > HOLD_MS && rec && rec.ta === ta) stop();
      pressedAt = 0;
    };
    btn.onclick = (e) => { if (e.detail === 0) toggle(ta, btn); }; // keyboard (Enter/Space); pointers use the handlers above
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => place(btn)).observe(ta);
  }

  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.matches(VOICE_FIELDS)) attach(node);
    node.querySelectorAll(VOICE_FIELDS).forEach(attach);
  }

  function init() {
    scan(document.body);
    new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
    // fields shown later (a hidden view, a drawer) are placed when they get focus
    document.addEventListener('focusin', (e) => { if (e.target._voiceBtn) place(e.target._voiceBtn); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && rec) { stop(true); return; }
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.key.toLowerCase() !== 'm') return;
      const ta = document.activeElement;
      if (!ta?._voiceBtn) return;
      e.preventDefault();
      toggle(ta, ta._voiceBtn);
    });
  }

  root.voice = { ...helpers, attach, stop };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
