import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // The app's path aliases, mirrored from tsconfig. Without these a test that
  // imports anything under "@/" fails to resolve, which quietly pushed UI
  // logic out of reach of the suite.
  resolve: {
    alias: {
      "@convex": path.resolve(__dirname, "./convex"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/**/*.test.ts", "src/**/*.test.ts"],
  },
});
