import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/* eslint-config-next is deliberately not used here: its flat-config export
   pulls in @rushstack/eslint-patch, which fails to patch ESLint 9.39. Its
   value was mostly next/image and next/link conventions, which TypeScript and
   review already cover. What remains below is what actually catches bugs. */
export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'public/**', '.scratch/**', 'next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
