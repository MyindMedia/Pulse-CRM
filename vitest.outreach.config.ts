import { defineConfig } from "vitest/config";
import path from "node:path";

// Focused config for the Outreach tab. Mirrors vitest.pulse-walkthrough.config.ts:
// the full vitest.config.ts needs the Tailwind PostCSS plugin and the edge runtime,
// neither of which is installed in this isolated checkout.
export default defineConfig({
  css: { postcss: { plugins: [] } },
  resolve: {
    preserveSymlinks: true,
    alias: {
      "@convex": path.resolve(__dirname, "./convex"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["convex/outreach.test.ts", "convex/outreachProspects.test.ts", "convex/outreachDrafts.test.ts", "convex/outreachCalendar.test.ts", "convex/outreachSend.test.ts", "convex/outreach/*.test.ts", "src/components/agency/outreach-panels.test.tsx"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
