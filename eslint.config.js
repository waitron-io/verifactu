import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Minimal flat config for the extracted library: the ESLint and typescript-eslint
// recommended presets over the TypeScript sources and tests, nothing more. This is
// a mechanical extraction, so the config imposes no new style policy on the code.
export default tseslint.config(
  { ignores: ["dist/", "coverage/", "reports/", "node_modules/", "*.tgz"] },
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
