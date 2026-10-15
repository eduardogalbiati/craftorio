// The function measure of JavaScript and TypeScript (#344, #385), one pure core shared by
// `scripts/code-health.js` (its ratchets) and the Architecture facts (src/architecture-facts.js),
// so both always agree. A real parser (acorn, a runtime dependency) gives each function's lines,
// cyclomatic complexity (1 + each `if`, `else if`, ternary, `&&`, `||`, `??`, `case`, `catch` and
// loop), max nesting and parameter count. A nested function is measured on its own. Functions are
// named after their binding (declaration, variable, method, property, assignment); a callback is
// named after the call it is passed to, prefixed by its enclosing function (`register/on
// callback`); a repeated name in a file gets ` #2`, ` #3`. TypeScript (.ts, .mts, .cts) has its
// types replaced by blanks first (Node's module.stripTypeScriptTypes, strip mode: lines and
// columns unchanged); syntax that strip mode refuses (enum, namespace) and JSX do not parse.
// The parser and the type stripping are Node's (Node: module.exports); as a browser <script>
// (window.CodeComplexity, the src/shared/ rule) only `measures` works.
(function (root) {
  const node = typeof module === 'object' && module.exports;
  const acorn = () => require('acorn');
  const stripTypeScriptTypes = (...args) => require('node:module').stripTypeScriptTypes(...args);

  const ANONYMOUS = '(anonymous)';
  const TYPESCRIPT = /\.[cm]?ts$/i;
  // What the core measures: JavaScript, and TypeScript without JSX
  const MEASURED = /\.(?:[cm]?js|[cm]?ts)$/i;

  const PARSE_OPTIONS = { ecmaVersion: 'latest', locations: true, allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowImportExportEverywhere: true };

  // TypeScript's types as blanks; Node warns once that the API is experimental: that warning is
  // dropped, any other warning still goes through
  function stripTypes(code) {
    const emit = process.emitWarning;
    process.emitWarning = (warning, ...rest) => {
      if (/stripTypeScriptTypes/.test(String(warning && warning.message ? warning.message : warning))) return;
      emit.call(process, warning, ...rest);
    };
    try {
      return stripTypeScriptTypes(code, { mode: 'strip' });
    } finally {
      process.emitWarning = emit;
    }
  }

  function parse(code, file) {
    let source = code;
    if (file && TYPESCRIPT.test(file)) {
      try {
        source = stripTypes(code);
      } catch (err) {
        throw new Error(`${file}: cannot parse (${err.message})`);
      }
    }
    try {
      return acorn().parse(source, { ...PARSE_OPTIONS, sourceType: 'module' });
    } catch {
      try {
        return acorn().parse(source, { ...PARSE_OPTIONS, sourceType: 'script' });
      } catch (err) {
        throw new Error(`${file}: cannot parse (${err.message})`);
      }
    }
  }

  const FUNCTIONS = new Set(['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression']);
  const BRANCHES = new Set(['CatchClause', 'ConditionalExpression', 'DoWhileStatement', 'ForInStatement', 'ForOfStatement', 'ForStatement', 'IfStatement', 'LogicalExpression', 'WhileStatement']);
  // the children of a node that sit one nesting level deeper
  const NESTED_BODIES = {
    DoWhileStatement: ['body'],
    ForInStatement: ['body'],
    ForOfStatement: ['body'],
    ForStatement: ['body'],
    IfStatement: ['consequent', 'alternate'],
    SwitchStatement: ['cases'],
    TryStatement: ['block', 'handler', 'finalizer'],
    WhileStatement: ['body'],
  };
  const NOT_CHILDREN = new Set(['end', 'loc', 'range', 'start', 'type']);

  function* children(node) {
    for (const key of Object.keys(node)) {
      if (NOT_CHILDREN.has(key)) continue;
      const value = node[key];
      const list = Array.isArray(value) ? value : [value];
      for (const child of list) if (child && typeof child.type === 'string') yield [key, child];
    }
  }

  function branchPoints(node) {
    if (node.type === 'SwitchCase') return node.test ? 1 : 0;
    return BRANCHES.has(node.type) ? 1 : 0;
  }

  // `else if` stays at its `if`'s level; the bodies of an if, a loop, a switch or a try go one deeper.
  function childDepth(node, key, child, depth) {
    const bodies = NESTED_BODIES[node.type];
    if (!bodies || !bodies.includes(key)) return depth;
    if (key === 'alternate' && child.type === 'IfStatement') return depth;
    return depth + 1;
  }

  function keyName(key, computed) {
    if (!key || computed) return null;
    if (key.type === 'Identifier') return key.name;
    if (key.type === 'PrivateIdentifier') return `#${key.name}`;
    return key.type === 'Literal' ? String(key.value) : null;
  }

  // `name('label')` when a call's first argument is a string: `$('#save').onclick`, `on('exit', …)`.
  function labelled(name, call) {
    const first = call && call.arguments && call.arguments[0];
    return name && first && first.type === 'Literal' && typeof first.value === 'string' ? `${name}(${first.value.slice(0, 40)})` : name;
  }

  function assignedName(left) {
    if (left.type === 'Identifier') return left.name;
    if (left.type !== 'MemberExpression') return null;
    return labelled(keyName(left.property, left.computed), left.object.type === 'CallExpression' ? left.object : null);
  }

  function calleeName(call) {
    const { callee } = call;
    if (callee.type === 'Identifier') return labelled(callee.name, call);
    return callee.type === 'MemberExpression' ? labelled(keyName(callee.property, callee.computed), call) : null;
  }

  // The name a function is known by, and whether it is a binding (vs. a callback or anonymous).
  function bindingName(node, parent) {
    if (node.id) return node.id.name;
    switch (parent && parent.type) {
      case 'VariableDeclarator': return parent.id.type === 'Identifier' ? parent.id.name : null;
      case 'MethodDefinition':
      case 'Property':
      case 'PropertyDefinition': return keyName(parent.key, parent.computed);
      case 'AssignmentExpression': return assignedName(parent.left);
      case 'ExportDefaultDeclaration': return 'default';
      default: return null;
    }
  }

  function functionName(node, parent, outer) {
    const bound = bindingName(node, parent);
    if (bound) return bound;
    const call = parent && (parent.type === 'CallExpression' || parent.type === 'NewExpression') && parent.callee !== node ? calleeName(parent) : null;
    const name = call ? `${call} callback` : ANONYMOUS;
    return outer ? `${outer}/${name}` : name;
  }

  // Walks one function's own code: branch points and nesting; nested functions go to `state.inner`.
  function walk(node, parent, depth, state) {
    if (FUNCTIONS.has(node.type) && node !== state.fn) {
      state.inner.push({ node, name: functionName(node, parent, state.name) });
      return;
    }
    state.complexity += branchPoints(node);
    state.nesting = Math.max(state.nesting, depth);
    for (const [key, child] of children(node)) walk(child, node, childDepth(node, key, child, depth), state);
  }

  /**
   * [{ name, file, line, lines, complexity, nesting, params }] for every function of a source text,
   * in source order. opts: { file } (the path: names the file in the result and in a parse error,
   * and a .ts/.mts/.cts path is read as TypeScript). Throws `<file>: cannot parse (…)`.
   */
  function measureSource(code, opts = {}) {
    const file = opts.file;
    const queue = [];
    walk(parse(code, file), null, 0, { fn: null, name: null, inner: queue, complexity: 0, nesting: 0 });
    const measured = [];
    while (queue.length) {
      const { node, name } = queue.shift();
      const state = { fn: node, name, inner: queue, complexity: 1, nesting: 0 };
      walk(node, null, 0, state);
      const { start, end } = node.loc;
      measured.push({ at: node.start, name, file, line: start.line, lines: end.line - start.line + 1, complexity: state.complexity, nesting: state.nesting, params: node.params.length });
    }
    const seen = new Map();
    return measured.sort((a, b) => a.at - b.at).map(({ at, ...f }) => {
      const n = (seen.get(f.name) || 0) + 1;
      seen.set(f.name, n);
      return n === 1 ? f : { ...f, name: `${f.name} #${n}` };
    });
  }

  // Whether the core measures the file at `file` (by its extension)
  const measures = (file) => MEASURED.test(String(file || ''));

  const api = {
    measures,
    measureSource,
  };
  if (node) module.exports = api;
  else root.CodeComplexity = api;
})(typeof window !== 'undefined' ? window : globalThis);
