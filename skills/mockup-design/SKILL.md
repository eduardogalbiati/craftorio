---
name: mockup-design
description: How the designer draws and edits a project's high-fidelity mockup screens (Plan & Design › Mockups, #625) - static HTML and CSS on the project's visual kit, a data-mid on every node, colours and sizes only from the kit's tokens, no network, one whole screen per answer. Use when generating a new mockup screen or applying a chat turn to one.
summary: "Mockups: draw and edit a project's screens as static HTML on its visual kit (tokens only, data-mid on every node, no network)"
used_by: "designer (mockup-generate: a new screen, or one chat turn of the editor window)"
---

# Mockup design

A mockup is a preview the owner validates a POC with: it must look like the project, not like a
generic template. You draw it from the project's own visual kit and you change only what the owner
asks. You run unattended: record each assumption in your `reply`, never ask.

## 1. The format (D4)

- One **static HTML document** per screen, `screens/<slug>/index.html`, no bundler, no framework.
- It links the kit: `<link rel="stylesheet" href="../../kit/tokens.css">` and
  `<link rel="stylesheet" href="../../kit/components.css">`; screen-only CSS goes in one `<style>`.
- **A `data-mid` on every element** inside `<body>` (`m1`, `m2`, … unique in the document). Keep
  the existing ones on an edit: the owner's selection names them. A node built from a kit component
  carries `data-kit="<Component/variant>"` (e.g. `Button/primary`).
- **No network**: no external URL in `src`, `href`, `url()` or `fetch`; the frame's CSP blocks
  them anyway. Images are the references under `refs/` or inline SVG.
- JavaScript only when the screen needs interaction to be understood (a tab, a menu), small and
  inline (the kit lint flags a script over 2000 characters).

## 2. The look

- Every colour, size, gap, radius and font from a **kit token** (`var(--…)`), never a raw value: the
  kit lint flags a raw colour and a `var(--x)` the kit does not define.
- Reuse the kit's components (`components.css`, `kit.json`) before writing new CSS. A component the
  kit lacks: build it on the tokens, name it in `data-kit`, and say in `reply` that it could be
  promoted to the kit.
- Realistic data: real-looking names, numbers and dates of the project's domain, a long title, an
  empty and an error state when the screen has them. Never lorem ipsum.
- Accessible: semantic elements, labels on controls, contrast from the kit's text tokens (axe runs
  on every turn).

## 3. A chat turn (mode edit)

1. Read the current `index.html` first.
2. The message's `selection` names the nodes (`mid`, `selector`, `kit`, `box`, `html`): change those
   and what the message says, nothing else. `area` is a region of the frame; `refs` are images.
3. Answer with the **whole document** (`html`) and a one or two sentence `reply`: what changed, and
   each assumption.

## 4. A new screen (mode generate)

From the prompt (or the Discovery card's text): one screen, the project's layout pattern from the
kit (header, navigation, content), the sections the prompt names. Greenfield (no tokens in the
kit): propose a small set of tokens in the screen's `<style>` from the references and the brand
description, and list them as assumptions in `reply`.
