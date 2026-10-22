## Workflows, skills and seeds are code

Workflows, skills and seeds are code: install only ones you trust. A workflow runs shell commands
(transition `action:`, `ship.build`) and its templates run in the app's process; a skill or a seed
tells agents that have tools what to do. The app refuses the template tricks it knows at load time
(a template reaching `constructor`, `__proto__`, `require` or `process`, agent output put unquoted
into a shell command; `npm run check` reports them too), and the Builder asks once before saving a
workflow that was not bundled with the app (again when its file changed outside the app).
