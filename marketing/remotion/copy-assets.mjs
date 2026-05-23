// Copies the Pulse logo + UI screenshots from the parent app into public/
// so the Remotion project is self-contained at render time.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");          // pulse/
const pub = join(here, "public");
const shotsOut = join(pub, "shots");
mkdirSync(shotsOut, { recursive: true });

copyFileSync(join(repo, "public", "pulse-logo.png"), join(pub, "pulse-logo.png"));

const shots = [
  "dashboard", "songs", "studio", "calendar", "bookings", "pipeline",
  "payments", "roster", "releases", "licensing", "inventory", "agency", "settings",
];
for (const s of shots) {
  const src = join(repo, ".shots", `${s}.png`);
  if (existsSync(src)) copyFileSync(src, join(shotsOut, `${s}.png`));
  else console.warn(`warn: missing shot ${src}`);
}
console.log("assets copied -> public/");
