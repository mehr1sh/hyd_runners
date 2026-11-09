import { defineConfig } from "vitest/config";

// Only the pure TypeScript core is unit tested here (no React Native runtime).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
