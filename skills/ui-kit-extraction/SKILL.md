---
name: ui-kit-extraction
description: How the kit mapper reads a project's code (read-only) and maps its most used UI components and layout patterns onto the tokens the machine step extracted, for the project's mockups kit (#625, workflows/ui-kit-map.yaml). A minimal kit that grows, every value from a token, each assumption recorded with its evidence. Use when building or rebuilding a project's visual kit.
summary: "Mockups: map a project's 8-15 most used components and 2 layout patterns onto its extracted tokens, read-only, assumptions recorded"
used_by: "kit_mapper (ui-kit-map: the agent part of Build the visual kit)"
---

# UI kit extraction

The visual kit is what makes a mockup look like the project (D2, D3). It starts small: the tokens,
the components the screens use most, two layout patterns. It grows later from the mockups
("Promote to kit"). You only read the repository and you record assumptions instead of asking.

## 1. What is already there

The machine step (no model) has written `kit/tokens.css` (a `:root` block of the project's CSS
custom properties) and `kit/kit.json` (each token's source file and line, the fonts). Those tokens
are the truth: build on them, never rename them.

## 2. Find the components

- Look where the UI lives (components folders, templates, the main stylesheet, `tailwind.config`,
  the theme file). Count how often each component is used, not how many exist.
- Keep the **8-15 most used** (buttons and their variants, inputs, select, card, badge, table,
  tabs, modal, navigation, toast…) and **2 layout patterns** (the page shell, a list or a form page).
- Name each `<Component>/<variant>` (`Button/primary`), give it a class (`btn btn-primary`) and its
  source as `file:line` (`src/ui/Button.tsx:12`, or a range `src/ui/Button.tsx:12-40`): the place a
  person opens to check it.
- Give each component a small sample `html` (one element or a few, using its class and plain text, no
  script, no external URL): the service writes the samples into `kit/components.html`, the kit's live
  gallery in the Kit tab and in the .zip export.

## 3. Write `components_css`

- Plain CSS, one rule set per component and variant, every colour, size, gap and radius from a
  token (`var(--…)`). A value the tokens lack: the closest token, recorded as an inference.
- No framework, no external import, no font download: the mockup frame has no network.

## 4. Record the inferences

One line per assumption with its evidence ("Button/danger inferred from the red token
`--err` and src/ui/Delete.tsx:8; no danger button in the code"). A project with no UI (an API,
a CLI) or no tokens: an empty catalogue and one inference saying so; the designer then starts from
references ("Start from references", a greenfield project: pasted captures or a brand description).

## 5. What the service writes

From your answer, in one commit of the mockup repository (#835): `kit/components.css` (your
`components_css`), `kit/components.html` (one section per component: its name, its `file:line` source,
its sample `html`) and `kit/kit.json` (the tokens, then `components: [{ name, class, source, html }]` and
your `inferences`). The Kit tab lists the inferences as the kit's gaps; nothing waits on them. Later
components come from the screens with "Promote to kit".
