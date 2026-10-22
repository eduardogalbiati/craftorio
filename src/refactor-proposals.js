// The Refactor tab's proposals of a project (#356): refactors suggested from outside a run, for the
// Product Owner to prioritize. The Architecture tab's "Send to Refactor" adds one per Oracle
// finding ({ source: 'architecture', reportId, kind, title, files, evidence, severity, refactor });
// the same finding sent twice (from any analysis, #435: the key is its kind and files) stays one
// proposal, its evidence gathered. Saved in <workspace>/refactor/<project id>/proposals.json.
// #357: the owner writes one on the tab ({ source: 'owner', target, improvement, evidence }); Dismiss
// keeps it with its reason (status 'dismissed'); the Product Owner's ranking puts rank, rankReason
// and complexity on each and is kept with its date and cost in ranking.json; updateProposal records
// its issue and its Danger Zone before / outcome (src/refactor-outcome.js).

'use strict';

const fs = require('fs');
const path = require('path');

const dirOf = (root, projectId) => path.join(root, path.basename(String(projectId)));
const fileOf = (root, projectId) => path.join(dirOf(root, projectId), 'proposals.json');
const rankingFile = (root, projectId) => path.join(dirOf(root, projectId), 'ranking.json');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

const writeProposals = (root, projectId, list) => writeJson(fileOf(root, projectId), { proposals: list });

/** The proposals of a project, oldest first. */
function listProposals(root, projectId) {
  try {
    const data = JSON.parse(fs.readFileSync(fileOf(root, projectId), 'utf8'));
    return Array.isArray(data.proposals) ? data.proposals : [];
  } catch {
    return [];
  }
}

// the distinct texts of an evidence (a string, or a list of them)
const evidenceTexts = (e) => (Array.isArray(e) ? e : [e]).map((x) => (typeof x === 'string' ? x.trim() : x)).filter(Boolean);

/**
 * Adds `proposal` ({ source, key, ... }) unless one with the same source and key exists; the stored one.
 * #435: the known one (the same finding from another analysis) gets the new evidence, kept as a list.
 */
function addProposal(root, projectId, proposal, now = new Date()) {
  const list = listProposals(root, projectId);
  const known = list.find((p) => p.source === proposal.source && p.key === proposal.key);
  if (known) {
    const had = evidenceTexts(known.evidence);
    const added = evidenceTexts(proposal.evidence).filter((e) => !had.some((h) => JSON.stringify(h) === JSON.stringify(e)));
    return added.length ? updateProposal(root, projectId, known.id, { evidence: [...had, ...added] }) : known;
  }
  const stored = { ...proposal, id: `${proposal.source}-${now.getTime().toString(36)}-${list.length + 1}`, createdAt: now.toISOString(), status: 'proposed' };
  writeProposals(root, projectId, [...list, stored]);
  return stored;
}

/** Merges `patch` (an object, or a function of the stored proposal) into proposal `id`; the updated one. Throws on an unknown id. */
function updateProposal(root, projectId, id, patch) {
  const list = listProposals(root, projectId);
  const at = list.findIndex((p) => p.id === id);
  if (at < 0) throw new Error(`Unknown refactor proposal: ${id}`);
  list[at] = { ...list[at], ...(typeof patch === 'function' ? patch(list[at]) : patch) };
  writeProposals(root, projectId, list);
  return list[at];
}

/** Dismisses proposal `id` with a reason (required, trimmed); it stays listed. */
function dismissProposal(root, projectId, id, reason, now = new Date()) {
  const text = String(reason ?? '').trim();
  if (!text) throw new Error('Say why the proposal is dismissed: a reason is required.');
  return updateProposal(root, projectId, id, { status: 'dismissed', dismissReason: text, dismissedAt: now.toISOString() });
}

/** Puts the Product Owner's ranking ({ ranking: [{ id, rank, reason, complexity }] }) on the proposals and keeps it with `at` and `costUsd`. */
function saveRanking(root, projectId, answer, { at, costUsd = 0 } = {}) {
  const byId = new Map((answer?.ranking || []).map((r) => [r.id, r]));
  const list = listProposals(root, projectId).map((p) => {
    const r = byId.get(p.id);
    // a proposal the ranking leaves out (dismissed) keeps no stale rank
    const { rank: _r, rankReason: _w, complexity: _c, ...rest } = p;
    return r ? { ...rest, rank: r.rank, rankReason: r.reason, complexity: r.complexity } : rest;
  });
  writeProposals(root, projectId, list);
  const saved = { at, costUsd, ranking: answer?.ranking || [] };
  writeJson(rankingFile(root, projectId), saved);
  return saved;
}

/** The last ranking saved ({ at, costUsd, ranking }), or null. */
function readRanking(root, projectId) {
  try {
    return JSON.parse(fs.readFileSync(rankingFile(root, projectId), 'utf8'));
  } catch {
    return null;
  }
}

module.exports = {
  addProposal,
  dismissProposal,
  listProposals,
  readRanking,
  saveRanking,
  updateProposal,
};
