# Diário da fábrica (edugalbs.com/fabrica-24x7): agent instructions

The owner's public diary about the agentic software factory he builds as a hobby. Nine chapters in
Brazilian Portuguese with an English twin. This folder holds the sources; `build.js` turns them into
static pages, and `../publish/sync.js` copies them into the `eduardogalbiati/edugalbs` repo
(`public/fabrica-24x7`, Vercel deploys on push to `main`). Never edit the generated HTML there by hand.
The whole site lives on branch `claude/edugalbs-lp-2-f93980` (not merged to `main`).

## Files

- `chapters.json`: every chapter's number, date, status (`soon` or `published`) and, per language,
  slug, title and teaser. Edit only the lines you change; a save that reformats the file is a bug.
- `posts/<nn>.<lang>.md`: a chapter's text, required once it is `published`. No H1 (the title comes
  from `chapters.json`). Images as `{{base}}/media/<file>`.
- `media/`: images and slide decks (`slides-<nn>.js`, `slides-<nn>.en.js`, `slides.css`), copied as
  they are. A deck is `<div class="deck" data-deck="<id>" aria-label="…"></div>` in the Markdown, with
  `<link rel="stylesheet" href="{{base}}/media/slides.css"><script src="{{base}}/media/slides-<nn>.js"></script>`
  at the end of the post.
- `home.pt.html`, `home.en.html`, `post.html`, `style.css`, `main.js`: the pages and their assets.
- Drafts, LinkedIn posts and post images: `marketing/` in the "Posts e vídeos curtos" worktree
  (`.claude/worktrees/observabilidade-monitoramento-local-ef5266/marketing/`, not committed):
  `capitulo-<nn>.<lang>.md`, `capitulo-<nn>-post.md`, `notas-po.md`.

## What each chapter owns

A topic is told once, in its chapter; the others refer to it by name. Chapter 1 is the overview and
touches everything briefly.

| # | Chapter | Owns |
|---|---|---|
| 1 | Escala 6x1? Aqui é 24x7 | the whole first week, from the Saturday idea to the second night |
| 2 | O dia em que a IA saiu do meu volante | the crossover (29/09, 17h), Automático/Validated, the PO (triage, roadmap fit, calibration, roadmap vivo) |
| 3 | Dormi e acordei com o trabalho pronto | the first full night (30/09 to 01/10) hour by hour, the morning, the 4h45 idle gap |
| 4 | O gargalo não é o código, é o teste | test time against dev time, waiting in tests, the moving bottleneck |
| 5 | O token mais caro é o de uma IA esperando | the most expensive run that delivered nothing, polling is code's job |
| 6 | O git foi feito para humanos | merge conflicts between parallel agents, file layout as architecture |
| 7 | Refinar antes ou reagir depois? | the working increment as the cheapest spec, night work in Automático |
| 8 | Um sistema que a IA lê, a IA conserta | state in readable files, the two app copies (30/09, 22h23) fixed by AI |
| 9 | O barco de Teseu | the software rewriting itself, the handoff note conversation |

## Facts

- Source of the story and the owner's insights: the "Diário do Orchestrator" artifact
  (https://claude.ai/artifact/YRMDxrUoq4ZSELf5eKfprK, tabs Diário, Produtividade, Insights). Base a
  chapter on the owner's insights there; don't invent his opinions.
- Check every number and time against raw data before writing it: run summaries in
  `C:\Users\Eduardo\multiagent-workspace\runs\<run>\summary.json` (`started_at`, `steps`, `timing`,
  `local_merge`; skip `"mock": true`), roadmap backups in `multiagent-workspace\backlog\`, and the
  orchestrator's `git log`. Times are BRT (UTC-3).
- On another machine, all of these (the Diário's files, run summaries, roadmap backups, the
  `marketing/` drafts and posts, the git log) are copied in the Google Drive folder
  `Meu Drive/fabrica-24x7-fontes` (`G:\Meu Drive\fabrica-24x7-fontes`); its `README.md` maps each
  folder to its original, and its `refresh.mjs` updates the copies on the machine with the originals.
- **Published chapters are fixed**: never change their text, only their references to other chapters.
  When the data contradicts a published chapter, the new chapter follows the published one. The owner
  allows moving dates and times for the story's sake ("não precisa ser exatamente fiel"); numbers stay
  rounded and plausible.
- Nights: 29→30/09 was a partial night (one grouped run, stopped at 01h42; chapter 3 calls it "o
  ensaio"); 30/09→01/10 is "a primeira noite" (10 tasks); 01→02/10 is the second (about 25 tasks).
  "Cancela o monitor, vou dormir e deixar o PC rodando" was really sent on 30/09 at 00h35, but the
  diary places it on the first full night (chapters 1 and 3): keep it there.

## Writing rules

- **The owner's voice**: first person, direct, neither formal nor playful. Short paragraphs, one `##`
  per moment, lists for steps. One example carried through the chapter. No AI slop: no punchlines,
  no recap sentences, no "e aqui está o ponto" transitions; at most two impact sentences.
- **Not selling anything**: a hobby project. No money amounts, prices, availability or sign-up pitch.
  Round the numbers ("mais de 10 mil linhas", "quase 15 horas"). No issue numbers, no repository names.
- **Words**: "fábrica de software agêntica" (24x7 is the hook, not the name); "roadmap", never
  "roteiro"; "tarefa", not "issue"; "execução", not "run"; "em um/em uma", never "num/numa".
  On-screen names stay in English: Validated, Run App, Write & Review. "Automático" is translated.
- **Quotes**: the owner's own messages in full, spelling fixed, no "[…]". The AI's replies are
  paraphrased, not quoted.
- **Cross-references**: point to other chapters, even unpublished ones, as
  `capítulo 4, **O gargalo não é o código, é o teste**`. List every new one for the owner to validate.
- **Structure**: `<p class="reading-time">⏱️ N min de leitura</p>`, then
  `<aside class="learn-box"><b>TL;DR</b><p>…</p></aside>`, then the text, ending with "O próximo
  passo" toward the next chapter. Chapter 1 is about 2,500 words, chapter 2 about 1,750 plus slides;
  the chapter is longer than its LinkedIn post, never a copy of it.
- **Emojis**: only ⏱️ in the chapter. In posts, number, object and symbol emojis (1️⃣ 🔹 👇), never faces.

## Process

1. Propose an outline; the owner adds or moves focus.
2. Write the PT draft in `marketing/`, with the facts checked. Show it, with the list of
   cross-references and every open question. Show every changed text before any commit.
3. Preview (there is no staging site): copy the posts and media here, set the chapter `published`
   with a date in `chapters.json`, run `node --test test/site-24x7.test.js`, then
   `node site/publish/sync.js site <edugalbs>/public` (the clone is
   `C:\Users\Eduardo\multiagent-workspace\repos\eduardogalbiati-edugalbs`). In the edugalbs clone,
   `npm install` once and start the `edugalbs` entry of `.claude/launch.json` (`npm run dev`, port
   3000); the chapter is at `/fabrica-24x7/capitulos/<slug>`. The build needs both languages of a
   published chapter, so the preview carries an EN draft. Rounds of small edits until he says to publish.
4. The EN version is final only after the PT is approved (`posts/<nn>.en.md`, decks in
   `slides-<nn>.en.js`). EN chapters reuse the PT chart so far.
5. Publish: set the real date in `chapters.json`, rebuild, and review the edugalbs diff with
   `git diff --ignore-cr-at-eol --stat` (sync rewrites line endings; only real changes count): the new
   pages, the home cards and the previous chapter's "Próximo capítulo" card. Commit here and in
   edugalbs; push edugalbs `main` only with the owner's go-ahead, then open the live page and check it.
6. LinkedIn post (`marketing/capitulo-<nn>-post.md`): a hook line, a short story, 1️⃣–5️⃣ steps or
   🔹 bullets, "O link está no primeiro comentário. 👇", a question, hashtags, plus the first-comment
   text with the link. Then a 1080x1350 image built on the chapter's example.

## Pitfalls

- Git Bash rewrites `/fabrica-24x7` into a Windows path: set `MSYS_NO_PATHCONV=1` for build and sync.
- The TL;DR box and the reading time are styled in `media/slides.css`: a chapter without decks still
  ends with `<link rel="stylesheet" href="{{base}}/media/slides.css">`.
- Charts: dark background (#11151c), orange for the factory, blue for the owner, Archivo for titles and
  IBM Plex Sans for labels. Message charts show no axis numbers, only the shape; timelines show hours.
  Keep each chart's source as HTML in `marketing/graficos/` and render it to 2400x1350 with headless
  Edge: `msedge --headless=new --hide-scrollbars --force-device-scale-factor=2 --window-size=1200,675
  --virtual-time-budget=8000 --screenshot=<abs png> file:///<abs html>`.
- Check every slide deck for overlapping text before showing it.
