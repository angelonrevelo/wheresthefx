import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/**
 * Flat config for the whole workspace.
 *
 * The repo previously declared `"lint": "eslint ."` and installed every
 * ESLint package, but shipped no config file at all — so the script had
 * never once run successfully.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/migration/**',
      'data/**',
      'app/web/src/components/ui/**', // vendored shadcn primitives
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Node-side workspaces
  {
    files: ['app/api/**/*.ts', 'package/**/*.ts'],
    languageOptions: {
      globals: globals.node,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
  },

  // Browser-side workspace
  {
    files: ['app/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Shared rules
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` is the main type-safety hole in this codebase (the whole map
      // data path is untyped). Warn now, ratchet to error as it is paid down.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // Config files run in Node regardless of which workspace they sit in.
  {
    files: ['**/*.config.{js,ts}', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
);
