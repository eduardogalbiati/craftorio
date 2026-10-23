/* global api */
// Download and Import of a workflow on Workflows > Definitions (#488). Download (every card's
// data-testid=workflow-download) asks the service for the YAML as it is on disk (api.exportWorkflow,
// api.exportRepositoryWorkflow for a repository's card) and saves it as <file>.yaml. Import takes a file
// (the toolbar's Import button and its hidden input data-testid=workflow-import-file), a file dropped on
// the tab, or an https URL (data-testid=workflow-import-url, fetched by the service); the page opened with
// ?import=<url> starts the import of that URL once the Definitions tab has loaded (the hook a public page
// links to). The service validates it first (api.importWorkflow with preview: true); the dialog
// (#wf-import-modal, data-testid=workflow-import-dialog, its markup in workflows.js) lists what the
// workflow does and says that a workflow is code that runs on this machine (#474), or shows the loader's
// reasons (data-testid=workflow-import-errors) with no Import. Import writes it as a custom workflow under
// the given name, replacing an existing file only with Replace ticked. Uses app.js globals ($, esc, t,
// state, errMsg, showToast) and workflows.js's (wfDefs, refreshWorkflows).

// the import in the dialog: where it comes from ({ text } or { url }) and the service's summary
const wfImport = { source: null, summary: null };

// The card's YAML as a file named after it (a repository's workflows/x.yaml → x.yaml).
async function downloadWorkflow(card) {
  const file = card.dataset.file;
  let text;
  try {
    text = card.dataset.project
      ? await api.exportRepositoryWorkflow({ projectId: card.dataset.project, file })
      : await api.exportWorkflow(file);
  } catch (e) { return showToast(t('workflows.download_failed'), errMsg(e)); }
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/yaml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file.split('/').pop();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { showToast(t('workflows.download_failed'), errMsg(e)); }
}

const importStem = (name) => String(name || '').trim().replace(/\.ya?ml$/i, '');
const importExists = (name) => !!importStem(name) && (state.workflows || []).some((w) => w.file === `${importStem(name)}.yaml`);

// Asks the service for the summary (nothing written) and opens the dialog with it or with its reasons.
async function startWorkflowImport(source) {
  wfImport.source = source;
  wfImport.summary = null;
  renderImportDialog({ loading: true });
  $('#wf-import-modal').classList.remove('hidden');
  let res;
  try {
    res = await api.importWorkflow({ ...source, preview: true });
  } catch (e) { return renderImportDialog({ error: errMsg(e) }); }
  if (!res?.ok) return renderImportDialog({ error: (res?.errors || [res?.error]).filter(Boolean).join('\n') || t('workflows.import_failed') });
  wfImport.summary = res.summary || {};
  renderImportDialog({});
}

function renderImportDialog({ loading, error }) {
  const s = wfImport.summary;
  const body = $('#wf-import-body');
  const ok = $('#btn-wf-import-ok');
  const blocked = loading || !!error || !s;
  ok.disabled = blocked;
  ok.classList.toggle('hidden', !!error);
  if (loading) { body.innerHTML = `<p class="muted small">${t('workflows.import_loading')}</p>`; return; }
  if (error) {
    body.innerHTML = `<p class="small">${t('workflows.import_refused')}</p><p class="error small wf-import-errors" role="alert" data-testid="workflow-import-errors"></p>`;
    body.querySelector('[data-testid="workflow-import-errors"]').textContent = error;
    return;
  }
  const none = `<span class="muted">${t('workflows.import_no_actions')}</span>`;
  const steps = (s.steps || []).map((id) => `<span class="badge mono">${esc(id)}</span>`).join(' ') || none;
  const agents = (s.agents || []).map((a) => `<li><b>${esc(a.name)}</b> <span class="muted">·</span> <span class="mono">${a.tools?.length ? esc(a.tools.join(', ')) : t('workflows.import_no_tools')}</span></li>`).join('');
  const actions = (s.actions || []).length ? `<pre class="mono wf-import-actions">${esc(s.actions.join('\n'))}</pre>` : none;
  const ship = Array.isArray(s.ship) && s.ship.length
    ? s.ship.map((x) => `<span class="badge warn">${t('workflows.import_ship_at', { step: esc(x.step), tag: esc(x.tag || '') })}</span>`).join(' ')
    : '';
  body.innerHTML = `
      <p class="small warn-text" role="note">${t('workflows.import_code_warning')}</p>
      <dl class="wf-import-summary small">
        <dt>${t('workflows.import_steps')}</dt><dd>${steps}</dd>
        <dt>${t('workflows.import_agents')}</dt><dd>${agents ? `<ul class="wf-import-agents">${agents}</ul>` : none}</dd>
        <dt>${t('workflows.import_actions')}</dt><dd>${actions}</dd>
        ${ship ? `<dt>${t('workflows.import_ship')}</dt><dd>${ship}</dd>` : ''}
        ${s.requires ? `<dt>${t('workflows.import_requires')}</dt><dd class="mono">${esc(s.requires)}</dd>` : ''}
      </dl>
      <div class="field">
        <label for="wf-import-name">${t('workflows.import_name')}</label>
        <input type="text" id="wf-import-name" data-testid="workflow-import-name" spellcheck="false" value="${esc(s.name || '')}" />
        <p class="hint" id="wf-import-name-help"></p>
      </div>
      <div id="wf-import-replace-box"></div>
      <p class="error small wf-import-errors hidden" role="alert" data-testid="workflow-import-errors"></p>`;
  const name = body.querySelector('#wf-import-name');
  name.oninput = () => renderImportName();
  renderImportName();
}

// the name's help line and, when <name>.yaml exists, the Replace checkbox (unticked)
function renderImportName() {
  const name = $('#wf-import-name').value;
  $('#wf-import-name-help').textContent = importStem(name) ? t('workflows.import_name_help', { file: `${importStem(name)}.yaml` }) : '';
  $('#wf-import-replace-box').innerHTML = importExists(name)
    ? `<label class="check small"><input type="checkbox" data-testid="workflow-import-replace" /><span>${t('workflows.import_replace', { file: esc(`${importStem(name)}.yaml`) })}</span></label>`
    : '';
  $('#btn-wf-import-ok').disabled = !importStem(name);
}

async function confirmWorkflowImport() {
  const ok = $('#btn-wf-import-ok');
  const name = importStem($('#wf-import-name')?.value);
  if (!wfImport.summary || !name) return;
  const replace = !!$('[data-testid="workflow-import-replace"]')?.checked;
  ok.disabled = true;
  try {
    const res = await api.importWorkflow({ ...wfImport.source, name, ...(replace ? { replace: true } : {}) });
    closeWorkflowImport();
    showToast(t('workflows.imported'), t('workflows.imported_file', { file: res?.file || `${name}.yaml` }));
  } catch (e) {
    ok.disabled = false;
    const box = $('#wf-import-body [data-testid="workflow-import-errors"]');
    box.textContent = errMsg(e);
    box.classList.remove('hidden');
    return;
  }
  refreshWorkflows();
}

function closeWorkflowImport() {
  $('#wf-import-modal').classList.add('hidden');
  wfImport.source = null;
  wfImport.summary = null;
}

async function importWorkflowFile(file) {
  if (!file) return;
  try { startWorkflowImport({ text: await file.text() }); } catch (e) { showToast(t('workflows.import_failed'), errMsg(e)); }
}

function importWorkflowUrl() {
  const url = $('#wf-import-url').value.trim();
  if (url) startWorkflowImport({ url });
}

// The toolbar's controls, the drop on the tab and the dialog's buttons; keeps ?import=<url> for
// refreshWorkflows (it needs the workspace's workflows to tell an existing name).
function wireWorkflowImport() {
  const input = $('#wf-import-file');
  $('#btn-wf-import').onclick = () => input.click();
  input.onchange = () => { const file = input.files?.[0]; input.value = ''; importWorkflowFile(file); };
  $('#btn-wf-import-url').onclick = importWorkflowUrl;
  $('#wf-import-url').onkeydown = (e) => { if (e.key === 'Enter') importWorkflowUrl(); };
  const page = $('#view-workflows [data-wpage="definitions"]');
  page.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes?.('Files')) e.preventDefault(); });
  page.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    e.preventDefault();
    importWorkflowFile(file);
  });
  $('#btn-wf-import-cancel').onclick = closeWorkflowImport;
  $('#btn-wf-import-ok').onclick = confirmWorkflowImport;
  wfDefs.pendingImport = new URLSearchParams(location.search || '').get('import') || null;
}

// Once, after the Definitions tab loaded: the import a public page linked to (?import=<url>).
function takePendingImport() {
  const url = wfDefs.pendingImport;
  if (!url) return;
  wfDefs.pendingImport = null;
  startWorkflowImport({ url });
}
