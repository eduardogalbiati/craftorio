# Publishing the site (edugalbs.com)

The site lives in the `eduardogalbiati/edugalbs` repo (Next.js on Vercel; a push to `main` deploys).
Static pages go in its `public/` folder; `next.config.js` rewrites `/` to `public/home/index.html`
and serves the folders `/ai-next-level` and `/fabrica-24x7`.

- `sync.js <site dir> <edugalbs>/public`: copies `site/` (the full page, img/, run-3d/) to
  `public/ai-next-level/` with absolute paths, and builds `site/24x7/` into `public/fabrica-24x7/`
  (site/24x7/build.js). Then commit and push in the edugalbs repo.
- `home-cover.js <cover.html> <edugalbs>/public/home/index.html`: copies the owner's cover page
  (C:\Users\Eduardo\Desktop\edugalbs-cover\index.html), makes its diary link relative and adds the
  favicon links, GA4 (G-KV5SP42JE0) and the diary_enter event.
- `cover-mode.js site/publish/run-3d.source.html site/run-3d/index.html`: regenerates the 3D cover
  scene from the simulated run-3d proof of concept (cover mode, dark palette, ready signal).
- `save-poster.js`: saves a canvas capture (run-3d/index.html?cover&shot, 1600x900) as
  site/run-3d/poster.jpg.
- `import-chapter1.js`: brings chapter 1 (PT, EN, image) from the posts session's marketing/ folder.
- `ga-page.js <file...>`: adds the GA4 tag to a static page.
- `shots-3d.js [<out dir>]`: the two 3D stills of the full page (flow-3d.png, supervisor-3d.png): a simulated
  run with a verify_change failure, cut at two moments and captured in the 3D view (needs `npm run build:3d`).
  The other stills come from `npm run screenshot` with the steps in site/recordings/.
