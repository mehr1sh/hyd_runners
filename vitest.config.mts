import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    // The Expo app runs its own vitest (pnpm --dir mobile test).
    exclude: [...configDefaults.exclude, "mobile/**"],
    setupFiles: ["tests/setup.ts"],
    coverage: { provider: "v8", include: ["src/lib/**", "src/features/**"] },
  },
});
