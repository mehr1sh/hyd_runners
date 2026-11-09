import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local agent worktrees (never committed).
    ".claude/worktrees/**",
    // The Expo app is a separate package with its own checks (pnpm --dir mobile typecheck/test).
    "mobile/**",
  ]),
]);

export default eslintConfig;
