// Write doc (#647, docs/work/write-doc/spec.md R1, R3, R5, R11, R13): the Documents service, the
// only code that writes a work item's stage documents (the write-doc agents only read). Plain
// synchronous functions, the repository folder first; git runs in that folder with its own config.
// - listItems(dir) → [{ item, stage, docs: [{ doc, file, status, translation }] }] from the front
//   matter of docs/work/<item>/intent.md and spec.md (stage: the spec's over the intent's); [] without docs/work;
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
// - acceptDoc(dir, { item, doc, approver?, date? }) → { commit, status }: intent → accepted, spec →
//   signed off, approver and date in both front matters, one commit, the bodies unchanged; already
//   accepted: HEAD, no commit;
// - ensureBranch(dir, branch): a detached checkout (a run's worktree) gets that branch, else its own.
// undoChange refuses (the files as they were) when a later request changed the same lines.
// A request, an item or a document outside docs/work/<item>/ is refused before anything is written.
// A repository without an identity commits as the person at this machine (user.name/user.email given
// to that commit only).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const DocModel = require('@multiagent/shared/doc-model');
const { gitOut } = require('@multiagent/engine/service/common');

const DOCS = ['intent', 'spec'];
const ITEM = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
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
};
const TITLE = { intent: ['Intent', 'Intenção'], spec: ['Spec', 'Spec'] };
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
  if (!ITEM.test(name) || name.includes('..')) throw new Error(`Not a work item of docs/work: ${name}`);
  return name;
}
function checkDoc(doc) {
  if (!DOCS.includes(doc)) throw new Error(`Not a stage document: ${doc} (intent or spec)`);
  return doc;
}

// { source, translation }: the repository-relative files of a document (`/`) and their full paths
function files(dir, item, doc) {
  const rel = (name) => `docs/work/${checkItem(item)}/${name}`;
  const source = rel(`${checkDoc(doc)}.md`);
  const translation = rel(`${doc}.pt-BR.md`);
  const full = (r) => path.join(dir, ...r.split('/'));
  const root = path.join(dir, 'docs', 'work', item);
  for (const f of [source, translation]) {
    if (path.relative(root, full(f)).startsWith('..')) throw new Error(`Outside docs/work/${item}/: ${f}`);
  }
  return { source, translation, full };
}
const readText = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

function listItems(dir) {
  const work = path.join(dir, 'docs', 'work');
  if (!fs.existsSync(work)) return [];
  const items = [];
  for (const entry of fs.readdirSync(work, { withFileTypes: true })) {
    if (!entry.isDirectory() || !ITEM.test(entry.name)) continue;
    const docs = [];
    let stage = null;
    for (const doc of DOCS) {
      const text = readText(path.join(work, entry.name, `${doc}.md`));
      if (text === null) continue;
      const fm = DocModel.frontMatter(text);
      docs.push({ doc, file: `docs/work/${entry.name}/${doc}.md`, status: fm.status || 'draft', translation: fm.translation || null });
      stage = fm.stage || doc;
    }
    if (docs.length) items.push({ item: entry.name, stage, docs });
  }
  return items.sort((a, b) => a.item.localeCompare(b.item));
}

function readDoc(dir, { item, doc }) {
  const f = files(dir, item, doc);
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
  const scope = item ? [`docs/work/${checkItem(item)}/${doc ? `${checkDoc(doc)}.` : ''}`] : ['docs/work/'];
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
  const verb = doc === 'spec' ? 'sign off the spec' : 'accept the intent';
  return { commit: commit(dir, changed, `docs(${item}): ${verb}`), status };
}

module.exports = {
  acceptDoc,
  applyDraft,
  applyRequest,
  createDoc,
  ensureBranch,
  listChanges,
  listItems,
  markReviewed,
  readDoc,
  undoChange,
  unreviewed,
};
