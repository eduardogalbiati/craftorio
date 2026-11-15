// #835 the thumbnail a Discovery card shows for a mockup attachment is the one frozen in it, and the
// attachment name follows the shared SLUG and COMMIT rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../mockup-model');

test('#835 frozenThumbnail reads the SVG stored in a .mockup.json attachment', () => {
  const thumb = M.attachmentThumbnail({ title: 'Sign in', commit: 'abcdef1234' });
  assert.equal(M.frozenThumbnail('cards/x/attachments/sign-in@abcdef1.mockup.json', JSON.stringify({ thumbnail: thumb })), thumb);
});

test('#835 frozenThumbnail ignores other files, broken JSON and non-SVG values', () => {
  assert.equal(M.frozenThumbnail('notes.json', JSON.stringify({ thumbnail: 'data:image/svg+xml,x' })), null);
  assert.equal(M.frozenThumbnail('a@abcdef1.mockup.json', '{'), null);
  assert.equal(M.frozenThumbnail('a@abcdef1.mockup.json', JSON.stringify({ thumbnail: 'javascript:alert(1)' })), null);
});

test('#835 attachment names use the shared SLUG and COMMIT rules', () => {
  assert.deepEqual(M.parseAttachmentName('sign-in@abcdef1.mockup.json'), { slug: 'sign-in', commit: 'abcdef1' });
  assert.equal(M.parseAttachmentName('../x@abcdef1.mockup.json'), null);
  assert.ok(M.SLUG.test('checkout-2') && !M.SLUG.test('a/b'));
  assert.ok(M.COMMIT.test('ABCDEF1') && !M.COMMIT.test('xyz'));
});
