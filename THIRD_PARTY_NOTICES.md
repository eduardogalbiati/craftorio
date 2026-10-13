# Third-party notices

Multiagent Orchestrator is released under the MIT License (see [LICENSE](LICENSE)). Some of its
bundled skills and workflows are adapted from other MIT-licensed projects. The MIT License asks
that their copyright notice and permission notice travel with the code, so they are listed here.

Libraries installed through npm keep their own licenses in `node_modules`; they are not listed here.

## Adapted sources (MIT)

### cursor/plugins: pstack

- Source: https://github.com/cursor/plugins (the `pstack` plugin)
- Copyright (c) 2026 Lauren Tan
- Used by:
  - skills: `arena-synthesis` (the arena skill), `blast-radius` (blast-radius), `claim-verification`
    (the prove-it-works principle), `decision-log` (show-me-your-work), `design-sketch` (architect),
    `review-synthesis` (interrogate), `run-retrospective` (reflect)
  - workflows: `multi-model-review.yaml` (interrogate and blast-radius), `run-retrospective.yaml`
    (reflect)

### cursor/plugins: cursor-team-kit

- Source: https://github.com/cursor/plugins (the `cursor-team-kit` plugin)
- Copyright (c) 2026 Cursor
- Used by:
  - skills: `claim-verification` (verify-this)

### mattpocock/skills

- Source: https://github.com/mattpocock/skills
- Copyright (c) 2026 Matt Pocock
- Used by:
  - skills: `bug-diagnosis` (diagnosing-bugs), `merge-conflict-resolver` (resolving-merge-conflicts),
    `pr-description` (pr), `run-retrospective` (retro)
  - workflows: `run-retrospective.yaml` (retro)

### MIT permission notice

The notice below applies to each source above, with its copyright line.

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## References (structure only, no notice needed)

These writing skills follow the structure of a published practice or standard; no text is copied.

- `adr-writing`: MADR 4.0 (Markdown Architectural Decision Records, https://adr.github.io/madr/)
  and Michael Nygard's original ADR format.
- `design-doc-writing`: "Design Docs at Google" (https://www.industrialempathy.com/posts/design-docs-at-google/).
- `rfc-writing`: the Rust RFC template (https://github.com/rust-lang/rfcs).
- `test-plan-writing`: the test plan contents of ISO/IEC/IEEE 29119-3 (which superseded IEEE 829).

A new skill or workflow adapted from an MIT project must be added here (a test checks it).

## Rust crates (native sidecars)

The native sidecars (`native/`, shipped in `resources/bin/`) are built with these crates from
crates.io, each used under its MIT license (the MIT permission notice above), except foldhash,
under the zlib license (no notice required in a binary). Their copyright notices are in each
crate's sources (`cargo tree -e normal -f "{p} {l}"` lists them).

| Crate | License | Used by |
|---|---|---|
| serde_json | MIT OR Apache-2.0 | multiagent-ctl, multiagent-mcp, multiagent-tail (direct dependency) |
| jiff | Unlicense OR MIT | multiagent-tail (direct dependency: local times) |
| anstyle-query | MIT OR Apache-2.0 | multiagent-tail (direct dependency, Windows: console colours) |
| equivalent | Apache-2.0 OR MIT | indexmap |
| foldhash | Zlib | serde_json (preserve_order) |
| hashbrown | MIT OR Apache-2.0 | indexmap |
| indexmap | Apache-2.0 OR MIT | serde_json (preserve_order) |
| itoa | MIT OR Apache-2.0 | serde_json |
| jiff-core | Unlicense OR MIT | jiff |
| jiff-tzdb | Unlicense OR MIT | jiff-tzdb-platform (Windows) |
| jiff-tzdb-platform | Unlicense OR MIT | jiff (Windows) |
| memchr | Unlicense OR MIT | serde_json |
| serde_core | MIT OR Apache-2.0 | serde_json |
| windows-link | MIT OR Apache-2.0 | windows-sys (Windows) |
| windows-sys | MIT OR Apache-2.0 | jiff, anstyle-query (Windows) |
| zmij | MIT | serde_json |

A new Rust dependency must be added here (a test checks the direct ones).
