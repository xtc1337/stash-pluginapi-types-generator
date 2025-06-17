import globals from 'globals';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default tseslint
  .config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    eslintPluginPrettierRecommended,

    {
      languageOptions: {
        parserOptions: { ecmaFeatures: { jsx: true } },
        globals: { ...globals.browser },
      },
    },
    {
      plugins: {},
    },
    {
      rules: {},
    },
  )
  .map((config) => ({
    ...config,
    files: ['src/**/*.{js,mjs,cjs,ts,jsx,tsx}'],
  }));
