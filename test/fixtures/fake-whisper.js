#!/usr/bin/env node
// Stands in for `whisper-cli` in speech.test.js: writes a transcript to '<base>.txt' (the file
// src/speech.js reads after running the CLI), matching the '-of <base>' argument it was started
// with. Never transcribes anything for real.
// FAKE_WHISPER_TEXT: the transcript to write (default 'hello world').
// FAKE_WHISPER_LOG: when set, the full argv is written there as JSON (so a test can check the
// flags src/speech.js built, e.g. '-l').
// FAKE_WHISPER_FAIL: when set, exits with an error instead of transcribing anything.
const fs = require('fs');

const argv = process.argv.slice(2);
if (process.env.FAKE_WHISPER_LOG) fs.writeFileSync(process.env.FAKE_WHISPER_LOG, JSON.stringify(argv));
if (process.env.FAKE_WHISPER_FAIL) { process.stderr.write('synthetic failure\n'); process.exit(1); }
const of = argv[argv.indexOf('-of') + 1];
fs.writeFileSync(`${of}.txt`, process.env.FAKE_WHISPER_TEXT ?? 'hello world');
