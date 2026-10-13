// The Refactor tab's proposals of a project (#356): refactors suggested from outside a run, for the
// Product Owner to prioritize. The Architecture tab's "Send to Refactor" adds one per Oracle
// finding ({ source: 'architecture', reportId, kind, title, files, evidence, severity, refactor });
// the same finding sent twice stays one proposal. Saved in <workspace>/refactor/<project id>/proposals.json.

'use strict';

const fs = require('fs');
const path = require('path');

const fileOf = (root, projectId) => path.join(root, path.basename(String(projectId)), 'proposals.json');

/** The proposals of a project, oldest first. */
function listProposals(root, projectId) {
  try {
    const data = JSON.parse(fs.readFileSync(fileOf(root, projectId), 'utf8'));
    return Array.isArray(data.proposals) ? data.proposals : [];
  } catch {
    return [];
  }
}

/** Adds `proposal` ({ source, key, ... }) unless one with the same source and key exists; the stored one. */
function addProposal(root, projectId, proposal, now = new Date()) {
  const list = listProposals(root, projectId);
  const known = list.find((p) => p.source === proposal.source && p.key === proposal.key);
  if (known) return known;
  const stored = { ...proposal, id: `${proposal.source}-${now.getTime().toString(36)}-${list.length + 1}`, createdAt: now.toISOString(), status: 'proposed' };
  const file = fileOf(root, projectId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ proposals: [...list, stored] }, null, 2)}\n`);
  return stored;
}

module.exports = {
  addProposal,
  listProposals,
};
