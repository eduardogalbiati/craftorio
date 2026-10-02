---
order: 151
---

<!-- section:engine -->
### Agents: calibrating the Product Owner

How the Backlog's Product Owner trades speed for quality when it plans is the owner's call: a
**Speed ↔ Quality** slider with five steps, in Agents › Product Owner (its **Planning** section,
saved with Save) and in the Product Owner's drawer (the settings button next to **Clear**: a panel
over the conversation, with the model and the effort too; each change saves at once and applies to
the next answer). Both edit the same setting, `calibration` (1-5, default 2) in
`<workspace>/agents/product-owner.json`. Each step's tooltip (hover or keyboard focus) and the text
under the slider say what it prioritises:

| | Speed (1) | 2 | Balanced (3) | 4 | Quality (5) |
|---|---|---|---|---|---|
| parallel runs per stage | as many as do not share files | up to 4 | up to 3 | up to 2 | 1-2 |
| max complexity per group | 6 | 6 | 5 | 5 | 4 |
| UI issues mode | auto unless the owner asks | validated for new screens | validated for new screens | validated for any screen | validated for any screen |
| placement | earliest stage without shared files | earliest stage without shared files | after the work it builds on | after the work it builds on | its own stage after the most stable base |
| review rounds | - | - | - | - | a developer self-review (#179) when the workflow has it |

The Product Owner's prompt states the step and its parameters (they replace the skill's defaults),
the simulated Product Owner follows them, and every plan answer is kept to the step's runs per stage
(a stage with more groups is cut into consecutive stages) with a warning on a group over its
complexity. Plan questions in the drawer, the Oracle's questions to the Product Owner, the "place it
in the roadmap" chain step and the live roadmap's refills all use the saved step, so Add to roadmap
applies groups planned with it. Each answer shows the step it planned with ("Planned for Speed").

**For one question only**: the chip next to the settings button shows the step of the next
question; pick another one there, or write it in the question ("plan this one for quality"), and
only that question uses it: the saved setting does not change.
