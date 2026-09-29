// The engine's `shuffle(seed)` template filter (src/engine/workflow.js), for the renderer: the AI
// Arena chat uses it to know which contender wrote "Proposal N" (ai-arena anonymizes the
// proposals with `| shuffle(run_id)`). The renderer has no Node crypto, so the SHA-256 is inlined.
// A test keeps both implementations equal. Browser: window.arenaShuffle; Node: module.exports.
(function (root) {
  const K = [];
  const H0 = [];
  for (let n = 2; K.length < 64; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (!prime) continue;
    if (H0.length < 8) H0.push((Math.pow(n, 1 / 2) * 2 ** 32) | 0);
    K.push((Math.pow(n, 1 / 3) * 2 ** 32) | 0);
  }
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  // First 32 bits (big-endian) of the SHA-256 of a string (UTF-8).
  function sha256Word(str) {
    const bytes = new TextEncoder().encode(String(str));
    const len = bytes.length;
    const total = Math.ceil((len + 9) / 64) * 64;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(total - 8, Math.floor((len * 8) / 2 ** 32));
    view.setUint32(total - 4, (len * 8) >>> 0);
    const h = H0.slice();
    const w = new Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      [a, b, c, d, e, f, g, hh].forEach((x, i) => { h[i] = (h[i] + x) | 0; });
    }
    return h[0] >>> 0;
  }

  // Same algorithm as the engine's filter: the same seed gives the same order.
  function shuffle(arr, seed = '') {
    const out = [...(arr || [])];
    let h = sha256Word(seed);
    const rand = () => { h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return h / 2 ** 32; };
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  if (typeof module === 'object' && module.exports) module.exports = { shuffle, sha256Word };
  else root.arenaShuffle = shuffle;
})(typeof window !== 'undefined' ? window : globalThis);
