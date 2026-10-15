// Settings › Phone gates (#226, src/service/areas/phone-gates.js): the gates-only page for the owner's
// paired phones. None of these answers a gate: only the phone page does, with a paired device, the
// gate's signed link and the owner's confirmation (src/mobile-gates.js).

const {
  args,
  BOOL,
  INT,
  listOf,
  nullable,
  OBJECT,
  shape,
  STRING,
} = require('../schemas');

const STATE = shape({ enabled: BOOL, running: BOOL, port: nullable(INT), url: nullable(STRING), publicUrl: nullable(STRING), devices: listOf(OBJECT) }, ['enabled', 'devices']);

module.exports = (ctx) => [
  // { enabled, running, port, url, publicUrl, devices: [{ id, name, pairedAt, lastSeen }] }
  { channel: 'phonegates:state', method: 'phoneGatesState', schema: { result: STATE }, fn: () => ctx.phoneGatesState() },
  // a one-time pairing code (10 min) and its QR code; turns the page on → { code, expiresAt, link, qr, state }
  { channel: 'phonegates:pair', method: 'pairPhone', schema: { result: shape({ code: STRING, link: STRING, qr: STRING, state: STATE }, ['code', 'state']) }, fn: () => ctx.pairPhone() },
  // unpairs a phone: its token stops working at once → state
  { channel: 'phonegates:revoke', method: 'revokePhone', params: ['deviceId'], schema: { params: args({ deviceId: STRING }, ['deviceId']), result: STATE }, fn: ({ deviceId }) => ctx.revokePhone(deviceId) },
  // { enabled?, port?, publicUrl? } → state (the page restarts)
  {
    channel: 'phonegates:configure',
    method: 'configurePhoneGates',
    params: 'patch',
    schema: { params: { type: ['object', 'null'], properties: { enabled: BOOL, port: nullable(INT), publicUrl: nullable(STRING) } }, result: STATE },
    fn: (patch) => ctx.configurePhoneGates(patch || {}),
  },
  // whether the page answers: { local: { ok, status|error } | null, public: … | null }
  { channel: 'phonegates:check', method: 'checkPhoneGates', schema: { result: shape({ local: nullable(OBJECT), public: nullable(OBJECT) }) }, fn: () => ctx.checkPhoneGates() },
];
