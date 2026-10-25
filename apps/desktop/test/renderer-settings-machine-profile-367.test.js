// #367 Machine profile in the UI: Settings › Execution › Concurrent runs
// (apps/desktop/renderer/views/settings/settings.js) and the first-run Setup (#319, apps/desktop/renderer/setup.js)
// show the machine's line (machineLine of packages/engine/domains/machine/machine-profile.js, or its packages/shared/ counterpart),
// with "Use these values", manual values and a "back to auto" link, and the memory guard's
// suggestion with an Apply button. The renderer runs only inside Electron, so these tests read the
// sources (static markup or the template strings that draw it).
// Assumed data-testids (anywhere in the file, static or rendered):
//   settings.js: machine-profile-line, machine-profile-use ("Use these values"),
//     machine-profile-test-workers (the manual test workers per run; the manual runs reuse
//     #set-cr-max), machine-profile-back-to-auto ("back to auto"), machine-profile-suggestion,
//     machine-profile-apply ("Apply"); the settings saved: settings.machineProfile.
//   setup.js: machine-profile-line.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'renderer', ...p), 'utf8');
// #329: the markup lives in settings-markup.js, its texts in the catalog
const settings = require('./settings-source-329').settingsSource();
const setup = read('setup.js');

const SETTINGS_TESTIDS = [
  'machine-profile-apply',
  'machine-profile-back-to-auto',
  'machine-profile-line',
  'machine-profile-suggestion',
  'machine-profile-test-workers',
  'machine-profile-use',
];

test('Settings › Execution: the machine line, Use these values, manual test workers, back to auto, the suggestion and Apply', () => {
  const missing = SETTINGS_TESTIDS.filter((id) => !settings.includes(`data-testid="${id}"`));
  assert.deepEqual(missing, []);
  assert.match(settings, /Use these values/);
  assert.match(settings, /back to auto/i);
  assert.match(settings, />\s*Apply\s*</);
});

test('Settings saves the owner\'s choice as settings.machineProfile (auto or manual) through api.setSettings', () => {
  assert.match(settings, /machineProfile/);
  assert.match(settings, /setSettings\(/);
  assert.match(settings, /mode: 'manual'|mode: "manual"/);
  assert.match(settings, /mode: 'auto'|mode: "auto"/);
});

test('Setup (#319) shows the machine line too', () => {
  assert.equal(setup.includes('data-testid="machine-profile-line"'), true);
});
