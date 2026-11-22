// T4: packages/contract/contract.json is the engine's current contract: a channel added, removed or
// changed without `npm run contract` fails here, so the contract package (and its version) moves with
// every change of what the app and the engine speak.
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkContract, currentContract } = require('../../../scripts/contract');
const contract = require('..');

test('T4 contract.json is the engine\'s current contract (else: npm run contract, and a changeset)', () => {
  assert.equal(checkContract(), null);
});

test('T4 the package answers the hash the engine computes, and its entries carry no code', () => {
  const now = currentContract();
  assert.equal(contract.hash, now.hash);
  assert.equal(contract.speaks(now.hash), true);
  assert.equal(contract.speaks('000000000000'), false);
  assert.ok(contract.entries.length > 100, 'the full composition');
  assert.ok(contract.entries.every((e) => !('fn' in e) && (e.channel || e.send || e.event)));
});
