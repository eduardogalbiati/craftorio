// src/renderer/views/oracle/oracle-chat-model.js (#171): the Oracle drawer/dock's state as a pure
// function of the history, the service state and the drafts, no DOM — the way
// image-viewer-model.test.js checks image-viewer-model.js. oracle.js (the renderer) and its DOM
// wiring (follow(), the drawer open/close, the screenshot states) are exercised through
// npm run screenshot -- --view oracle (scripts/screenshot.js's demoOracle) and the generic
// "opens every view" test in screenshot.test.js, gated behind MULTIAGENT_UI_TESTS=1.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/renderer/views/oracle/oracle-chat-model');

// ---- chatView: the states ----------------------------------------------------------------------

test('chatView: no messages is "empty", chips enabled, Send disabled until something is drafted', () => {
  const v = M.chatView({});
  assert.equal(v.state, 'empty');
  assert.equal(v.canSend, false);
  assert.equal(v.chipsEnabled, true);
  assert.equal(v.inputEnabled, true);
});

test('chatView: messages with nothing wrong is "conversation"; Send enables once text is drafted', () => {
  const messages = [{ role: 'user', text: 'Hi' }, { role: 'oracle', text: 'Hello' }];
  assert.equal(M.chatView({ messages }).state, 'conversation');
  const v = M.chatView({ messages, drafts: { text: 'more' } });
  assert.equal(v.state, 'conversation');
  assert.equal(v.canSend, true);
});

test('chatView: a pending question or service.busy is "answering": chips disabled, the input stays enabled', () => {
  const byPending = M.chatView({ pending: 'What changed?' });
  assert.equal(byPending.state, 'answering');
  assert.equal(byPending.chipsEnabled, false);
  assert.equal(byPending.inputEnabled, true);
  assert.equal(byPending.canSend, false);

  const byBusy = M.chatView({ messages: [{ role: 'oracle', text: 'hi' }], service: { busy: true } });
  assert.equal(byBusy.state, 'answering');
});

test('chatView: a thrown error offers the drafted question to resend; a logged system error offers the last one asked', () => {
  const thrown = M.chatView({ messages: [{ role: 'user', text: 'Why?' }], error: 'boom', drafts: { text: 'Why?' } });
  assert.equal(thrown.state, 'error');
  assert.equal(thrown.errorText, 'boom');
  assert.equal(thrown.resendText, 'Why?');

  const logged = M.chatView({ messages: [{ role: 'user', text: 'Why?' }, { role: 'system', error: true, text: 'The Oracle could not answer: x' }] });
  assert.equal(logged.state, 'error');
  assert.equal(logged.errorText, 'The Oracle could not answer: x');
  assert.equal(logged.resendText, 'Why?'); // not thrown now: the last user question is offered instead
});

test('chatView: service.paused ("paused by budget") disables the input and Send, and carries today\'s spend', () => {
  const v = M.chatView({ messages: [{ role: 'oracle', text: 'hi' }], service: { paused: true, today: { spentUsd: 2, limitUsd: 2 } } });
  assert.equal(v.state, 'paused');
  assert.equal(v.inputEnabled, false);
  assert.equal(v.canSend, false);
  assert.deepEqual(v.today, { spentUsd: 2, limitUsd: 2 });
});

test('chatView: an owner that is not this process is "unavailable": nothing can be sent, the owner is carried', () => {
  const owner = { pid: 42, host: 'studio', self: false };
  const v = M.chatView({ messages: [{ role: 'oracle', text: 'hi' }], service: { owner } });
  assert.equal(v.state, 'unavailable');
  assert.equal(v.inputEnabled, false);
  assert.equal(v.canSend, false);
  assert.deepEqual(v.owner, owner);
});

test('chatView: "unavailable" takes priority over a pending question, a paused budget or a trailing error', () => {
  const owner = { pid: 1, host: 'h', self: false };
  assert.equal(M.chatView({ pending: 'q', service: { owner } }).state, 'unavailable');
  assert.equal(M.chatView({ service: { owner, paused: true } }).state, 'unavailable');
  assert.equal(M.chatView({ messages: [{ role: 'system', error: true, text: 'x' }], service: { owner } }).state, 'unavailable');
});

test('chatView: drafted images count toward whether Send is enabled, and are returned as attachments', () => {
  const v = M.chatView({ drafts: { images: [{ id: '1' }] } });
  assert.equal(v.canSend, true);
  assert.deepEqual(v.attachments, [{ id: '1' }]);
});

// ---- unread count -------------------------------------------------------------------------------

test('unreadCount: only Oracle messages after readAt; a null readAt counts every one of them', () => {
  const messages = [
    { role: 'user', text: 'hi', ts: '2026-10-01T00:00:00Z' },
    { role: 'oracle', text: 'a', ts: '2026-10-01T00:01:00Z' },
    { role: 'oracle', text: 'b', ts: '2026-10-01T00:02:00Z' },
  ];
  assert.equal(M.unreadCount(messages, null), 2);
  assert.equal(M.unreadCount(messages, '2026-10-01T00:01:00Z'), 1);
  assert.equal(M.unreadCount(messages, '2026-10-01T00:05:00Z'), 0);
  assert.equal(M.unreadCount([], null), 0);
});

test('chatView: unread is always 0 while open; closed, it is the unread count (survives whatever readAt the service reports)', () => {
  const messages = [{ role: 'oracle', text: 'a', ts: '2026-10-01T00:01:00Z' }];
  assert.equal(M.chatView({ messages, service: { readAt: null }, open: true }).unread, 0);
  assert.equal(M.chatView({ messages, service: { readAt: null }, open: false }).unread, 1);
  assert.equal(M.chatView({ messages, service: { readAt: '2026-10-01T00:01:00Z' }, open: false }).unread, 0);
});

// ---- pasted images (drafts) ---------------------------------------------------------------------

test('addImages: valid images are appended, with an id from the given generator', () => {
  const file = { type: 'image/png', size: 100, dataUrl: 'data:image/png;base64,Zg==', name: 'a.png' };
  const out = M.addImages([], [file], () => 'img-1');
  assert.equal(out.error, null);
  assert.deepEqual(out.images, [{ id: 'img-1', type: 'image/png', size: 100, dataUrl: file.dataUrl, name: 'a.png' }]);
});

test('addImages: a non-image file is skipped silently, not an error', () => {
  assert.deepEqual(M.addImages([], [{ type: 'text/plain', size: 10 }]), { images: [], error: null });
});

test('addImages: one image over the size cap adds nothing and names the cap', () => {
  const out = M.addImages([], [{ type: 'image/png', size: M.LIMITS.maxBytes + 1 }]);
  assert.deepEqual(out.images, []);
  assert.match(out.error, /over 5 MB/);
});

test('addImages: more images than the per-message cap adds nothing, counting what is already drafted', () => {
  const existing = [0, 1, 2, 3].map((i) => ({ id: String(i), type: 'image/png', size: 1 }));
  const out = M.addImages(existing, [{ type: 'image/png', size: 1 }]);
  assert.deepEqual(out.images, existing); // unchanged
  assert.match(out.error, /At most 4 images/);
});

test('removeImage: drops only the matching id', () => {
  assert.deepEqual(M.removeImage([{ id: 'a' }, { id: 'b' }], 'a'), [{ id: 'b' }]);
});

// ---- the memory form -----------------------------------------------------------------------------

test('memoryForm/editMemory/cancelMemory: editing drafts a copy of the saved text; cancel discards the edits', () => {
  const f = M.memoryForm('Reply in Portuguese.');
  const editing = M.editMemory(f);
  assert.equal(editing.editing, true);
  assert.equal(editing.draft, 'Reply in Portuguese.');

  const edited = { ...editing, draft: 'Something else' };
  const cancelled = M.cancelMemory(edited);
  assert.equal(cancelled.editing, false);
  assert.equal(cancelled.draft, 'Reply in Portuguese.'); // discarded, not "Something else"
  assert.equal(cancelled.text, 'Reply in Portuguese.');
});

test('saveMemory: on success, saves the draft and stops editing', async () => {
  const f = { ...M.editMemory(M.memoryForm('old')), draft: 'new text' };
  const saved = await M.saveMemory(f, async (text) => ({ text }));
  assert.deepEqual(saved, { text: 'new text', draft: 'new text', editing: false, saving: false, error: null });
});

test('saveMemory: on failure, keeps editing and the draft, and carries the error', async () => {
  const f = { ...M.editMemory(M.memoryForm('old')), draft: 'new text' };
  const failed = await M.saveMemory(f, async () => { throw new Error('too long'); });
  assert.equal(failed.editing, true);
  assert.equal(failed.draft, 'new text');
  assert.equal(failed.text, 'old');
  assert.equal(failed.error, 'too long');
});

// ---- the meta line (time · model or "simulated" · cost · tokens) ---------------------------------

test('tokenTotal: sums every numeric field of the usage, ignoring non-numbers', () => {
  assert.equal(M.tokenTotal({ input: 10, output: 5, cache_read: 'x' }), 15);
  assert.equal(M.tokenTotal(), 0);
});

test('metaParts: time, model, cost and the token total, in order', () => {
  const m = { ts: 't', model: 'claude-opus-5-5', costUsd: 0.4213, tokens: { input: 1200, output: 860, cache_read: 48000 } };
  const parts = M.metaParts(m, { fmtTime: () => 'TIME', fmtCost: (n) => `$${n}` });
  assert.deepEqual(parts, ['TIME', 'claude-opus-5-5', '$0.4213', '50,060 tokens']);
});

test('metaParts: a simulated message says "simulated" instead of naming a model', () => {
  const parts = M.metaParts({ model: 'claude-opus-5-5', simulated: true, tokens: {} }, { fmtCost: () => '$0' });
  assert.ok(parts.includes('simulated'));
  assert.ok(!parts.includes('claude-opus-5-5'));
});

test('metaParts: a missing time is dropped, not shown as an empty piece', () => {
  const parts = M.metaParts({ tokens: {} }, { fmtCost: () => '$0' });
  assert.deepEqual(parts, ['$0', '0 tokens']);
});

// ---- links in an answer (run ids, #issues, run files, other paths) -------------------------------

test('linkTarget: a bare #<number> is an issue with no repository', () => {
  assert.deepEqual(M.linkTarget('#171'), { kind: 'issue', number: 171 });
});

test('linkTarget: a GitHub issue URL carries its repository, lower-cased', () => {
  assert.deepEqual(M.linkTarget('https://github.com/O/N/issues/171'), { kind: 'issue', number: 171, repo: 'o/n' });
});

test('linkTarget: a GitLab merge request URL (its /-/ segment) carries its number and repository', () => {
  assert.deepEqual(M.linkTarget('https://gitlab.com/g/n/-/merge_requests/4'), { kind: 'issue', number: 4, repo: 'g/n' });
});

test('linkTarget: a plain "<project>/issues/<n>" path with no host still gives an issue, with no repository', () => {
  assert.deepEqual(M.linkTarget('foo/issues/3'), { kind: 'issue', number: 3 });
});

test('linkTarget: a run id is a run link; a file under a run folder is a run file; other http(s) links are external', () => {
  assert.deepEqual(M.linkTarget('20261002-003425-77147dbf'), { kind: 'run', runId: '20261002-003425-77147dbf' });
  const file = 'C:\\work\\runs\\20261002-003425-77147dbf\\summary.json';
  assert.deepEqual(M.linkTarget(file), { kind: 'file', path: file, runId: '20261002-003425-77147dbf' });
  assert.deepEqual(M.linkTarget('https://example.com/x'), { kind: 'external', url: 'https://example.com/x' });
});

test('linkTarget: an absolute path outside a run is copyable text; anything else is none', () => {
  assert.deepEqual(M.linkTarget('C:\\work\\notes.md'), { kind: 'path', path: 'C:\\work\\notes.md' });
  assert.deepEqual(M.linkTarget(''), { kind: 'none' });
  assert.deepEqual(M.linkTarget('just text'), { kind: 'none' });
});

test('linkPieces: splits text into plain runs and linked runs (a run id, an #issue), keeping the rest intact', () => {
  const pieces = M.linkPieces('See run 20261002-003425-77147dbf and issue #171 for details.');
  assert.deepEqual(pieces, [
    { text: 'See run ' },
    { text: '20261002-003425-77147dbf', href: '20261002-003425-77147dbf' },
    { text: ' and issue ' },
    { text: '#171', href: '#171' },
    { text: ' for details.' },
  ]);
});

test('linkPieces: an "&#171;" HTML entity is not mistaken for an #issue link', () => {
  assert.deepEqual(M.linkPieces('a &#171; b'), [{ text: 'a &#171; b' }]);
});

test('linkPieces: plain text with neither a run id nor an #issue keeps a single piece', () => {
  assert.deepEqual(M.linkPieces('nothing here'), [{ text: 'nothing here' }]);
});

// ---- repoSlug: owner/name of a repository, from any of the shapes git prints --------------------

test('repoSlug: strips a trailing .git, an SSH prefix or a trailing slash, always lower case', () => {
  assert.equal(M.repoSlug('https://github.com/Owner/Name.git'), 'owner/name');
  assert.equal(M.repoSlug('git@github.com:Owner/Name'), 'owner/name');
  assert.equal(M.repoSlug('Owner/Name'), 'owner/name');
  assert.equal(M.repoSlug('https://github.com/Owner/Name/'), 'owner/name');
});

test('repoSlug: empty or unparsable input gives an empty string', () => {
  assert.equal(M.repoSlug(''), '');
  assert.equal(M.repoSlug('not-a-repo'), '');
});

// ---- issueProject: which project's Backlog a #<number> link opens --------------------------------

test('issueProject: the link\'s own repository picks its project, even when another one is current', () => {
  const projects = [{ id: 'a', repo: 'https://github.com/o/a' }, { id: 'b', repo: 'https://github.com/o/b' }];
  assert.equal(M.issueProject({ repo: 'o/b' }, { projects, currentId: 'a' }), 'b');
});

test('issueProject: no repository on the link falls back to the run named in the same answer (by id or by name)', () => {
  const projects = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];
  assert.equal(M.issueProject({}, { projects, runProject: 'b', currentId: 'a' }), 'b');
  assert.equal(M.issueProject({}, { projects, runProject: 'Beta', currentId: 'a' }), 'b');
});

test('issueProject: with neither a repository nor a named run, the only project with a repository wins', () => {
  const projects = [{ id: 'a' }, { id: 'b', repo: 'https://github.com/o/b' }];
  assert.equal(M.issueProject({}, { projects, currentId: 'a' }), 'b');
});

test('issueProject: several projects with a repository, and nothing else to go on, keeps the current one', () => {
  const projects = [{ id: 'a', repo: 'https://github.com/o/a' }, { id: 'b', repo: 'https://github.com/o/b' }];
  assert.equal(M.issueProject({}, { projects, currentId: 'a' }), 'a');
});

test('issueProject: nothing at all (no repo, no run, no project with a repository, no current) gives null', () => {
  assert.equal(M.issueProject({}, { projects: [{ id: 'a' }] }), null);
});

test('issueProject: a link repository that matches no project falls through to the run, not straight to the current project', () => {
  const projects = [{ id: 'a', name: 'Alpha' }, { id: 'b', repo: 'https://github.com/o/b' }];
  assert.equal(M.issueProject({ repo: 'o/other' }, { projects, runProject: 'Alpha', currentId: 'b' }), 'a');
});
