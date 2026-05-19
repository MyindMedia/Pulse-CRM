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
    // Convex codegen output — generated, not linted.
    "convex/_generated/**",
  ]),
  {
    rules: {
      // Pulse dialogs reset their form state when they open
      // (useEffect on the `open` flag). This is an intentional, well-scoped
      // pattern — keep it as guidance rather than a build-breaking error.
      "react-hooks/set-state-in-effect": "warn",
      // The flagged cases are display-time `Date.now()` reads in client
      // components (countdowns, "is this overdue") — benign and not SSR'd.
      // Kept as a warning so genuine impurity still surfaces in review.
      "react-hooks/purity": "warn",
    },
  },
]);

export default eslintConfig;
