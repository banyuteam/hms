import js from '@eslint/js';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // CLAUDE.md §5: application state is in memory only. No web storage, cookies or IndexedDB without an approved design.
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'In-memory state only (CLAUDE.md §5).' },
        { name: 'sessionStorage', message: 'In-memory state only (CLAUDE.md §5).' },
        { name: 'indexedDB', message: 'In-memory state only (CLAUDE.md §5).' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'localStorage',
          message: 'In-memory state only (CLAUDE.md §5).',
        },
        {
          object: 'window',
          property: 'sessionStorage',
          message: 'In-memory state only (CLAUDE.md §5).',
        },
        { object: 'document', property: 'cookie', message: 'In-memory state only (CLAUDE.md §5).' },
      ],
    },
  },
  {
    // Patient data goes only through the repository functions in src/api (CLAUDE.md §6). Type imports stay allowed.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/api/**', 'src/data/**', 'src/**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/data/*'],
              message:
                'Read patient data through src/api (patientApi / emrApi / hooks), not the fixtures.',
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  {
    // Tests may assert that nothing was written to storage.
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off' },
  },
);
