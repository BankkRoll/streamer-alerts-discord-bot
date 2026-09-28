/**
 * ESLint flat configuration.
 *
 * Flat config is required by ESLint 9+. Type-aware rules are enabled, because
 * they catch the class of mistake that actually matters in a long-running
 * bot: floating promises, misused async handlers, and unchecked `any`.
 *
 * Several `strictTypeChecked` rules are relaxed below. Each is disabled for a
 * stated reason, not for convenience — most of this codebase validates data
 * that arrives from disk or from third-party pages, where the declared type is
 * an assumption rather than a guarantee.
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      ".scratch/**",
      "eslint.config.js",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.lint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A dropped promise in an event handler fails silently, which is the
      // worst outcome for a process expected to stay up for weeks.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",

      // Discord's payload types are broad unions; an explicit cast at the
      // boundary is clearer than restating a large structural type inline.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",

      // Interpolating a number or boolean into a log line or user-facing
      // string is safe and ubiquitous here; requiring String() adds noise.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],

      // Storage and platform code deliberately re-checks values the compiler
      // believes are already narrowed. Those checks are the ones that catch a
      // hand-edited data file or a changed upstream payload, so the rule would
      // be actively harmful here.
      "@typescript-eslint/no-unnecessary-condition": "off",

      // Driver methods are async by interface contract even when a particular
      // implementation has nothing to await.
      "@typescript-eslint/require-await": "off",

      // Intentional no-op defaults for optional callbacks.
      "@typescript-eslint/no-empty-function": "off",

      // Generic parameters on the storage helpers document caller intent even
      // where a type variable appears only once.
      "@typescript-eslint/no-unnecessary-type-parameters": "off",

      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  {
    // Scripts are CLI entry points; printing is their purpose.
    files: ["scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },

  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",

      // Config and storage validate at import time, so their tests must load
      // them dynamically with per-case environments. `typeof import(...)` is
      // the only way to type the resulting module handle.
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },

  prettier,
);
