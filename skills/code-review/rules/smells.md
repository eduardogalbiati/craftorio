# Code smells (standards axis)

Baseline from Fowler's *Refactoring*. These are **judgement calls**: `minor` at most, and only
when the smell was introduced or made worse by the diff. Repository standards override this list.

| Smell | Signal in the diff | Usual remedy |
|---|---|---|
| Mysterious name | a name that does not say what the thing is or does | rename |
| Duplicated code | logic that already exists elsewhere (say where) | reuse / extract |
| Long function | a new function doing several things at different levels | extract functions |
| Long parameter list | 4+ parameters, often passed together | parameter object |
| Feature envy | a function that mostly uses another module's data | move it there |
| Data clumps | the same group of values travels together | introduce a type |
| Primitive obsession | strings/numbers standing for domain concepts (money, ids, status) | small value type |
| Repeated switches | the same `switch`/`if` chain on a type in several places | polymorphism or a lookup table |
| Shotgun surgery | one conceptual change needed edits in many modules | move related code together |
| Divergent change | one module changed for unrelated reasons | split it |
| Speculative generality | abstractions, flags or parameters with a single caller "for later" | inline / delete |
| Message chains | `a.b().c().d()` reaching through objects | hide the delegate |
| Middle man | a class that only forwards calls | remove it |
| Dead code | unreachable code, unused exports, commented-out blocks | delete |
| Conflict magnet | a name added to a one-line shared list, or new code always put before the same section comment | one item per line, sorted; place code next to its peers |
