import js from '@eslint/js';
export default [
  { ignores: ['dist/**', 'public/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        URLSearchParams: 'readonly',
      }
    },
    rules: { 'no-unused-vars': 'warn', 'no-console': 'off' }
  }
];
