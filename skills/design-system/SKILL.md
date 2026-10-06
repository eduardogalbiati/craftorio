---
name: design-system
description: The app's design tokens as data to check a screen against - colours, spacing scale, typography, radius and the alignment grid, read from the `:root` tokens of src/renderer/style.css. Separate from ui-conventions (shared components and interaction conventions). Use when reviewing screenshots or styles of a UI change.
summary: "UI changes: the app's design tokens (colours, spacing, typography, alignment) from src/renderer/style.css"
used_by: "ui_reviewer (ai-development-local-hero, code_review fan-out)"
---

# Design system

`ui-conventions` says **which** component and control a screen uses and how it behaves. This skill
says **how it looks**: the colours, sizes and spacing a change must take from the app's tokens. A
screen can use the right components and still look off: a hard-coded grey next to `--muted`, a
13 px gap in a 4/8 px rhythm, a third font size in a card, a label column that does not line up.
You run unattended: record a default, never ask.

## 1. Where the tokens come from

The source of truth is the `:root` block of **`src/renderer/style.css`** (the base stylesheet every
other `src/renderer/*.css` builds on). When the values below and that file disagree, the file wins:
read its `:root` block (a few dozen lines) before judging. A project other than this app: look for
its tokens (CSS custom properties, a theme file, a tokens JSON) and apply the same checks.

## 2. Colour tokens (dark theme, the app's only theme)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0e1014` | the window background |
| `--panel` | `#151820` | cards, panels, drawers |
| `--panel-2` | `#1b1f29` | a panel inside a panel, inputs, hovered rows |
| `--border` | `#262b37` | every border and divider |
| `--text` | `#e6e8ee` | primary text |
| `--muted` | `#8a91a3` | secondary text, help lines, ids, section titles (`h2`) |
| `--accent` | `#7c9cff` | links, the primary button, selection, the focus ring |
| `--green` | `#4ade80` | success / done / passed |
| `--yellow` | `#facc15` | waiting / warning |
| `--red` | `#f87171` | failed / error / destructive |
| `--purple` | `#c084fc` | a secondary category (e.g. a mode badge) |
| `--orange` | `#fb923c` | a secondary warning category |
| `--amber` | `#d9a441` | a low-emphasis caution: an action that holds work back without losing it (Pause, `.btn.warn-ghost`: amber text and border, never filled) |
| `--info` | `#7dd3fc` | an information alert (page alerts: info light blue, warning `--yellow`, error `--red`) |

- New styles use `var(--token)`, never a raw hex/rgb that duplicates or nearly duplicates a token.
  Transparency over a token is fine (`rgba` of a token's value, `color-mix`).
- State colours keep their meaning: green never means "waiting", red is never decoration.
- Text on a coloured background stays readable (contrast at least 4.5:1 for body text).

## 3. Spacing scale

- The rhythm is **2 · 4 · 6 · 8 · 10 · 12 · 14 px** (gaps, paddings, margins in style.css use
  these; `6px` and `8px` are the most common gaps, `8px 10px` / `10px 12px` / `10px 14px` the
  usual paddings of rows and panels). Larger blocks use 16 / 20 / 24 px.
- A value outside the scale (5, 7, 9, 11, 13, 15 px) in a new rule is a finding unless it aligns
  with something specific (say what).
- Similar elements get the same spacing: two cards, two rows of a list, two fields of a form.

## 4. Typography

- Base: `13px/1.45 "Segoe UI", system-ui, sans-serif` (the `body` rule).
- Sizes in use: **11 px** (section titles `h2`: uppercase, `letter-spacing: .08em`, `--muted`,
  weight 600; badges), **12 px** (`.small`: secondary lines, tables), **13 px** (body), 14-16 px
  (headlines of a card or a dialog). 10 px only for tiny counters.
- Monospace only through `--mono` (`.mono`): ids, hashes, paths, commands, numbers in KPIs.
- At most three sizes in one card or row; weights 400 / 600 only.

## 5. Shape and focus

- Corners: `--radius` (`10px`) for panels, cards and dialogs; smaller fixed radii for controls
  (`--check-radius` `4px` for checkboxes, pills `99px`).
- Focus: `--focus-ring` (`2px solid var(--accent)`) on every focusable control; never removed
  without a replacement.
- Checkboxes and radios: `--check-size`, `--check-border`; scrollbars: the `--scrollbar-*` tokens.

## 6. Alignment grid

- Forms: labels above the controls, or one label column of a fixed width; every control of a form
  starts at the same x and controls of the same kind have the same width.
- Rows of a list or table: the same columns line up from row to row (icons, badges, times
  right-aligned when they are numbers or dates).
- Text baselines line up in a row (a badge next to a title is vertically centred on it).
- Edges: the content of a panel starts at its padding, the same on every side of the screen.

## 7. Review: what to report

Only on what the change touched, from the screenshots (original vs modified) and the CSS diff:
- `element`: what you look at; `problem`: the concrete mismatch ("gap 13px between the fields, the
  scale is 12/14", "hard-coded #999 for the help line instead of `--muted`");
- `convention`: `design-system: <section>` (colours, spacing, typography, shape, alignment);
- `blocking`: true only when it makes the screen hard to read or use (unreadable contrast, a
  state colour with the wrong meaning, a broken layout or misaligned form); spacing, a near-token
  colour or one extra size are polish (false).
