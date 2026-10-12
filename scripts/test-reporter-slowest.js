// The per-file timing reporter for `node --test` (#305): node reports each test file once more as a
// top-level test named after the file, whose duration is the file's whole wall time (its process,
// load included). Writes { file: ms } as JSON to its destination; scripts/test.js prints the five
// slowest files at the end of the report, so the suite's critical path shows in every run log.
//   node --test --test-reporter=./scripts/test-reporter-slowest.js --test-reporter-destination=times.json test/a.test.js

const path = require('path');

module.exports = async function*slowestReporter(source) {
  const times = {};
  for await (const ev of source) {
    const d = ev.data;
    // the file's own entry is named as the file was given on the command line (relative or absolute)
    if (ev.type === 'test:complete' && d && d.nesting === 0 && d.file && d.details && path.resolve(d.name) === path.resolve(d.file)) {
      times[d.file] = d.details.duration_ms;
    }
  }
  yield `${JSON.stringify(times)}\n`;
};
