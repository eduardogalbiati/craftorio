// #702 `type: record_docs` (the post-flow sdlc-record, docs/agents/engine/machine-steps.md): records
// what a successful Code & Build run produced in its work item's documents, without a model. The
// engine's runRecordDocsStep (run/machine-steps.js) calls it in the run's own worktree.
// - recordDocs(repoDir, { item, run, merged_commit, pr_url, issues, evidence, runDir?, branch?, date? })
//   → { kind: 'record_docs', status: recorded | invalid, commit, files, problems, built, notes, message }:
//   - docs/work/<item>/plan.md (and plan.pt-BR.md): the `## Progress` row of the run's step (an issue
//     of `issues` in its Step cell, else the first row not done) gets done / feito, the run and the
//     merged commit (7 characters) or the PR; every row done → front matter `status: built`;
//   - test.md (and test.pt-BR.md): one row under `## Suite and tests` / `## Suíte e testes` (Run | Unit |
//     E2E | Screenshots | Axe | Result; a 4-column table gets the 6-column header), never an empty cell:
//     0 screenshots → the run's reason (evidence.screenshots_reason); front matter `status: collecting`;
//   - the screenshots (absolute paths, or relative to `runDir`, the Code & Build run's folder) copied
//     to docs/work/<item>/images/ and listed under the screenshots section;
//   - DocModel's lint (lintDoc, lintTranslation) on every document before anything is written: a
//     problem writes nothing and commits nothing (status invalid, problems listed); else ONE commit
//     `docs(<item>): record run <run>` on `branch` when the checkout is detached (a run's worktree).
// It reads only those inputs: the run's declared `evidence` output, its merged_commit / pr_url.
'use strict';

const fs = require('fs');
const path = require('path');
const DocModel = require('@multiagent/shared/doc-model');
const { git, identityArgs } = require('./worktree');

const ITEM = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
const SUITE = ['## Suite and tests', '## Suíte e testes'];
const SHOTS = ['## Before and after screenshots', '## Screenshots de antes e depois'];
const HEADER = {
  en: ['| Run | Unit | E2E | Screenshots | Axe | Result |', '|---|---|---|---|---|---|'],
  pt: ['| Run | Unit | E2E | Screenshots | Axe | Resultado |', '|---|---|---|---|---|---|'],
};
const WORDS = {
  en: { done: 'done', pass: 'pass', fail: 'fail', notRun: 'not run', passed: 'passed', failed: 'failed', taken: 'taken', none: 'none', noAxe: 'no findings', noReason: 'the run gave no reason' },
  pt: { done: 'feito', pass: 'passou', fail: 'falhou', notRun: 'não rodou', passed: 'passaram', failed: 'falharam', taken: 'tirados', none: 'nenhum', noAxe: 'nenhum achado', noReason: 'a run não deu o motivo' },
};
const cell = DocModel.tableCell;

// pass | fail | not run of a suite / E2E evidence (an object with a status, or a text)
function verdict(value) {
  const s = String((value && typeof value === 'object' ? value.status : value) || '').toLowerCase();
  if (/\bfail/.test(s)) return 'fail';
  if (/\bpass/.test(s)) return 'pass';
  return 'not run';
}

// the Unit / E2E cell: the runner's counts, else its status (or the text it gave)
function countsCell(value, w) {
  if (value && typeof value === 'object') {
    if (value.passed != null || value.failed != null) return `${value.passed ?? 0} ${w.passed}, ${value.failed ?? 0} ${w.failed}`;
    if (value.message) return cell(value.message);
  }
  const v = verdict(value);
  if (typeof value === 'string' && value.trim() && !['pass', 'fail', 'not run'].includes(value.trim().toLowerCase())) return cell(value);
  return { pass: w.pass, fail: w.fail, 'not run': w.notRun }[v];
}

const axeCell = (axe, w) => {
  if (typeof axe === 'string' && axe.trim()) return cell(axe);
  const list = Array.isArray(axe) ? axe : [];
  if (!list.length) return w.noAxe;
  return cell(list.map((f) => (typeof f === 'string' ? f : `${f.id || f.rule || 'finding'}${f.impact ? ` (${f.impact})` : ''}`)).join(', '));
};

const screensCell = (names, reason, w) => (names.length
  ? cell(`${names.length} ${w.taken}: ${[...new Set(names.map((n) => n.replace(/\.(original|modified)?\.?(png|jpe?g|webp)$/i, '')))].join(', ')}`)
  : cell(`${w.none}: ${reason || w.noReason}`));

function resultCell(evidence, w) {
  const all = [verdict(evidence.suite), verdict(evidence.e2e)];
  if (all.includes('fail')) return w.fail;
  return all[0] === 'pass' ? w.pass : w.notRun;
}

function issueNumbers(issues) {
  return new Set((Array.isArray(issues) ? issues : [issues]).flatMap((x) => {
    const v = x && typeof x === 'object' ? (x.number ?? x.url ?? '') : x;
    const m = String(v ?? '').match(/(\d+)\s*$/);
    return m ? [Number(m[1])] : [];
  }));
}

// the index (in progressRows) of the run's step: an issue it implemented in the Step cell, else the first row not done
function stepRow(rows, numbers) {
  const byIssue = rows.findIndex((r) => [...String(r.cells[0]).matchAll(/#(\d+)\b/g)].some((m) => numbers.has(Number(m[1]))));
  if (byIssue >= 0) return byIssue;
  return rows.findIndex((r) => !['done', 'feito'].includes(String(r.cells[1] || '').toLowerCase()));
}

// the plan's text with row `k` of Progress done, and `status: built` when every row is
function markProgress(text, k, values, w) {
  if (text === null || k < 0) return text;
  const rows = DocModel.progressRows(text);
  if (!rows[k]) return text;
  const lines = text.split('\n');
  const c = rows[k].cells;
  lines[rows[k].index] = `| ${[c[0], w.done, cell(values.run), cell(values.ref), ...c.slice(4)].join(' | ')} |`;
  const next = lines.join('\n');
  return DocModel.planBuilt(next) ? DocModel.setFrontMatter(next, { status: 'built' }) : next;
}

// the evidence table's header with the Screenshots and Axe columns (a 4-column skeleton gets them)
function widenHeader(text, lang) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => SUITE.includes(l.trim()));
  if (at < 0) return text;
  const head = lines.findIndex((l, i) => i > at && /^\s*\|/.test(l));
  if (head < 0 || lines.slice(at + 1, head).some((l) => /^#{1,2}\s/.test(l))) return text;
  if (lines[head].split('|').length - 2 >= 6) return text;
  lines.splice(head, 2, ...HEADER[lang]);
  return lines.join('\n');
}

// test.md (EN or pt-BR) with the run's row, its images listed and `status: collecting`
function recordTest(text, lang, row, images, run, date) {
  if (text === null) return null;
  let next = widenHeader(text, lang);
  if (!next.includes(`| ${run} |`)) {
    const added = DocModel.addTableRow(next, SUITE, row);
    next = added === next ? `${next.replace(/\n*$/, '\n')}\n${SUITE[lang === 'en' ? 0 : 1]}\n\n${HEADER[lang].join('\n')}\n${row}\n` : added;
  }
  if (images.length) {
    const lines = next.split('\n');
    const at = lines.findIndex((l) => SHOTS.includes(l.trim()));
    const shown = images.filter((img) => !next.includes(`](images/${img.name})`)).map((img) => `- ${run}: ![${cell(img.caption || img.name)}](images/${img.name})`);
    if (at < 0) lines.push('', SHOTS[lang === 'en' ? 0 : 1], '', ...shown);
    else {
      let end = lines.findIndex((l, i) => i > at && /^#{1,2}\s/.test(l));
      if (end < 0) end = lines.length;
      while (end > at + 1 && !lines[end - 1].trim()) end -= 1;
      lines.splice(end, 0, '', ...shown);
    }
    next = lines.join('\n');
  }
  const fm = DocModel.frontMatter(next);
  return DocModel.setFrontMatter(next, { status: 'collecting', ...(fm.date ? {} : { date }) });
}

const readText = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

async function recordDocs(repoDir, { item, run, merged_commit: mergedCommit, pr_url: prUrl, issues, evidence, runDir, branch, date } = {}) {
  const name = String(item ?? '');
  if (!ITEM.test(name) || name.includes('..')) throw new Error(`Not a work item of docs/work: ${name}`);
  const runId = String(run ?? '').trim();
  if (!runId) throw new Error('record_docs needs the Code & Build run it records.');
  const folder = path.join(repoDir, 'docs', 'work', name);
  const rel = (f) => `docs/work/${name}/${f}`;
  const original = Object.fromEntries(['plan.md', 'plan.pt-BR.md', 'test.md', 'test.pt-BR.md'].map((f) => [f, readText(path.join(folder, f))]));
  if (original['plan.md'] === null) throw new Error(`No plan for ${name}: ${rel('plan.md')} is missing.`);
  const ev = evidence && typeof evidence === 'object' ? evidence : {};
  const day = date || new Date().toISOString().slice(0, 10);
  const notes = [];

  // the screenshots to copy: absolute paths, or relative to the Code & Build run's folder
  const images = (Array.isArray(ev.screenshots) ? ev.screenshots : []).map((s) => (typeof s === 'string' ? { path: s } : s || {}))
    .map((s) => ({ ...s, from: path.isAbsolute(String(s.path || '')) ? s.path : (runDir && s.path ? path.join(runDir, s.path) : null) }))
    .filter((s) => {
      const ok = s.from && fs.existsSync(s.from);
      if (!ok && s.path) notes.push(`screenshot not found: ${s.path}`);
      return ok;
    })
    .map((s) => ({ from: s.from, name: path.basename(s.from), caption: s.caption || '' }));

  // the plan's Progress row (the same row, by order, in the translation)
  const progress = DocModel.progressRows(original['plan.md']);
  const k = stepRow(progress, issueNumbers(issues));
  if (!progress.length) notes.push(`${rel('plan.md')} has no Progress table`);
  else if (k < 0) notes.push('every Progress row is done already');
  const ref = [mergedCommit ? String(mergedCommit).slice(0, 7) : '', prUrl || ''].filter(Boolean).join(', ') || '—';
  const next = {
    'plan.md': markProgress(original['plan.md'], k, { run: runId, ref }, WORDS.en),
    'plan.pt-BR.md': markProgress(original['plan.pt-BR.md'], k, { run: runId, ref }, WORDS.pt),
  };
  // the evidence row, EN and pt-BR
  const row = (w) => `| ${[cell(runId), countsCell(ev.suite, w), countsCell(ev.e2e, w), screensCell(images.map((i) => i.name), ev.screenshots_reason, w), axeCell(ev.axe, w), resultCell(ev, w)].join(' | ')} |`;
  next['test.md'] = recordTest(original['test.md'], 'en', row(WORDS.en), images, runId, day);
  next['test.pt-BR.md'] = recordTest(original['test.pt-BR.md'], 'pt', row(WORDS.pt), images, runId, day);
  if (next['test.md'] === null) notes.push(`${rel('test.md')} is missing: no evidence row written`);

  // DocModel's lint before anything is written (a docs commit runs no tests, #695)
  const exists = (target) => images.some((i) => `images/${i.name}` === target) || fs.existsSync(path.join(folder, target));
  const problems = [];
  const lint = (file, kind, source) => {
    if (next[file] === null) return;
    const md = next[file];
    const found = source ? DocModel.lintTranslation(next[source], md) : DocModel.lintDoc({ kind, markdown: md, exists }).problems;
    problems.push(...found.map((p) => ({ file: rel(file), ...p })));
  };
  lint('plan.md', 'plan');
  lint('plan.pt-BR.md', 'plan', 'plan.md');
  lint('test.md', 'test');
  if (next['test.md'] !== null) lint('test.pt-BR.md', 'test', 'test.md');
  const built = DocModel.frontMatter(next['plan.md']).status === 'built';
  const base = { kind: 'record_docs', item: name, run: runId, built, notes };
  if (problems.length) {
    return { ...base, status: 'invalid', commit: null, files: [], problems, message: `Nothing recorded: DocModel's lint found ${problems.length} problem(s) in the documents of ${name}.` };
  }

  // write, copy the images, ONE commit
  const files = [];
  for (const [file, text] of Object.entries(next)) {
    if (text === null || text === original[file]) continue;
    fs.writeFileSync(path.join(folder, file), text);
    files.push(rel(file));
  }
  if (images.length) fs.mkdirSync(path.join(folder, 'images'), { recursive: true });
  for (const img of images) {
    fs.copyFileSync(img.from, path.join(folder, 'images', img.name));
    files.push(rel(`images/${img.name}`));
  }
  if (!files.length) return { ...base, status: 'recorded', commit: null, files, problems, message: `Nothing to record for run ${runId}: the documents of ${name} have it already.` };
  if (branch && !(await git(['symbolic-ref', '-q', 'HEAD'], repoDir).catch(() => ''))) await git(['switch', '-q', '-c', branch], repoDir);
  await git(['add', '--', ...files], repoDir);
  await git([...(await identityArgs(repoDir)), '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', `docs(${name}): record run ${runId}`, '--', ...files], repoDir);
  const commit = await git(['rev-parse', 'HEAD'], repoDir);
  return {
    ...base, status: 'recorded', commit, files, problems,
    message: `Recorded run ${runId} in ${name}: ${files.length} file(s)${built ? ', the plan is built' : ''}${notes.length ? ` (${notes.join('; ')})` : ''}.`,
  };
}

module.exports = { recordDocs };
