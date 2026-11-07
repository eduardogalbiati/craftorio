// Type checking ratchet (issue #346): TypeScript's checker on JavaScript with JSDoc types, file by
// file. jsconfig.json keeps checkJs off; a file opts in with `// @ts-check` in its leading comments
// and imports the shared shapes from packages/shared/types.js. test/typecheck-346.test.js runs the
// checker (so `npm test` runs it on every OS) and the ratchet:
//   - CHECKED lists the files that opted in: a file that opted in is recorded here and can't opt out;
//   - NEXT is the owner's list of files to check next: a file leaves it when it opts in.
//
//   npm run typecheck            the plain checker (tsc --noEmit -p jsconfig.json)
//   node scripts/typecheck.js    the checker and the ratchet, exit 1 on any problem

const fs = require('fs');
const path = require('path');
const { sourceFiles } = require('./source-tree');

const ROOT = path.join(__dirname, '..');

// files that opted in with // @ts-check (sorted, one per line)
const CHECKED = [
  'packages/engine/domains/roadmap/roadmap-status.js',
  'packages/engine/domains/roadmap/roadmap.js',
  'packages/engine/domains/run/run-costs.js',
  'packages/engine/domains/usage/cost-estimate.js',
  'packages/engine/engine/run/accounts.js',
  'packages/engine/engine/run/checkout.js',
  'packages/engine/engine/run/costs.js',
  'packages/engine/engine/run/field-rules.js',
  'packages/engine/engine/run/gates.js',
  'packages/engine/engine/run/load.js',
  'packages/engine/engine/run/machine-steps.js',
  'packages/engine/engine/run/outputs.js',
  'packages/engine/engine/run/pr-fix.js',
  'packages/engine/engine/run/project-map-steps.js',
  'packages/engine/engine/run/refactor-proposals-steps.js',
  'packages/engine/engine/run/resume.js',
  'packages/engine/engine/run/sessions.js',
  'packages/engine/engine/run/setup.js',
  'packages/engine/engine/run/supervision.js',
  'packages/engine/engine/run/templates.js',
  'packages/engine/engine/run/test-requests.js',
  'packages/engine/engine/run/transitions.js',
  'packages/engine/engine/run/turns.js',
  'packages/shared/types.js',
];

// files the owner wants checked next (sorted, one per line); a file leaves this list when it opts in
const NEXT = [
  'packages/engine/domains/roadmap/live-roadmap.js',
  'packages/engine/domains/run/runs.js',
  'packages/engine/domains/usage/budget.js',
  'packages/engine/engine/workflow.js',
  'packages/shared/roadmap-model.js',
  'packages/shared/run-record.js',
];

const TS_CHECK = /^\/\/\s*@ts-check\b/;

function listFiles(root, dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : listFiles(root, rel);
    return e.name.endsWith('.js') ? [rel] : [];
  });
}

// true when `// @ts-check` is among the comments before the first line of code
function optsIn(text) {
  let block = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (block) {
      if (line.includes('*/')) block = false;
      continue;
    }
    if (!line || line.startsWith('#!')) continue;
    if (TS_CHECK.test(line)) return true;
    if (line.startsWith('//')) continue;
    if (line.startsWith('/*')) {
      block = !line.includes('*/');
      continue;
    }
    return false;
  }
  return false;
}

// sorted source paths (scripts/source-tree.js) of the files that carry // @ts-check
function findOptedIn({ root = ROOT } = {}) {
  return sourceFiles(root)
    .filter((rel) => optsIn(fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8')))
    .sort();
}

// [{ file, kind: 'opted-out' | 'unlisted' | 'leave-list', message }]
function checkRatchet({ root = ROOT, checked = CHECKED, next = NEXT } = {}) {
  const optedIn = new Set(findOptedIn({ root }));
  const problems = [];
  for (const file of checked) {
    if (!optedIn.has(file)) problems.push({ file, kind: 'opted-out', message: `${file} is in CHECKED but lost its // @ts-check: a file that opted in cannot opt out` });
  }
  for (const file of optedIn) {
    if (!checked.includes(file)) problems.push({ file, kind: 'unlisted', message: `${file} opted in with // @ts-check: add it to CHECKED in scripts/typecheck.js` });
    if (next.includes(file)) problems.push({ file, kind: 'leave-list', message: `${file} opted in with // @ts-check: remove it from NEXT in scripts/typecheck.js` });
  }
  return problems;
}

// [{ file, line, message }] from the checker on root/jsconfig.json (line is 1-based)
function typecheck({ root = ROOT } = {}) {
  const ts = require('typescript');
  const configPath = path.join(root, 'jsconfig.json');
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  if (!parsed) return Promise.resolve([{ file: configPath, line: 0, message: 'jsconfig.json cannot be read' }]);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, projectReferences: parsed.projectReferences });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  const errors = diagnostics
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
      if (!d.file) return { file: configPath, line: 0, message };
      const { line } = d.file.getLineAndCharacterOfPosition(d.start || 0);
      return { file: d.file.fileName, line: line + 1, message };
    });
  return Promise.resolve(errors);
}

if (require.main === module) {
  typecheck().then((errors) => {
    const problems = checkRatchet();
    for (const e of errors) console.error(`${path.relative(ROOT, e.file).replace(/\\/g, '/')}:${e.line} ${e.message}`);
    for (const p of problems) console.error(p.message);
    console.log(`${CHECKED.length} files checked, ${NEXT.length} next; ${errors.length} type errors, ${problems.length} ratchet problems`);
    process.exitCode = errors.length || problems.length ? 1 : 0;
  });
}

module.exports = {
  CHECKED,
  checkRatchet,
  findOptedIn,
  NEXT,
  typecheck,
};
