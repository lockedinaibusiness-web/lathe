// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    // Plain-JS scripts (fixtures/generate.mjs, scripts/dev.mjs) run in Node.
    files: ["**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/coverage/**",
      "fixtures/out/**",
      "workers/**",
      "packages/schemas/generated/**",
      "packages/schemas/quarantine/**",
      // node-pg-migrate CommonJS migrations are not ES modules.
      "packages/api/migrations/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": "off",
      eqeqeq: ["error", "always"],
    },
  },
);