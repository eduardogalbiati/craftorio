# JavaScript / TypeScript (Node, browser, React)

Apply together with the core checklist in SKILL.md.

## Async
- Promise without `await`/`.catch` (floating promise): the error becomes an `unhandledRejection`. `major` on a production path.
- `await` inside a `for` loop when the calls are independent → `Promise.all` (with a concurrency limit for large lists).
- `Promise.all` when one failure must not take the others down → `Promise.allSettled`.
- `async` callback in `forEach`/`map` whose result is never awaited.
- Timers/listeners (`setInterval`, `addEventListener`, `on('data')`) never removed: leak.

## Types and equality
- `==` instead of `===` (except the `x == null` idiom).
- TypeScript: `any`, forced `as` casts and `!` (non-null assertion) hiding a real error. Prefer narrowing.
- `@ts-ignore`/`eslint-disable` without a justification.
- `parseInt` without a radix; `Number('')` is `0`; unhandled `NaN`.
- Dates: `new Date(string)` with a non-ISO format, zero-based months, implicit time zone.

## Security
- `eval`, `new Function`, `vm` with external input.
- `child_process.exec`/`execSync` with an interpolated string → use `execFile`/`spawn` with an argument array.
- `path.join(base, userInput)` without checking the result stays inside `base` (path traversal).
- React: `dangerouslySetInnerHTML`, `href={userInput}` (accepts `javascript:`). DOM: `innerHTML` with external data.
- Deep merge/`Object.assign` with external JSON: prototype pollution (`__proto__`, `constructor`).
- Regex with nested quantifiers over user input (ReDoS).
- Electron: `nodeIntegration: true`, `contextIsolation: false`, IPC handlers that accept an arbitrary path/command from the renderer.

## Node
- Synchronous operations (`fs.*Sync`, `execSync`) in a request handler or in Electron's main process on a hot path.
- Streams without an `error` handler; `pipe` instead of `pipeline`.
- `process.exit` in library code.
- Environment variable read without a default or validation.

## React
- Incomplete `useEffect`/`useMemo`/`useCallback` dependencies, or an object recreated on every render.
- Unstable `key` (index in a list that reorders).
- Derived state duplicated in `useState`; setState during render.
- Effect without cleanup (subscription, timer, fetch without `AbortController`).

## Tests
- `node:test`/Jest/Vitest: async test without `await`/`return` passes without checking anything.
- Global mocks not restored (`afterEach`).
- Playwright/E2E: a step that locates by CSS class, DOM position or text fragments instead of
  `getByRole`/`getByTestId`; a step with no `expect` (it only clicks or takes a screenshot).
- UI: a new control without a `data-testid` or without an ARIA role/accessible name (an icon-only
  `<div>` with a click handler instead of a `<button>` or `role="button"` with `aria-label`).
