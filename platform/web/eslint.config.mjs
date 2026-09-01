import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// eslint-config-next under Next 15 is still an eslintrc-style shareable
// config, so it is bridged into flat config rather than spread directly.
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  {
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts", "scripts/**"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Data-layer code deliberately indexes typed arrays and dictionary
      // maps whose element types TypeScript cannot narrow; an explicit `any`
      // there is clearer than a cascade of non-null assertions.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];

export default eslintConfig;
