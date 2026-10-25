// "Make it a tool" (#360): the Product Owner files one issue in the project's tracker asking to build
// an analysis seed (packages/engine/domains/seed/seeds.js) as a deterministic tool in the project's repository, following
// promptToDeterministicTool of Kent Beck's ToolSeeds (MIT): a pure core with I/O at the edge,
// network data fetched by a separate step into a cache, JSON with sorted keys and commit timestamps,
// a golden test, and the seed's VERIFY steps as tests. The issue is then planned like any item (the
// Backlog, the roadmap); the tool's command, once it exists, is recorded in the project's settings
// (seeds:setTool) and replaces the Oracle turn (packages/engine/domains/oracle/oracle-seeds.js). The `analysis-tool` label is
// created through the platform adapter when the tracker lacks it (GitLab creates it itself). In
// simulation it files nothing: a preview of the title and body. Service: packages/engine/service/channels/seeds.js.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const issues = require('../backlog/issues');

const LABEL = 'analysis-tool';
const LABEL_COLOR = '5319e7';
const LABEL_TEXT = 'An analysis seed built as a deterministic tool (#360)';

// The seed's VERIFY section to the end (its steps and its "tell me" list)
const verifyOf = (body) => {
  const s = String(body || '');
  const at = s.search(/^#+\s*VERIFY\b/m);
  return at < 0 ? '' : s.slice(at).trim();
};

function toolIssue({ project, seed }) {
  const meta = seed.meta || {};
  const title = `Make the ${seed.id} analysis a deterministic tool`;
  const body = [
    `Build the analysis seed \`${seed.id}\` as a deterministic tool in this repository, so the project's ${seed.id} analysis runs for free and gives the same answer on the same commit.`,
    '',
    meta.summary ? `What it shows: ${meta.summary}.` : '',
    Array.isArray(meta.needs) && meta.needs.length ? `What it reads: ${meta.needs.join('; ')}.` : '',
    '',
    '## How to build it (promptToDeterministicTool, from Kent Beck\'s ToolSeeds)',
    '',
    '- [ ] A **pure core**: a function from the collected data to the JSON model, with all I/O (git, files, the network) at the edge.',
    '- [ ] Network data (CI runs, the tracker) **fetched by a separate step into a cache** file the core reads; the core never calls the network.',
    '- [ ] The output is **JSON with sorted keys**, dates as **commit timestamps** (never the time of the run), so two runs on the same commit are identical.',
    '- [ ] A **golden test**: a small fixture repository (or cached data) and its expected JSON, compared byte for byte.',
    '- [ ] The seed\'s **VERIFY** steps written as tests (below).',
    '- [ ] One command that prints the JSON model on stdout (e.g. `node tools/<name>.js --json`); record it in the app (Projects › Architecture › Seeds) so the seed runs it instead of the Oracle.',
    '',
    '## The seed\'s VERIFY steps and report-back list',
    '',
    verifyOf(seed.body) || '(the seed has no VERIFY section)',
    '',
    `Filed by the orchestrator from the ${seed.id} seed's result for the project ${project.name || project.id} (#360).`,
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n');
  return { title, body };
}

/**
 * Files the tool issue → { preview, url, title, body }. `exec(cli, args)` → stdout; `preview`: file
 * nothing; `dir`: where the body file goes (GitHub's --body-file), a temporary folder when unset.
 */
async function fileToolIssue({ project, seed, platform, repo, exec, preview, dir = null }) {
  const { title, body } = toolIssue({ project, seed });
  if (preview) return { preview: true, url: null, title, body };
  const p = issues.adapterOf(platform);
  if (!p) throw new Error(`Unknown platform: ${platform}`);
  const target = issues.cliTargetOrName(platform, repo);
  let labels = [LABEL];
  if (p.readsLabels) {
    const l = p.labelListCommand(target);
    const names = await Promise.resolve(exec(l.cli, l.args)).then((out) => p.parseLabelNames(out), () => null);
    if (names && !names.includes(LABEL)) {
      const c = p.labelCreateCommand({ target, name: LABEL, color: LABEL_COLOR, description: LABEL_TEXT });
      // without the label, the issue is still filed
      if (c) labels = await Promise.resolve(exec(c.cli, c.args)).then(() => [LABEL], () => []);
    } else if (!names) labels = [];
  }
  const own = !dir;
  const folder = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'seed-tool-'));
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `${seed.id}-tool-issue.md`);
  fs.writeFileSync(file, body);
  try {
    const c = p.issueCreateCommand({ target, title, labels, file, text: body });
    const url = String(await exec(c.cli, c.args) || '').match(/https?:\/\/\S+/)?.[0] || null;
    return { preview: false, url, title, body };
  } finally {
    if (own) fs.rmSync(folder, { recursive: true, force: true });
  }
}

module.exports = {
  fileToolIssue,
  LABEL,
  toolIssue,
};
