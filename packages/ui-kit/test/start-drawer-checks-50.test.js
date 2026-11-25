// #50: the Start drawer's rule checks line (#start-checks): what the run will check, the owner's command or `off` from
// the project's defaults or typed in the form, hidden without a project or for a workflow with no check_command; and
// WorkflowInputs' checksOf, checksHtml and forgetHints behind it.
// Seam: the whole page (agent-chat-page-harness, as start-drawer-platform-39.test.js), and workflow-inputs.js itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, settle } = require('./agent-chat-page-harness');
const WorkflowInputs = require('../workflow-inputs');

const workflow = (name, inputs) => ({ file: `${name}.yaml`, name, steps: [], agents: {}, inputs: { request: { label: 'Request', type: 'string', default: '' }, project_path: { label: 'Project folder', type: 'string', required: true }, ...inputs } });
const WORKFLOWS = [
  workflow('fix', { check_command: { type: 'string', default: '', label: 'Check command' } }),
  workflow('triage', {}),
];
const PROJECTS = ['shop', 'site'].map((id) => ({ id, name: id, folder: `C:/ws/${id}`, exists: true, repo: null }));
const FOUND = { check_command: '', check_commands: ['npm run lint', 'npm run typecheck'], check_rewrites: [] };

async function drawer({ runDefaults = FOUND, hints = async () => ({ runDefaults }), workflow: file = 'fix.yaml', project = 'shop' } = {}) {
  const page = await loadPage({
    api: {
      listProjects: async () => JSON.parse(JSON.stringify(PROJECTS)),
      listPipelines: async () => [],
      listWorkflows: async () => JSON.parse(JSON.stringify(WORKFLOWS)),
      projectInputHints: hints,
    },
  });
  page.run(`openDrawer(${JSON.stringify({ workflow: file, project })})`);
  await settle(30);
  return page;
}
async function choose(page, select, value) {
  page.$(select).value = value;
  page.$(select).onchange();
  await settle(30);
}
const line = (page) => {
  const box = page.$('#start-checks');
  return { shown: !box.classList.contains('hidden'), state: box.dataset.state, html: String(box.innerHTML) };
};

test('#50 Start shows the commands found in the project', async () => {
  const { shown, state, html } = line(await drawer());
  assert.deepEqual([shown, state], [true, 'on']);
  assert.match(html, /npm run lint[\s\S]*npm run typecheck/);
});

test('#50 Start says that nothing was found, and which command is not run because it rewrites files', async () => {
  const { shown, html } = line(await drawer({ runDefaults: { check_command: '', check_commands: [], check_rewrites: [{ name: 'npm run lint', why: '--fix' }] } }));
  assert.equal(shown, true);
  assert.match(html, /none found/);
  assert.match(html, /npm run lint is not run: it rewrites files \(--fix\)/);
});

test('#50 Start shows the owner\'s command, or that the project turned the checks off', async () => {
  const own = line(await drawer({ runDefaults: { ...FOUND, check_command: 'make lint' } }));
  assert.match(own.html, /make lint/);
  assert.doesNotMatch(own.html, /npm run/);
  const off = line(await drawer({ runDefaults: { ...FOUND, check_command: 'off' } }));
  assert.equal(off.state, 'off');
  assert.doesNotMatch(off.html, /npm run/);
});

test('#50 Start follows the Check command typed in the form', async () => {
  const page = await drawer();
  const typed = async (value) => {
    page.$('#drawer [data-wi-input="check_command"]').value = value;
    page.$('#adv-form').oninput();
    await settle(10);
    return line(page);
  };
  assert.match((await typed('make lint')).html, /make lint/);
  assert.equal((await typed('Off')).state, 'off');
  const blank = await typed('');
  assert.deepEqual([blank.state, /npm run typecheck/.test(blank.html)], ['on', true]);
});

test('#50 Start hides the line without a project, for a workflow with no check and when the project cannot be read', async () => {
  const page = await drawer();
  await choose(page, '#project-select', '');
  assert.equal(line(page).shown, false);
  await choose(page, '#project-select', 'site');
  assert.equal(line(page).shown, true);
  await choose(page, '#wf-select', 'triage.yaml');
  assert.deepEqual([line(page).shown, line(page).html], [false, '']);
  const unread = await drawer({ hints: async () => { throw new Error('no folder'); } });
  assert.equal(line(unread).shown, false);
});

test('#50 Start shows the chosen project\'s commands, not the previous project\'s', async () => {
  const page = await drawer({ hints: async (id) => ({ runDefaults: { ...FOUND, check_commands: [`lint-${id}`] } }) });
  assert.match(line(page).html, /lint-shop/);
  await choose(page, '#project-select', 'site');
  assert.match(line(page).html, /lint-site/);
  assert.doesNotMatch(line(page).html, /lint-shop/);
});

test('#50 opening Start again reads the project again', async () => {
  let commands = ['npm run lint'];
  const page = await drawer({ hints: async () => ({ runDefaults: { ...FOUND, check_commands: commands } }) });
  commands = ['npm run types'];
  page.run("openDrawer({ workflow: 'fix.yaml', project: 'shop' })");
  await settle(30);
  assert.match(line(page).html, /npm run types/);
});

test('#50 checksOf: a given command alone, off in any case, else what was found', () => {
  const defaults = { check_commands: ['a', 'b'], check_rewrites: [{ name: 'c', why: '--fix' }] };
  assert.deepEqual(WorkflowInputs.checksOf(' make x ', defaults), { off: false, commands: ['make x'], rewrites: [] });
  assert.deepEqual(WorkflowInputs.checksOf('OFF', defaults), { off: true, commands: [], rewrites: [] });
  assert.deepEqual(WorkflowInputs.checksOf('', defaults), { off: false, commands: ['a', 'b'], rewrites: [{ name: 'c', why: '--fix' }] });
  assert.deepEqual(WorkflowInputs.checksOf(null, null), { off: false, commands: [], rewrites: [] });
});

test('#50 checksHtml escapes the commands and the reasons', () => {
  const html = WorkflowInputs.checksHtml({ off: false, commands: ['lint <b>'], rewrites: [{ name: '<i>', why: '<u>' }] });
  assert.doesNotMatch(html, /<[biu]>/);
  assert.match(html, /lint &lt;b&gt;/);
});

test('#50 forgetHints drops one project\'s hints, or all of them', async (t) => {
  t.after(() => { delete global.api; WorkflowInputs.forgetHints(); });
  const asked = [];
  global.api = { projectInputHints: async (id) => { asked.push(id); return {}; } };
  const read = async () => { for (const id of ['p50-a', 'p50-b']) await WorkflowInputs.hintsOf(id); };
  await read();
  await read();
  assert.deepEqual(asked.splice(0), ['p50-a', 'p50-b']);
  WorkflowInputs.forgetHints('p50-a');
  await read();
  assert.deepEqual(asked.splice(0), ['p50-a']);
  WorkflowInputs.forgetHints();
  await read();
  assert.deepEqual(asked.splice(0), ['p50-a', 'p50-b']);
});
