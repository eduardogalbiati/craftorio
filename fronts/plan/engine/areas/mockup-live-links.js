// #837 Mockup live links (Plan & Design › Mockups, phase 4, docs/agents/storage/mockups.md): a read-only
// share link to one screen, served by the engine server's GET /mockups/live/<token>
// (packages/engine/server/index.js), which stays blocked until the security review #466–#470 is done.
// - createMockupLiveLink({ projectId, slug, ttlMs }) → { token (48 hex), path, expiresAt } (default 24 h),
//   called by the mockups:live-link channel (fronts/plan/engine/channels/mockups.js);
// - mockupLiveLinkPage(token) → the screen's self-contained html (domains/mockups.js liveLinkPage), or null
//   for an unknown or expired token (an expired one is forgotten).
// The links live in this process's memory only: an engine restart forgets them (nothing on disk to leak).

const crypto = require('crypto');
const mockups = require('../domains/mockups');

const TTL_MS = 24 * 60 * 60 * 1000;
const LIVE_PREFIX = '/mockups/live/';

module.exports = (ctx) => {
  const links = new Map();

  function createMockupLiveLink({ projectId, slug, ttlMs = TTL_MS } = {}) {
    const token = crypto.randomBytes(24).toString('hex');
    const life = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : TTL_MS;
    const expiresAt = Date.now() + life;
    links.set(token, { projectId, slug, expiresAt });
    return { token, path: `${LIVE_PREFIX}${token}`, expiresAt: new Date(expiresAt).toISOString() };
  }

  function mockupLiveLinkPage(token) {
    const link = links.get(String(token ?? ''));
    if (!link) return null;
    if (Date.now() > link.expiresAt) {
      links.delete(String(token));
      return null;
    }
    try {
      return mockups.liveLinkPage(ctx.ws.root, link.projectId, link.slug);
    } catch {
      return null; // the screen or the workspace is gone
    }
  }

  return {
    createMockupLiveLink,
    mockupLiveLinkPage,
  };
};
