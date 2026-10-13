// src/renderer/views/backlog/backlog-po-proposals.js: the Product Owner's "Split what is too big"
// (#124). It runs only inside the Electron renderer, so it is loaded whole into a vm sandbox, the way
// test/renderer-backlog-roadmap.test.js checks backlog-roadmap.js. These tests cover only #195 (the
// workflow select next to Split + roadmap): the rest of the split/edit flow is unchanged by this branch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'backlog', 'backlog-po-proposals.js'), 'utf8');
const defaultWorkflowSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'default-workflow.js'), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function loadProposals({ confirmDialog, devMode, splitProductOwnerIssue, proposeRoadmap, workflows } = {}) {
  const proposeCalls = [];
  const sandbox = {
    esc,
    state: { workflows: workflows || [], simulationOnly: false, settings: { defaultWorkflow: null } },
    errMsg: (e) => String(e?.message || e),
    devMode: devMode || (() => true), // simulated by default: no confirmation dialog needed
    confirmDialog: confirmDialog || (async () => true),
    api: {
      splitProductOwnerIssue: splitProductOwnerIssue || (async () => ({ messages: [], children: [] })),
      // proposal.stages is built inside the vm realm: Array.from (the outer realm's) copies each level
      // so the pushed value is plain outer-realm data assert.deepEqual can compare.
      proposeRoadmap: async (projectId, proposal) => {
        const stages = Array.from(proposal.stages, (st) => ({ name: st.name, items: Array.from(st.items, (i) => ({ workflow: i.workflow, issues: Array.from(i.issues) })) }));
        proposeCalls.push({ projectId, stages });
        return (proposeRoadmap || (() => ({ roadmap: { stages: [] } })))(proposal);
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.window.BacklogActions = { data: () => ({ epics: [] }), showData: () => {}, showRoadmap: () => {} };
  vm.createContext(sandbox);
  vm.runInContext(defaultWorkflowSrc, sandbox); // the real DefaultWorkflow module (#195)
  vm.runInContext(src, sandbox);
  return { BacklogPoProposals: sandbox.window.BacklogPoProposals, sandbox, proposeCalls };
}

const WORKFLOWS = [
  { file: 'software-development.yaml', name: 'Software development', inputs: { task: { type: 'string' } } },
  { file: 'software-development-local-hero.yaml', name: 'Software development (local)', inputs: { task: { type: 'string' } } },
];

function split(issue, over = {}) {
  return { issue, title: `Issue ${issue}`, tasks: [{ n: 1, text: 't1' }, { n: 2, text: 't2' }], reasons: ['Too big.'], children: [
    { stage: 1, complexity: 2, title: 'Child A', tasks: [1], reason: '' },
    { stage: 2, complexity: 2, title: 'Child B', tasks: [2], reason: '' },
  ], ...over };
}
function makeCtx(messages) {
  return { messages, projectId: 'p1', busy: false, issueRef: (n) => `#${n}`, issueOf: () => null, render: () => {}, setMessages: () => {} };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test('splitsHtml: the workflow select next to Split + roadmap defaults to the default development workflow, marked "(default)"', () => {
  const { BacklogPoProposals } = loadProposals({ workflows: WORKFLOWS });
  const s = split(1);
  const msg = { ts: 't1', answer: { splits: [s] } };
  const html = BacklogPoProposals.splitsHtml(makeCtx([msg]), msg);
  assert.match(html, /<select class="po-wf" data-split-wf/);
  // unset: falls back to the local workflow (DefaultWorkflow.resolve with no setting)
  assert.match(html, /<option value="software-development-local-hero\.yaml" selected>Software development \(local\) \(default\)<\/option>/);
  assert.match(html, /<option value="software-development\.yaml">Software development<\/option>/);
  assert.match(html, /title="File the children, then plan them in the roadmap in this order \(software-development-local-hero\)"/);
});

test('onInput [data-split-wf]: picking another workflow is kept for that split, and the "Split + roadmap" tooltip follows it', () => {
  const { BacklogPoProposals } = loadProposals({ workflows: WORKFLOWS });
  const s = split(2);
  const msg = { ts: 't2', answer: { splits: [s] } };
  const ctx = makeCtx([msg]);

  const box = { dataset: { split: '2' } };
  const msgBox = { dataset: { msg: '0' } };
  const select = { value: 'software-development.yaml', dataset: { splitWf: '' } };
  select.closest = (sel) => (sel === '[data-split]' ? box : sel === '[data-msg]' ? msgBox : null);

  const handled = BacklogPoProposals.onInput({ target: select, type: 'change' }, ctx);
  assert.equal(handled, true);

  const html = BacklogPoProposals.splitsHtml(ctx, msg);
  // local-hero is still the setting's default: the now-picked workflow carries no "(default)" suffix
  assert.match(html, /<option value="software-development\.yaml" selected>Software development<\/option>/);
  assert.match(html, /title="File the children, then plan them in the roadmap in this order \(software-development\)"/);
});

test('fileSplit (Split + roadmap): the roadmap stages use the split\'s picked workflow, falling back to the default when none was picked', async () => {
  const { BacklogPoProposals, proposeCalls } = loadProposals({
    workflows: WORKFLOWS,
    splitProductOwnerIssue: async () => ({ messages: [], children: [{ number: 11, stage: 1 }, { number: 12, stage: 2 }] }),
  });
  const s = split(3);
  const msg = { ts: 't3', answer: { splits: [s] } };
  const ctx = makeCtx([msg]);
  const splitBox = { dataset: { split: '3' } };
  const msgBox = { dataset: { msg: '0' } };
  const btn = { dataset: { splitAct: 'split-roadmap' } };
  btn.closest = (sel) => (sel === '[data-split-act], [data-split-parent], [data-split-merge], [data-epic-act]' ? btn : sel === '[data-split]' ? splitBox : sel === '[data-msg]' ? msgBox : null);

  const handled = await BacklogPoProposals.onClick({ target: btn }, ctx);
  assert.equal(handled, true);
  await settle(); // onClick fires fileSplit without awaiting it
  await settle();
  assert.equal(proposeCalls.length, 1);
  assert.deepEqual(proposeCalls[0].stages.flatMap((st) => st.items.map((i) => i.workflow)), ['software-development-local-hero.yaml', 'software-development-local-hero.yaml']);
});
