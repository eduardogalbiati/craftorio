// Findings (#361, packages/engine/domains/evidence/findings.js): the Findings button's channels.
// findings:save { image, marked, marks, note, context } → { id, dir, status: 'saved' }: the renderer's
// context plus what the service knows (the last channel calls, the main log, the app's version and
// commit), saved to <workspace>/findings/<id>/.
// findings:list → [{ id, dir, at, note, status, issueUrl, error }], newest first; a finding waiting in
// the Product Owner's inbox ('sent') is looked up in its conversation, 'filed' once done.
// findings:file { id, projectId, mock } → the Product Owner's answer plus { status, issueUrl }: an
// issue.file request from 'findings' (no model, its reason the finding's note) whose body names the
// finding's folder; a real one first publishes the marked image on the project's pr-screenshots
// branch (skills/pr-screenshots/publish.js publishFiles) so the issue shows it.
const path = require('path');
const backlog = require('../../domains/backlog/backlog');
const findings = require('../../domains/evidence/findings');
const Language = require('@multiagent/shared/language');
const mainLog = require('../../domains/workspace/main-log');
const productOwner = require('../../domains/po/product-owner');
const projects = require('../../domains/project/projects');
const simulation = require('../../engine/simulation');
const workspace = require('../../domains/workspace/workspace');
const { DEFAULT_PLATFORM, findPlatform } = require('@multiagent/shared/platforms');
const { BUNDLED_SKILLS_DIR, clientError, requireObject } = require('../common');
const {
  args,
  described,
  FLAG,
  listOf,
  nullable,
  OBJECT,
  PROJECT_ID,
  REQUEST_ANSWER,
  shape,
  STRING,
} = require('../schemas');

// the finding's PNGs, marks and context are checked by the channel itself, with its own messages
const FINDING = described(OBJECT, 'A finding: { image, marked, marks, note, context } (PNG data URLs, the marks, the note, the renderer\'s context).');
const SAVED = shape({ id: STRING, dir: STRING, status: STRING }, ['id']);
const FILED = shape({ ...REQUEST_ANSWER.properties, status: STRING, issueUrl: nullable(STRING) });

const ISSUE_URL = /https?:\/\/\S+\/issues\/\d+/;

module.exports = (ctx) => {
  // the marked image's URL on the project's repository, or null (no backlog, no remote, a push refused)
  function publishImage(projectId, found) {
    try {
      const id = path.basename(String(projectId));
      const data = backlog.readBacklog(ctx.ws.backlog, id);
      const p = projects.readProject(ctx.ws.projects, id);
      // publish.js takes the short id (gh | gl)
      const platform = findPlatform(data?.platform || DEFAULT_PLATFORM)?.short;
      if (!data?.repo || !p?.folder || !platform) return null;
      const { publishFiles } = require(path.join(BUNDLED_SKILLS_DIR, 'pr-screenshots', 'publish.js'));
      const file = path.join(found.dir, 'marked.png');
      return publishFiles({ platform, repoUrl: data.repo, folder: `findings/${found.id}`, files: [file], cwd: p.folder }).urls[file] || null;
    } catch (e) {
      console.error(`findings: the marked image of ${found.id} was not published: ${e.message}`);
      return null;
    }
  }

  // a 'sent' finding: its request's result in the Product Owner's conversation, once there is one
  function follow(f) {
    if (f.status !== 'sent' || !f.ref || !f.projectId) return f;
    let result = null;
    try {
      result = productOwner.readConversation(ctx.ws.backlog, path.basename(String(f.projectId)))
        .find((m) => m.role !== 'request' && m.request?.ref === f.ref);
    } catch {
      return f;
    }
    if (!result) return f;
    const text = String(result.text || '');
    const done = /^Done:/.test(text) && !result.error;
    const filing = done
      ? { status: 'filed', projectId: f.projectId, ref: f.ref, issueUrl: ISSUE_URL.exec(text)?.[0] || null }
      : { status: 'saved', projectId: f.projectId, ref: f.ref, error: result.error || text || 'The Product Owner did not file it.' };
    return findings.markFiling(ctx.ws, f.id, filing) || f;
  }

  return [
    {
      channel: 'findings:save',
      method: 'saveFinding',
      params: 'finding',
      schema: { params: FINDING, result: SAVED },
      fn: (arg) => {
        const { image, marked, marks, note, context } = requireObject(arg, 'finding');
        if (typeof image !== 'string' || !image.startsWith('data:image/png;base64,')) throw clientError('Invalid finding: image is not a PNG data URL.');
        if (marked != null && (typeof marked !== 'string' || !marked.startsWith('data:image/png;base64,'))) throw clientError('Invalid finding: marked is not a PNG data URL.');
        const given = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
        return findings.saveFinding(ctx.ws, {
          image,
          marked,
          marks: Array.isArray(marks) ? marks : [],
          note: typeof note === 'string' ? note : '',
          context: { ...given, app: ctx.appBuild(), calls: ctx.recentCalls(), log: mainLog.recent() },
        });
      },
    },
    { channel: 'findings:list', method: 'listFindings', schema: { result: listOf(OBJECT) }, fn: () => findings.listFindings(ctx.ws).map(follow) },
    {
      channel: 'findings:file',
      method: 'fileFinding',
      params: ['id', 'projectId', 'mock'],
      schema: { params: args({ id: nullable(STRING), projectId: PROJECT_ID, mock: FLAG }, ['projectId']), result: FILED },
      fn: async ({ id, projectId, mock }) => {
        const found = findings.getFinding(ctx.ws, id);
        if (!found) {
          const error = `Unknown finding: ${id || '(none)'}`;
          return { ok: false, text: error, costUsd: 0, error };
        }
        const simulated = !!mock || simulation.simulationOnly();
        const imageUrl = simulated ? null : publishImage(projectId, found);
        const issuesLanguage = Language.issuesLanguage(workspace.readSettings(ctx.ws)); // #328
        const { title, body } = findings.issueOf(found, { imageUrl, issuesLanguage });
        const ref = `findings-${found.id}-${Math.random().toString(36).slice(2, 6)}`;
        const out = await ctx.productOwnerRequest({
          projectId, kind: 'issue.file', params: { title, body }, reason: found.note || `Finding ${found.id}`, from: 'findings', ref, mock: simulated,
        });
        const issueUrl = ISSUE_URL.exec(String(out.text || ''))?.[0] || null;
        const status = !out.ok ? 'saved' : out.pending ? 'sent' : 'filed';
        if (out.ok) findings.markFiling(ctx.ws, found.id, { status, projectId, ref, issueUrl });
        return { ...out, status, issueUrl };
      },
    },
  ];
};
