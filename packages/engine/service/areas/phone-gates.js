// Phone gates (#226): the gates-only page the running app serves to the owner's paired phones
// (packages/engine/domains/workspace/mobile-gates.js). Off until the owner pairs a phone or turns it on in Settings › Phone gates
// (settings.phoneGates); then it listens on 127.0.0.1:<port> (the next free port when taken) and is
// started again with the workspace. Reaching it from outside is the owner's private tunnel
// (Tailscale serve, Cloudflare Tunnel with access rules) to that port; its address (publicUrl) is
// what the gate links in the notifications use. The answer is recorded as the owner's, from the
// phone: { answered_by: 'owner', via: 'mobile', device } on the gate's approval.resolved event.

const qrcode = require('qrcode-generator');
const I18n = require('@craftorio/shared/i18n');
const workspace = require('../../domains/workspace/workspace');
const {
  createMobileGatesServer,
  linkSecret,
  listDevices,
  revokeDevice,
} = require('../../domains/workspace/mobile-gates');

module.exports = (ctx) => {
  let gates = null; // the server while it runs
  let address = null; // { port, url }

  const config = () => ({ ...workspace.DEFAULT_SETTINGS.phoneGates, ...(workspace.readSettings(ctx.ws).phoneGates || {}) });
  const publicUrl = () => String(config().publicUrl || '').trim().replace(/\/+$/, '');

  // the engine's answer, only from the phone page (a paired device and a confirmed choice)
  function answerPhoneGate(runId, approvalId, answer, feedback, deviceId) {
    const run = ctx.active.get(String(runId));
    return run?.resolveApproval(approvalId, answer, 'user', feedback || '', null, [], { answered_by: 'owner', via: 'mobile', device: deviceId }) ?? false;
  }

  async function startPhoneGates() {
    if (gates) return address;
    const server = createMobileGatesServer({
      service: { api: { 'runs:active': () => ctx.activeRuns() }, workspace: () => ctx.ws, answerPhoneGate },
      secret: linkSecret(ctx.ws),
      publicUrl,
      language: () => I18n.resolveLanguage(workspace.readSettings(ctx.ws).language?.interface, ctx.host?.locale),
    });
    const port = Number(config().port) || 0;
    try {
      address = await server.listen(port, '127.0.0.1');
    } catch (e) {
      if (e.code !== 'EADDRINUSE' || !port) throw e;
      address = await server.listen(0, '127.0.0.1');
    }
    gates = server;
    return address;
  }

  function stopPhoneGates() {
    const s = gates;
    gates = null;
    address = null;
    return s ? s.close() : Promise.resolve();
  }

  // the gate link for runNotice while the page is served, else null
  const phoneGateLink = () => (gates ? gates.gateLink : null);

  function phoneGatesState() {
    const c = config();
    const url = address?.url || null;
    return {
      enabled: !!c.enabled,
      running: !!gates,
      port: Number(c.port) || null,
      url,
      publicUrl: publicUrl() || null,
      devices: listDevices(ctx.ws),
    };
  }

  // a one-time pairing code and its QR code (the page's address with ?pair=<code>); starts the page
  async function pairPhone() {
    if (!config().enabled) workspace.writeSettings(ctx.ws, { phoneGates: { ...config(), enabled: true } });
    await startPhoneGates();
    const p = gates.pair();
    const target = `${publicUrl() || address.url}/?pair=${p.code}`;
    const qr = qrcode(0, 'M');
    qr.addData(target);
    qr.make();
    const svg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    return { code: p.code, expiresAt: p.expiresAt, link: target, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, state: phoneGatesState() };
  }

  function revokePhone(deviceId) {
    if (!revokeDevice(ctx.ws, String(deviceId || ''))) throw new Error('This phone is not paired.');
    return phoneGatesState();
  }

  // { enabled, port, publicUrl } → state; the page restarts with the new settings
  async function configurePhoneGates(patch = {}) {
    const next = { ...config() };
    if ('enabled' in patch) next.enabled = !!patch.enabled;
    if ('port' in patch) {
      const port = Number(patch.port);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('The port must be a number from 1024 to 65535.');
      next.port = port;
    }
    if ('publicUrl' in patch) {
      const u = String(patch.publicUrl || '').trim();
      if (u && !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(u)) throw new Error('The address from outside must be an https:// address (your Tailscale or Cloudflare Tunnel address).');
      next.publicUrl = u;
    }
    workspace.writeSettings(ctx.ws, { phoneGates: next });
    await stopPhoneGates();
    if (next.enabled) await startPhoneGates();
    return phoneGatesState();
  }

  // whether the page answers: on localhost and, when set, at the address from outside
  async function checkPhoneGates() {
    const probe = async (base) => {
      if (!base) return null;
      try {
        const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(5000), redirect: 'manual' });
        return { ok: res.status === 200, status: res.status };
      } catch (e) { return { ok: false, error: e.cause?.code || e.message }; }
    };
    return { local: await probe(address?.url), public: await probe(publicUrl()) };
  }

  // started with the workspace when the owner turned it on
  function resumePhoneGates() {
    stopPhoneGates().then(() => (config().enabled ? startPhoneGates() : null)).catch((e) => console.error('phone gates:', e.message));
  }

  return {
    answerPhoneGate,
    checkPhoneGates,
    configurePhoneGates,
    pairPhone,
    phoneGateLink,
    phoneGatesState,
    resumePhoneGates,
    revokePhone,
    stopPhoneGates,
  };
};
