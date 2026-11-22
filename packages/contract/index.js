// @craftorio/contract (T4 of the Craftorio migration): the channels the app and the engine speak,
// generated from the engine by `npm run contract` (scripts/contract.js) into contract.json. The app
// and the engine meet only through these channels; a release of either names the contract it was
// built with, and a remote engine whose hash differs is refused at the connection (#339).
//   hash        the 12-character contract hash (packages/engine/service/contract.js contractHash)
//   entries     [{ channel | send | event, method?, params?, schema?, desktop? }] in name order
//   speaks(h)   whether a contract hash is this one
const contract = require('./contract.json');

module.exports = {
  entries: contract.entries,
  hash: contract.hash,
  speaks: (h) => h === contract.hash,
};
