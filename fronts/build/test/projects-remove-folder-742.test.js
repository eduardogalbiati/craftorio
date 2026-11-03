// #742: removing a project can delete its folder too: the remove dialog's texts. Acceptance tests, written
// before the code (the engine's are packages/engine/test/service/projects-remove-folder-742.test.js).
//
// Keys assumed (en.json and pt-BR.json), for the Projects card's Remove dialog (projects.js):
// - projects.remove_delete_folder: the "Also delete its folder" choice;
// - projects.remove_folder_changes: the second confirmation listing uncommitted changes and unpushed commits;
// - projects.remove_type_name: a folder outside <workspace>/repos/: type the project's name to confirm;
// - projects.remove_running_run: refused while a run of the project is running (names the run, {run}).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CATALOGS = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'i18n');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const KEYS = ['projects.remove_delete_folder', 'projects.remove_folder_changes', 'projects.remove_type_name', 'projects.remove_running_run'];

for (const [file, lang] of [['en.json', 'English'], ['pt-BR.json', 'Portuguese']]) {
  test(`#742 the remove dialog's texts are in ${file} (${lang})`, () => {
    const catalog = readJson(path.join(CATALOGS, file));
    assert.deepEqual(KEYS.filter((k) => !String(catalog[k] || '').trim()), []);
  });
}

test('#742 the running-run refusal names the run ({run}) in both catalogs', () => {
  const said = ['en.json', 'pt-BR.json'].map((f) => String(readJson(path.join(CATALOGS, f))['projects.remove_running_run'] || '').includes('{run}'));
  assert.deepEqual(said, [true, true]);
});

test('#742 the old remove text no longer promises the folder is never deleted (projects.js does not use it)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'projects', 'projects.js'), 'utf8');
  assert.equal(src.includes('projects.remove_name_from_the_list_the'), false);
});
