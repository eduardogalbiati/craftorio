// Path globs and the test files' default patterns, shared by the engine's test-file guard
// (src/engine/test-paths.js, `tests_paths`) and the Architecture tab's exclusions
// (src/shared/architecture-model.js, #356). Patterns are globs over the repository-relative path,
// with forward slashes: `*` and `?` stay within one folder, `**` crosses folders, and a pattern
// without a slash matches the file name at any depth (as in .gitignore). Case-sensitive.
// Browser: window.Globs; Node: module.exports.
(function (root) {
  const TESTS_PATHS = [
    // folders
    '**/test/**', '**/tests/**', '**/__tests__/**', '**/spec/**', '**/testdata/**',
    // JavaScript / TypeScript
    '*.test.*', '*.spec.*',
    // Python
    'test_*.py', '*_test.py', 'conftest.py',
    // Go
    '*_test.go',
    // Java / Kotlin (Maven and Gradle layout)
    '**/src/test/**', '*Test.java', '*Tests.java', '*Test.kt', '*Tests.kt',
    // C# / .NET
    '*Tests.cs', '*Test.cs', '**/*.Tests/**', '**/*.Test/**',
    // end-to-end / BDD (#143): feature files and their step definitions (e2e-test-writer-<language>)
    '*.feature', '**/e2e/**', '**/cypress/**', '**/features/steps/**', '**/features/step_definitions/**',
    '**/StepDefinitions/**', '**/*.E2E/**',
  ];

  function globToRegExp(pattern) {
    let p = String(pattern).trim().replace(/\\/g, '/').replace(/^\.\//, '');
    const anywhere = !p.includes('/') || p.startsWith('**/');
    if (p.startsWith('**/')) p = p.slice(3);
    if (p.startsWith('/')) p = p.slice(1);
    let re = '';
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === '*' && p[i + 1] === '*') {
        i++;
        if (p[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else if (c === '*') re += '[^/]*';
      else if (c === '?') re += '[^/]';
      else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${anywhere ? '(?:.*/)?' : ''}${re}$`);
  }

  // The same rule as globToRegExp, as a { test(path) } that never backtracks: the pattern is run as
  // a set of states over the path (time: path length × pattern length), so an untrusted pattern
  // (a repository's .gitattributes, #356) cannot stall the caller the way `*a*a*a…` stalls a RegExp.
  // Tokens: lit (one character), one (`?`), star (`*`), any (`**`), dirs (`**/`, i.e. `(?:.*/)?`,
  // followed by its `/` lit).
  function globMatcher(pattern) {
    let p = String(pattern).trim().replace(/\\/g, '/').replace(/^\.\//, '');
    const anywhere = !p.includes('/') || p.startsWith('**/');
    if (p.startsWith('**/')) p = p.slice(3);
    if (p.startsWith('/')) p = p.slice(1);
    const tokens = anywhere ? [{ t: 'dirs' }, { t: 'lit', c: '/' }] : [];
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === '*' && p[i + 1] === '*') {
        i++;
        if (p[i + 1] === '/') { i++; tokens.push({ t: 'dirs' }, { t: 'lit', c: '/' }); } else tokens.push({ t: 'any' });
      } else if (c === '*') tokens.push({ t: 'star' });
      else if (c === '?') tokens.push({ t: 'one' });
      else tokens.push({ t: 'lit', c });
    }
    const end = tokens.length;
    // enter state s (looping = staying in a `dirs` body, which may no longer skip its `/`)
    function add(set, s, looping) {
      if (set.has(s) && !(tokens[s] && tokens[s].t === 'dirs' && !looping)) return;
      set.add(s);
      const tok = tokens[s];
      if (!tok) return;
      if (tok.t === 'star' || tok.t === 'any') add(set, s + 1, false);
      else if (tok.t === 'dirs') {
        add(set, s + 1, false);
        if (!looping) add(set, s + 2, false);
      }
    }
    return {
      test(path) {
        const str = String(path);
        let states = new Set();
        add(states, 0, false);
        for (let i = 0; i < str.length && states.size; i++) {
          const ch = str[i];
          const next = new Set();
          for (const s of states) {
            const tok = tokens[s];
            if (!tok) continue;
            if (tok.t === 'lit' ? tok.c === ch : tok.t === 'one' && ch !== '/') add(next, s + 1, false);
            else if (tok.t === 'any' || (tok.t === 'star' && ch !== '/')) add(next, s, false);
            else if (tok.t === 'dirs') add(next, s, true);
          }
          states = next;
        }
        return states.has(end);
      },
    };
  }

  const api = { globMatcher, globToRegExp, TESTS_PATHS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Globs = api;
})(typeof window !== 'undefined' ? window : globalThis);
