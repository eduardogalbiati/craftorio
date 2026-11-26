// #40 (internals): refusedUntilAccepted narrows awaitsAcceptance to entries whose run is refused (an owner's
// workspace copy, runsCopy 'workspace', runs without the acceptance), and defaultAwaitingAcceptance resolves a
// project's default name to its repository entry by file (DefaultWorkflow.installedFile), not by metadata name.
const test = require('node:test');
const assert = require('node:assert');

globalThis.DefaultWorkflow = require('../../shared/default-workflow.js');
require('../workflows-acceptance.js');
const { refusedUntilAccepted, defaultAwaitingAcceptance, awaitsAcceptance } = globalThis;

const entry = (over) => ({ file: 'remote-hero.yaml', name: 'remote-hero', origin: 'repository', accepted: false, ...over });

test('#40 refusedUntilAccepted: an unaccepted repository entry is refused; its workspace copy runs', () => {
  assert.equal(refusedUntilAccepted(entry()), true);
  assert.equal(refusedUntilAccepted(entry({ runsCopy: 'workspace' })), false);
  assert.equal(awaitsAcceptance(entry({ runsCopy: 'workspace' })), true, 'Definitions still lists it');
  assert.equal(refusedUntilAccepted(entry({ accepted: true })), false);
  assert.equal(refusedUntilAccepted({ file: 'feature.yaml', origin: 'bundled' }), false);
});

test('#40 defaultAwaitingAcceptance: resolves the default by file, whatever the YAML name says', () => {
  const copy = entry({ file: 'team-feature.yaml', name: 'feature' });
  assert.equal(defaultAwaitingAcceptance('team-feature', [copy]), copy);
  assert.equal(defaultAwaitingAcceptance('team-feature.yaml', [copy]), copy);
  assert.equal(defaultAwaitingAcceptance('feature', [copy]), null, 'another workflow named feature is not this default');
});

test('#40 defaultAwaitingAcceptance: null for an accepted default, a workspace copy, a non-repository entry or no name', () => {
  assert.equal(defaultAwaitingAcceptance('remote-hero', [entry({ accepted: true })]), null);
  assert.equal(defaultAwaitingAcceptance('remote-hero', [entry({ runsCopy: 'workspace' })]), null);
  assert.equal(defaultAwaitingAcceptance('remote-hero', [entry({ origin: 'workspace' })]), null);
  assert.equal(defaultAwaitingAcceptance('', [entry()]), null);
  assert.equal(defaultAwaitingAcceptance('remote-hero', undefined), null);
});
