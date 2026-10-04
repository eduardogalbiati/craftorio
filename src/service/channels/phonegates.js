// Settings › Phone gates (#226, src/service/areas/phone-gates.js): the gates-only page for the owner's
// paired phones. None of these answers a gate: only the phone page does, with a paired device, the
// gate's signed link and the owner's confirmation (src/mobile-gates.js).

module.exports = (ctx) => [
  // { enabled, running, port, url, publicUrl, devices: [{ id, name, pairedAt, lastSeen }] }
  { channel: 'phonegates:state', method: 'phoneGatesState', fn: () => ctx.phoneGatesState() },
  // a one-time pairing code (10 min) and its QR code; turns the page on → { code, expiresAt, link, qr, state }
  { channel: 'phonegates:pair', method: 'pairPhone', fn: () => ctx.pairPhone() },
  // unpairs a phone: its token stops working at once → state
  { channel: 'phonegates:revoke', method: 'revokePhone', params: ['deviceId'], fn: ({ deviceId }) => ctx.revokePhone(deviceId) },
  // { enabled?, port?, publicUrl? } → state (the page restarts)
  { channel: 'phonegates:configure', method: 'configurePhoneGates', params: 'patch', fn: (patch) => ctx.configurePhoneGates(patch || {}) },
  // whether the page answers: { local: { ok, status|error } | null, public: … | null }
  { channel: 'phonegates:check', method: 'checkPhoneGates', fn: () => ctx.checkPhoneGates() },
];
