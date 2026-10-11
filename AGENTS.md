<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Staging first, production on request

There are two copies of Pulse: **staging** (`develop` branch, https://studiopulse-staging.netlify.app, Convex `fiery-cricket-350`) and **production** (`main`, https://studiopulse.tech, Convex `pastel-corgi-340`). Build every change on a branch off `develop` and merge it there; promote `develop` → `main` and deploy the production backend only when the owner asks to ship. The full steps are in `docs/ENVIRONMENTS.md`. Never copy production data into staging.
