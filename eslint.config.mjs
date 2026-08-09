import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  {ignores:['lib/**','coverage/**','eslint.config.mjs','scripts/**/*.mjs']},
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {languageOptions:{parserOptions:{projectService:true,tsconfigRootDir:import.meta.dirname}},rules:{
    '@typescript-eslint/no-explicit-any':'error',
    '@typescript-eslint/no-confusing-void-expression':'off',
    '@typescript-eslint/no-unsafe-assignment':'off',
    '@typescript-eslint/no-unsafe-argument':'off',
    '@typescript-eslint/no-unsafe-member-access':'off',
    '@typescript-eslint/no-non-null-assertion':'off',
    '@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_'}]
  }}
);
