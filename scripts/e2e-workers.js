// The E2E behaviour lane's workers (#366): `CRAFTORIO_E2E_WORKERS=N` (N >= 1) forces N; unset or
// `auto` sizes them from the machine, clamp(1, 4, min(floor(threads / 4), floor((freeGB - 4) / 1.5))).
// An invalid value falls back to auto with a warning. `e2eWorkers` is pure (the value and the machine
// passed in) and returns the start line playwright.config.js prints, e.g.
// "E2E: 4 workers (auto: 16 threads, 13.2 GB free)".

'use strict';

// Measured on 2026-10-13 on a 20-thread, 32 GB machine (i9-10900KF), whole suite at a70fa5b (#366):
// each worker beyond the first cost about 18 points of CPU (around 4 busy threads, more at p95) and
// under 1 GB of RAM (1.5 GB per worker, plus 4 GB kept free for the system and the app: the memory
// guard, unchanged). 8 threads per worker gave 2 workers there.
// Retuned on 2026-11-25 to 4 threads per worker, measured in WSL Ubuntu on 16 threads with 13 GB free,
// the analyser front's features (node scripts/e2e.js --front analyser): 249 s with 2 workers, 150 s
// with 4, 128 s with 6. 4 workers is most of the gain and stays inside the 4 busy threads a worker takes.
const AUTO = {
  threadsPerWorker: 4,
  reservedGB: 4,
  gbPerWorker: 1.5,
  min: 1,
  max: 4,
};
const GB = 1024 ** 3;
const VARIABLE = 'CRAFTORIO_E2E_WORKERS';

const plural = (n) => `${n} worker${n === 1 ? '' : 's'}`;

function autoWorkers(threads, freeGB) {
  const byThreads = Math.floor(threads / AUTO.threadsPerWorker);
  const byMemory = Math.floor((freeGB - AUTO.reservedGB) / AUTO.gbPerWorker);
  return Math.min(AUTO.max, Math.max(AUTO.min, Math.min(byThreads, byMemory)));
}

// { value: the variable's text (undefined: unset), threads, freeBytes } -> { workers, line, warning }
function e2eWorkers({ value, threads, freeBytes }) {
  const text = String(value ?? '').trim();
  if (/^\d+$/.test(text) && Number(text) >= 1) {
    const workers = Number(text);
    return { workers, line: `E2E: ${plural(workers)} (${VARIABLE})`, warning: null };
  }
  const warning = text && text.toLowerCase() !== 'auto'
    ? `${VARIABLE}="${value}" is not a number of workers (1 or more) or auto: using auto.`
    : null;
  const freeGB = freeBytes / GB;
  const workers = autoWorkers(threads, freeGB);
  return { workers, line: `E2E: ${plural(workers)} (auto: ${threads} threads, ${freeGB.toFixed(1)} GB free)`, warning };
}

module.exports = {
  AUTO,
  e2eWorkers,
};
