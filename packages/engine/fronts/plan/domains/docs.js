// Write doc (#647, docs/work/write-doc/spec.md R1, R3, R5, R11, R13): the Documents service, the
// only code that writes a work item's stage documents (the write-doc agents only read). Plain
// synchronous functions, the repository folder first; git runs in that folder with its own config.
// - listItems(dir) → [{ item, title?, stage, docs: [{ doc, file, status, translation }] }] from the front
//   matter of docs/work/<item>/intent.md, spec.md, (#633) plan.md and (#702) test.md once a run wrote it
//   (a `not started` skeleton is not listed) (stage: the latest document's; title: the latest document's
//   heading, #670; issue?: #12, the first document's `issue:` front matter, quotes dropped, when it names
//   a `#N`); [] without docs/work;
// - readDoc(dir, { item, doc }) → { item, doc, status, source: { file, markdown }, translation: { file, markdown } | null };
// - createDoc(dir, { item, doc, title, date }) → { item, doc, commit }: the playbook's skeleton of the
//   document and its pt-BR translation (the sections of DocModel's lint, one line each to write), one
//   commit; a folder that is not a repository yet gets `git init` first;
// - applyDraft(dir, { item, doc, source, translation }) → { commit, problems }: the writer's whole
//   draft, written only when it passes the machine lint (DocModel.lintDoc), else the skeleton stays;
// - applyRequest(dir, { item, doc, messageId, request?, source: { lines, text }, translation: { lines, text } })
//   → { commit, problems }: the lines swapped in <doc>.md and <doc>.pt-BR.md, ONE commit whose message
//   has the request (subject) and the `Doc-Request: <messageId>` trailer; problems: the lint after it;
// - listChanges(dir, { base?, item?, doc? }) → [{ commit, messageId, subject, files, undone }] one per
//   request, newest last; undoChange(dir, { commit }) → { commit }: a revert with the `Doc-Undo:` trailer;
// - unreviewed(dir, runDir, { base? }) / markReviewed(runDir, commit): the changes not undone and not
//   marked, the marks in <runDir>/docs-reviewed.json;
// - readAt(dir, { item, doc, commit }) → { file, before, after }: the source at the change's parent and at it;
// - acceptDoc(dir, { item, doc, approver?, date? }) → { commit, status }: intent → accepted, spec →
//   signed off, plan → accepted (#633), approver and date in both front matters, one commit, the bodies unchanged; already
//   accepted: HEAD, no commit;
// - ensureBranch(dir, branch): a detached checkout (a run's worktree) gets that branch, else its own.
// #650 (spec R16) Maintain: docs/work/<item>/maintain.md, written by the Monitor and the Night watch, never
// by the writer (readDoc and listChanges read it, listItems gives it as the item's `maintain: { file, status }`):
// - recordIncident(dir, { item, date?, source, error, diagnosis?, title? }) → { commit, intent: { item, file } }:
//   a row in the ## Incidents table of maintain.md (and of maintain.pt-BR.md when it exists; maintain.md
//   from the playbook's skeleton when the item has none) and a NEW item docs/work/<new>/intent.md (a
//   draft, English only, named after `title` or the error) whose `from:` and body link back; ONE commit;
// - writePostMortem(dir, { item, intent, text }) → { commit }: a ### <intent> paragraph under ## Post-mortems;
// - listIntents(dir) → [{ item, title?, file, status, from }] every docs/work/<item>/intent.md (from: the
//   link back of an incident's intent, null otherwise), the Documents' Intents tab.
// undoChange refuses (the files as they were) when a later request changed the same lines.
// A request, an item or a document outside docs/work/<item>/ is refused before anything is written.
// A repository without an identity commits as the person at this machine (user.name/user.email given
// to that commit only). git(dir, args) and commit(dir, files, message) are shared with the mockups
// domain (#625, packages/engine/fronts/plan/domains/mockups.js).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const DocModel = require('@craftorio/shared/doc-model');
const { gitOut } = require('@craftorio/engine/service/common');

const DOCS = ['intent', 'spec', 'plan']; // #633: the plan, the pre-flow's third document
const LISTED = [...DOCS, 'test']; // #702: test.md (written by the runs, sdlc-record / sdlc-test) is listed, never created here
const READABLE = [...LISTED, 'maintain']; // #650: maintain.md is read and listed, never created or accepted
const MESSAGE_ID = /^[\w.:-]{1,100}$/;
const COMMIT = /^[0-9a-f]{7,40}$/i;
const REQUEST_TRAILER = /^Doc-Request: (\S+)$/m;
const UNDO_TRAILER = /^Doc-Undo: ([0-9a-f]+)$/m;
const REVIEWED_FILE = 'docs-reviewed.json';
// the playbook's sections per document, English then Português (Brasil), in the same order
const SKELETON = {
  intent: [
    ['Problem', 'Problema'],
    ['Proposed outcome', 'Resultado proposto'],
    ['Affected users and systems', 'Usuários e sistemas afetados'],
    ['Constraints', 'Restrições'],
    ['Open questions', 'Perguntas em aberto'],
  ],
  spec: [
    ['Requirements', 'Requisitos'],
    ['Design', 'Design'],
    ['Areas of concern', 'Pontos de atenção'],
    ['Open questions', 'Perguntas em aberto'],
  ],
  plan: [
    ['Files that change', 'Arquivos que mudam'],
    ['Order of work', 'Ordem do trabalho'],
    ['Risks', 'Riscos'],
    ['Proof', 'Prova'],
  ],
};
const TITLE = { intent: ['Intent', 'Intenção'], spec: ['Spec', 'Spec'], plan: ['Plan', 'Plano'] };
const TO_WRITE = ['To be written with the writer.', 'A escrever com o writer.'];

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
}
const gitOrNull = gitOut;

// -c user.name/user.email when the repository has no identity of its own: the person at this
// machine, whose requests these commits are (identityArgs of worktree.js is the engine's own, async)
function identity(dir) {
  if (gitOrNull(dir, ['config', 'user.name']) && gitOrNull(dir, ['config', 'user.email'])) return [];
  let name = 'owner';
  try { name = os.userInfo().username || name; } catch { /* no user info */ }
  return ['-c', `user.name=${name}`, '-c', `user.email=${name}@localhost`];
}

function commit(dir, files, message) {
  git(dir, ['add', '--', ...files]);
  git(dir, [...identity(dir), 'commit', '-q', '-m', message, '--', ...files]);
  return git(dir, ['rev-parse', 'HEAD']);
}

// A run's worktree starts detached at its base: its requests go on this branch (merge: local takes it).
// The same lines as saveWork's in packages/engine/engine/worktree.js, kept synchronous here (that one is async and internal).
function ensureBranch(dir, branch) {
  if (gitOrNull(dir, ['symbolic-ref', '-q', 'HEAD'])) return git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  git(dir, ['switch', '-q', '-c', branch]);
  return branch;
}

function checkItem(item) {
  const name = String(item ?? '');
  if (!DocModel.isItemName(name)) throw new Error(`Not a work item of docs/work: ${name}`);
  return name;
}
function checkDoc(doc, allowed = DOCS) {
  if (!allowed.includes(doc)) throw new Error(`Not a stage document: ${doc} (${allowed.join(', ')})`);
  return doc;
}

// { source, translation }: the repository-relative files of a document (`/`) and their full paths
function files(dir, item, doc, allowed = DOCS) {
  const rel = (name) => `docs/work/${checkItem(item)}/${name}`;
  const source = rel(`${checkDoc(doc, allowed)}.md`);
  const translation = rel(`${doc}.pt-BR.md`);
  const full = (r) => path.join(dir, ...r.split('/'));
  const root = path.join(dir, 'docs', 'work', item);
  for (const f of [source, translation]) {
    if (path.relative(root, full(f)).startsWith('..')) throw new Error(`Outside docs/work/${item}/: ${f}`);
  }
  return { source, translation, full };
}
const readText = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
// #670: the item's title, what the owner named it: the document's heading without "Intent: " / "Spec: "
const titleOf = (text) => {
  const heading = /^# (?:(?:Intent|Spec|Plan): )?(.+)$/m.exec(text);
  return heading ? heading[1].trim() : null;
};

function listItems(dir) {
  const work = path.join(dir, 'docs', 'work');
  if (!fs.existsSync(work)) return [];
  const items = [];
  for (const entry of fs.readdirSync(work, { withFileTypes: true })) {
    if (!entry.isDirectory() || !DocModel.isItemName(entry.name)) continue;
    const docs = [];
    let stage = null;
    let title = null;
    let issue = null;
    for (const doc of LISTED) {
      const text = readText(path.join(work, entry.name, `${doc}.md`));
      if (text === null) continue;
      const fm = DocModel.frontMatter(text);
      // #702: a plan whose Progress is N of N done is built (sdlc-record sets it too); a status's inline comment is not shown
      const status = (doc === 'plan' ? DocModel.planStatus(text) : String(fm.status || '').replace(/\s+#.*$/, '').trim()) || 'draft';
      // #702: a test.md no run wrote yet (`not started`, the skeleton) neither advances the stage nor is the latest document
      if (doc === 'test' && status === 'not started') continue;
      docs.push({ doc, file: `docs/work/${entry.name}/${doc}.md`, status, translation: fm.translation || null });
      stage = fm.stage || doc;
      if (doc !== 'test') title = titleOf(text) || title;
      // #12 the issue (or the epic's phase issue) the first document names in its `issue:` field
      issue = issue || DocModel.issueRef(fm.issue)?.text || null;
    }
    // #650: the Maintain stage's document, apart from `docs` (the pre-flow's, whose latest is the row's
    // stage and pill) for the editor's stepper
    const text = docs.length ? readText(path.join(work, entry.name, 'maintain.md')) : null;
    const maintain = text === null ? null : { file: `docs/work/${entry.name}/maintain.md`, status: DocModel.frontMatter(text).status || 'no incidents' };
    if (docs.length) items.push({ item: entry.name, ...(title ? { title } : {}), stage, docs, ...(issue ? { issue } : {}), ...(maintain ? { maintain } : {}) });
  }
  return items.sort((a, b) => a.item.localeCompare(b.item));
}

function readDoc(dir, { item, doc }) {
  const f = files(dir, item, doc, READABLE);
  const markdown = readText(f.full(f.source));
  if (markdown === null) throw new Error(`No ${doc} for ${item} yet.`);
  const translation = readText(f.full(f.translation));
  return {
    item,
    doc,
    status: DocModel.frontMatter(markdown).status || 'draft',
    source: { file: f.source, markdown },
    translation: translation === null ? null : { file: f.translation, markdown: translation },
  };
}

function skeleton({ item, doc, title, date, lang }) {
  const i = lang === 'en' ? 0 : 1;
  const head = ['---', `item: ${item}`, `stage: ${doc}`, 'status: draft', `date: ${date}`,
    lang === 'en' ? `translation: ${doc}.pt-BR.md` : `source: ${doc}.md`, '---', '', `# ${TITLE[doc][i]}: ${title}`, ''];
  const body = SKELETON[doc].flatMap((names) => [`## ${names[i]}`, '', TO_WRITE[i], '']);
  return [...head, ...body].join('\n');
}

function createDoc(dir, { item, doc, title, date }) {
  const f = files(dir, item, doc);
  if (fs.existsSync(f.full(f.source))) throw new Error(`docs/work/${item}/${doc}.md already exists.`);
  if (!fs.existsSync(path.join(dir, '.git')) && gitOrNull(dir, ['rev-parse', '--is-inside-work-tree']) !== 'true') git(dir, ['init', '-q']);
  const day = date || new Date().toISOString().slice(0, 10);
  const name = String(title || item).replace(/\s+/g, ' ').trim().slice(0, 200);
  fs.mkdirSync(path.dirname(f.full(f.source)), { recursive: true });
  fs.writeFileSync(f.full(f.source), skeleton({ item, doc, title: name, date: day, lang: 'en' }));
  fs.writeFileSync(f.full(f.translation), skeleton({ item, doc, title: name, date: day, lang: 'pt-BR' }));
  return { item, doc, commit: commit(dir, [f.source, f.translation], `docs(${item}): start the ${doc}`) };
}

function lint(doc, source, translation) {
  const problems = DocModel.lintDoc({ kind: doc, markdown: source }).problems;
  return translation === null ? problems : [...problems, ...DocModel.lintTranslation(source, translation)];
}

function applyDraft(dir, { item, doc, source, translation }) {
  const f = files(dir, item, doc);
  const en = String(source ?? '');
  const pt = String(translation ?? '');
  const problems = lint(doc, en, pt);
  if (problems.length) return { commit: null, problems };
  fs.writeFileSync(f.full(f.source), en);
  fs.writeFileSync(f.full(f.translation), pt);
  if (!git(dir, ['status', '--porcelain', '--', f.source, f.translation])) return { commit: null, problems };
  return { commit: commit(dir, [f.source, f.translation], `docs(${item}): draft the ${doc}`), problems };
}

const checkLines = (l, what) => {
  const start = Number(l?.start);
  const end = Number(l?.end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) throw new Error(`Invalid lines of the ${what}.`);
  return { start, end };
};

function applyRequest(dir, { item, doc, messageId, request, source, translation }) {
  const f = files(dir, item, doc);
  if (!MESSAGE_ID.test(String(messageId ?? ''))) throw new Error('A request needs its message id.');
  const en = readText(f.full(f.source));
  if (en === null) throw new Error(`No ${doc} for ${item} yet.`);
  const pt = readText(f.full(f.translation));
  const changed = [f.source];
  const nextEn = DocModel.replaceLines(en, checkLines(source?.lines, 'source'), String(source?.text ?? ''));
  let nextPt = pt;
  if (translation && pt !== null) {
    nextPt = DocModel.replaceLines(pt, checkLines(translation.lines, 'translation'), String(translation.text ?? ''));
    changed.push(f.translation);
  }
  fs.writeFileSync(f.full(f.source), nextEn);
  if (nextPt !== pt) fs.writeFileSync(f.full(f.translation), nextPt);
  const subject = String(request || `edit the ${doc}`).replace(/\s+/g, ' ').trim().slice(0, 120);
  const sha = commit(dir, changed, `docs(${item}): ${subject}\n\nDoc-Request: ${messageId}`);
  return { commit: sha, problems: lint(doc, nextEn, nextPt) };
}

function listChanges(dir, { base, item, doc } = {}) {
  if (base && !COMMIT.test(String(base))) throw new Error('Not a commit.');
  const range = base ? `${base}..HEAD` : 'HEAD';
  const scope = item ? [`docs/work/${checkItem(item)}/${doc ? `${checkDoc(doc, READABLE)}.` : ''}`] : ['docs/work/'];
  const out = gitOrNull(dir, ['log', '--reverse', '--format=%x1e%H%x1f%B%x1f', '--name-only', range, '--', ...scope.map((s) => (s.endsWith('/') ? s : `${s}*`))]);
  if (!out) return [];
  const records = out.split('\x1e').filter(Boolean).map((rec) => {
    const [hash, body, names] = rec.split('\x1f');
    return { commit: hash.trim(), body: body || '', files: String(names || '').split('\n').map((s) => s.trim()).filter(Boolean) };
  });
  const undone = new Set(records.map((r) => r.body.match(UNDO_TRAILER)?.[1]).filter(Boolean));
  return records.filter((r) => REQUEST_TRAILER.test(r.body)).map((r) => ({
    commit: r.commit,
    messageId: r.body.match(REQUEST_TRAILER)[1],
    subject: r.body.split('\n')[0].replace(/^docs\([^)]*\): /, ''),
    files: r.files,
    undone: undone.has(r.commit),
  }));
}

function undoChange(dir, { commit: sha }) {
  if (!COMMIT.test(String(sha ?? ''))) throw new Error('Not a commit.');
  const body = git(dir, ['log', '-1', '--format=%B', sha]);
  const id = body.match(REQUEST_TRAILER)?.[1];
  if (!id) throw new Error(`${sha} is not a change by request.`);
  const full = git(dir, ['rev-parse', sha]);
  const changed = git(dir, ['show', '--name-only', '--format=', full]).split('\n').map((s) => s.trim()).filter(Boolean);
  try {
    git(dir, ['revert', '--no-commit', full]);
  } catch {
    // a later request changed the same lines: the files go back as they were, nothing is undone
    gitOrNull(dir, ['revert', '--abort']);
    throw new Error(`A later change touches the same lines as ${full.slice(0, 8)}: undo that one first.`);
  }
  const subject = body.split('\n')[0].replace(/^docs\(([^)]*)\): /, 'docs($1): undo ');
  return { commit: commit(dir, changed, `${subject}\n\nDoc-Undo: ${full}`) };
}

// #671 the source markdown before a change and at it (the editor's Diff tab, mock-3); '' where the file
// did not exist
function readAt(dir, { item, doc, commit: sha }) {
  if (!COMMIT.test(String(sha ?? ''))) throw new Error('Not a commit.');
  const f = files(dir, item, doc);
  const at = (rev) => gitOrNull(dir, ['show', `${rev}:${f.source}`]) || '';
  return { item, doc, commit: sha, file: f.source, before: at(`${sha}^`), after: at(sha) };
}

const reviewedFile = (runDir) => path.join(runDir, REVIEWED_FILE);
function reviewedSet(runDir) {
  try { return new Set(JSON.parse(fs.readFileSync(reviewedFile(runDir), 'utf8')).commits || []); } catch { return new Set(); }
}

function markReviewed(runDir, sha) {
  if (!COMMIT.test(String(sha ?? ''))) throw new Error('Not a commit.');
  const set = reviewedSet(runDir);
  set.add(sha);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(reviewedFile(runDir), JSON.stringify({ commits: [...set] }, null, 2));
  return [...set];
}

function unreviewed(dir, runDir, opts = {}) {
  const seen = reviewedSet(runDir);
  return listChanges(dir, opts).filter((c) => !c.undone && !seen.has(c.commit));
}

function acceptDoc(dir, { item, doc, approver, date }) {
  const f = files(dir, item, doc);
  const status = DocModel.ACCEPTED[doc];
  const fields = {
    status,
    approver: String(approver || gitOrNull(dir, ['config', 'user.name']) || 'owner').replace(/\s+/g, ' ').trim(),
    date: date || new Date().toISOString().slice(0, 10),
  };
  const changed = [];
  for (const rel of [f.source, f.translation]) {
    const text = readText(f.full(rel));
    if (text === null) continue;
    fs.writeFileSync(f.full(rel), DocModel.setFrontMatter(text, fields));
    changed.push(rel);
  }
  if (!changed.length) throw new Error(`No ${doc} for ${item} yet.`);
  // accepted already (a second click after the gate's answer failed): nothing new to commit
  if (!git(dir, ['status', '--porcelain', '--', ...changed])) return { commit: git(dir, ['rev-parse', 'HEAD']), status };
  const verb = { spec: 'sign off the spec', plan: 'accept the plan' }[doc] || 'accept the intent';
  return { commit: commit(dir, changed, `docs(${item}): ${verb}`), status };
}

// #650 the playbook's maintain.md (docs/work/write-doc/maintain.md), for an item that has none yet
const MAINTAIN = {
  incidents: ['## Incidents', '## Incidentes'],
  empty: 'no incidents',
  postMortems: '## Post-mortems',
};
// the table's "nothing yet" row, in either language (its last cell says "no incidents" / "nenhum incidente")
const EMPTY_ROW = '| — | — | — | — |';
function maintainSkeleton(item) {
  return ['---', `item: ${item}`, 'stage: maintain', 'status: no incidents', '---', '',
    '# Maintain: incidents and post-mortems', '',
    'A Monitor error or a Night watch finding tied to this item comes in here; its diagnosis becomes a new intent, linking back.', '',
    MAINTAIN.incidents[0], '', '| Date | Source | Error | New intent | Fix |', '|---|---|---|---|---|',
    `${EMPTY_ROW} ${MAINTAIN.empty} |`, '', MAINTAIN.postMortems, '',
    'For each resolved incident, a short post-mortem: what happened, the impact, the cause, what was fixed and what changed so it does not happen again.', ''].join('\n');
}

// [start, end) of the lines of the section `heading` (its heading excluded), -1 when it is missing
function sectionRange(rows, heading) {
  const start = rows.findIndex((l) => l.trim() === heading);
  if (start < 0) return [-1, -1];
  const next = rows.findIndex((l, i) => i > start && /^##\s/.test(l));
  return [start + 1, next < 0 ? rows.length : next];
}

// the incident's row in the table of `heading`, in place of the skeleton's "no incidents" row
function addIncidentRow(text, heading, row) {
  const rows = text.split('\n');
  let [start, end] = sectionRange(rows, heading);
  if (start < 0) {
    rows.push('', heading, '', '| Date | Source | Error | New intent | Fix |', '|---|---|---|---|---|');
    [start, end] = [rows.length - 3, rows.length];
  }
  const at = rows.findIndex((l, i) => i >= start && i < end && l.startsWith(EMPTY_ROW));
  if (at >= 0) {
    rows[at] = row;
    return rows.join('\n');
  }
  let last = -1;
  for (let i = start; i < end; i += 1) if (rows[i].startsWith('|')) last = i;
  rows.splice(last < 0 ? end : last + 1, 0, row);
  return rows.join('\n');
}

const cell = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');

// a free item name under docs/work: the title's, then -2, -3…
function freeItem(dir, title) {
  const base = DocModel.itemName(title).slice(0, 60).replace(/-+$/, '') || 'incident';
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? base : `${base}-${n}`;
    if (!fs.existsSync(path.join(dir, 'docs', 'work', name))) return name;
  }
}

function recordIncident(dir, { item, date, source, error, diagnosis, title }) {
  const name = checkItem(item);
  const folder = path.join(dir, 'docs', 'work', name);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error(`No work item ${name} in docs/work.`);
  const day = date || new Date().toISOString().slice(0, 10);
  const what = String(error ?? '').replace(/\s+/g, ' ').trim();
  if (!what) throw new Error('An incident needs its error.');
  const origin = cell(source || 'monitor');
  const headline = String(title || what).replace(/\s+/g, ' ').trim().slice(0, 200);
  const fresh = freeItem(dir, headline);
  const intentFile = `docs/work/${fresh}/intent.md`;
  const back = `../${name}/maintain.md`;
  const intent = ['---', `item: ${fresh}`, 'stage: intent', 'status: draft', `date: ${day}`, `from: ${back}`, '---', '',
    `# Intent: ${headline}`, '',
    `From an incident of [${name}](${back}) (${origin}, ${day}).`, '',
    `## ${SKELETON.intent[0][0]}`, '', what, '',
    ...(diagnosis ? [String(diagnosis).trim(), ''] : []),
    ...SKELETON.intent.slice(1).flatMap((names) => [`## ${names[0]}`, '', TO_WRITE[0], ''])].join('\n');
  const row = `| ${cell(day)} | ${origin} | ${cell(what)} | [${fresh}](../${fresh}/intent.md) | — |`;
  const changed = [];
  for (const [i, rel] of [`docs/work/${name}/maintain.md`, `docs/work/${name}/maintain.pt-BR.md`].entries()) {
    const full = path.join(dir, ...rel.split('/'));
    let text = readText(full);
    if (text === null) {
      if (i > 0) continue;
      text = maintainSkeleton(name);
    }
    text = addIncidentRow(text, MAINTAIN.incidents[i], row);
    fs.writeFileSync(full, DocModel.setFrontMatter(text, { status: 'incidents' }));
    changed.push(rel);
  }
  fs.mkdirSync(path.join(dir, 'docs', 'work', fresh), { recursive: true });
  fs.writeFileSync(path.join(dir, ...intentFile.split('/')), intent);
  changed.push(intentFile);
  const subject = `docs(${name}): incident from the ${origin}, new intent ${fresh}`;
  return { commit: commit(dir, changed, subject), intent: { item: fresh, file: intentFile } };
}

function writePostMortem(dir, { item, intent, text }) {
  const name = checkItem(item);
  const rel = `docs/work/${name}/maintain.md`;
  const full = path.join(dir, ...rel.split('/'));
  const markdown = readText(full);
  if (markdown === null) throw new Error(`No maintain for ${name} yet.`);
  const body = String(text ?? '').trim();
  if (!body) throw new Error('A post-mortem needs its text.');
  const rows = markdown.replace(/\n+$/, '').split('\n');
  let [, end] = sectionRange(rows, MAINTAIN.postMortems);
  if (end < 0) {
    rows.push('', MAINTAIN.postMortems);
    end = rows.length;
  }
  const heading = intent ? `### ${checkItem(intent)}` : '### Post-mortem';
  rows.splice(end, 0, '', heading, '', body, ...(end < rows.length ? [''] : []));
  fs.writeFileSync(full, `${rows.join('\n')}\n`);
  return { commit: commit(dir, [rel], `docs(${name}): post-mortem${intent ? ` of ${intent}` : ''}`) };
}

function listIntents(dir) {
  const work = path.join(dir, 'docs', 'work');
  if (!fs.existsSync(work)) return [];
  const out = [];
  for (const entry of fs.readdirSync(work, { withFileTypes: true })) {
    if (!entry.isDirectory() || !DocModel.isItemName(entry.name)) continue;
    const text = readText(path.join(work, entry.name, 'intent.md'));
    if (text === null) continue;
    const fm = DocModel.frontMatter(text);
    const title = titleOf(text);
    out.push({
      item: entry.name,
      ...(title ? { title } : {}),
      file: `docs/work/${entry.name}/intent.md`,
      status: fm.status || 'draft',
      from: fm.from || null,
    });
  }
  return out.sort((a, b) => a.item.localeCompare(b.item));
}

module.exports = {
  acceptDoc,
  applyDraft,
  applyRequest,
  commit,
  createDoc,
  ensureBranch,
  git,
  listChanges,
  listIntents,
  listItems,
  markReviewed,
  readAt,
  readDoc,
  recordIncident,
  undoChange,
  unreviewed,
  writePostMortem,
};
