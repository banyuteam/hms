import js from '@eslint/js';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'node_modules'] },
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
      // ADR-0002/0003: nothing PHI-bearing in browser storage. The only allowed key is the non-PHI `hms.locale`
      // (src/i18n/locales.ts, src/i18n/localeStore.ts).
      'no-restricted-globals': [
        'error',
        { name: 'sessionStorage', message: 'No web storage for session/PHI (ADR-0002).' },
      ],
    },
  },
  {
    files: [
      'src/i18n/locales.ts',
      'src/i18n/localeStore.ts',
      'src/**/*.test.{ts,tsx}',
      'src/test/**',
    ],
    rules: { 'no-restricted-globals': 'off' },
  },
);
