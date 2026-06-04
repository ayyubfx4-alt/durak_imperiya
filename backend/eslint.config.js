export default [
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        // Node 20+ globalThis builtins used by iap.js / push.js.
        fetch: 'readonly',
        AbortController: 'readonly',
      },
    },
    rules: {
      // Lint ignores any identifier that starts with `_` so we can suppress
      // legitimately-unused values without disabling the rule per-line.
      // `caughtErrorsIgnorePattern` is what covers `catch (_)`, which the
      // other two patterns alone don't.
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_|^err$',
        destructuredArrayIgnorePattern: '^_',
      }],
      'no-undef': 'error',
    },
    ignores: ['node_modules/', 'tests/'],
  },
];
