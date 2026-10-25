// Test helper (#329): Settings' source as the older tests read it. Its markup moved to
// settings-markup.js with its texts in the catalog (`${t('settings.…')}`), so this returns that markup
// with each `${t('key')}` replaced by its English text (packages/shared/i18n/en.json), followed by
// settings.js itself (its render functions call t: give the vm sandboxes `t` below).
const fs = require('fs');
const path = require('path');
const { t } = require('@multiagent/shared/i18n');

const DIR = path.join(__dirname, '..', 'src', 'renderer', 'views', 'settings');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

function settingsSource() {
  const markup = read('settings-markup.js').replace(/\$\{t\('([\w.-]+)'\)\}/g, (m, key) => t(key, {}, 'en'));
  return `${markup}\n${read('settings.js')}`;
}

module.exports = { settingsSource, t: (key, params) => t(key, params, 'en') };
