# Changesets

Every change a release should mention carries a changeset: `npx changeset` asks which packages it
changes and how (patch, minor, major) and writes a file here, committed with the change. A change only
to tests, docs or tooling needs none.

The products (T7 of the Craftorio migration):

- **the app**: `@craftorio/desktop`, `@craftorio/web`, `@craftorio/ui-kit` and the fronts share one
  version (`fixed`); the root `package.json` takes it (the packaged app reports it), and its tag is
  `vX.Y.Z` (deploy.yml builds the installers);
- **the engine**: `@craftorio/engine`, tag `engine-vX.Y.Z` (release-engine.yml publishes the package);
- `@craftorio/contract` and `@craftorio/shared` have versions of their own, no tag: a change of what
  the app and the engine speak bumps the contract (`npm run contract` regenerates it).

To release: `npm run release:version` (Changesets writes the versions and the changelogs, the root
takes the app's version), commit, `npm run release:tags` (the tags of the products that moved), push
the commit and the tags.
