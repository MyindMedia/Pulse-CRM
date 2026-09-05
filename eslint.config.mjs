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
  {
    // The native clients' change feed is built out of triggers, and a trigger
    // only fires for a mutation defined through `convex/functions.ts`. A file
    // that reaches past it to the raw constructor compiles, passes review and
    // passes its own tests - and every row it writes is invisible to every
    // mirrored device, forever, with nothing to notice it by. Enforce the rule
    // where it is broken rather than in a comment nobody reads.
    files: ["convex/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/_generated/server"],
          importNames: ["mutation", "internalMutation"],
          message:
            "Import `mutation` / `internalMutation` from convex/functions.ts. The raw constructors skip the change-feed triggers, so anything they write never reaches a synced device.",
        }],
      }],
    },
  },
  {
    // Where the wrapper is built. This is the one file that must reach past it.
    files: ["convex/functions.ts"],
    rules: { "no-restricted-imports": "off" },
  },
]);

export default eslintConfig;
