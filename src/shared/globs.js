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

  const api = { globToRegExp, TESTS_PATHS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Globs = api;
})(typeof window !== 'undefined' ? window : globalThis);
