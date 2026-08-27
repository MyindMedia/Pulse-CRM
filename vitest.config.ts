import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // The app's path aliases, mirrored from tsconfig. Without these a test that
  // imports anything under "@/" fails to resolve, which quietly pushed UI
  // logic out of reach of the suite.
  resolve: {
    // A worktree symlinks node_modules from the main checkout. Vite resolves
    // that symlink to its real path by default, so convex-test's internal
    // `import.meta.glob("../../../convex/**/*.*s")` (relative to the
    // convex-test package inside node_modules) silently globs the MAIN
    // checkout's convex/ tree instead of this worktree's - a new module
    // resolves as missing, and an edited one tests the other tree's stale
    // code with no error at all. preserveSymlinks keeps the glob anchored to
    // the symlink's own location, i.e. this worktree.
    preserveSymlinks: true,
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
