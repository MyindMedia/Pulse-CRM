// Generates a background music bed via ElevenLabs Music into public/music.mp3.
// Usage: ELEVENLABS_API_KEY=... node generate-music.mjs [ms] [--probe]
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error("Missing ELEVENLABS_API_KEY"); process.exit(1); }

const args = process.argv.slice(2);
const ms = Number(args.find((a) => /^\d+$/.test(a))) || 75000;
const probe = args.includes("--probe");

const PROMPT =
  "Exciting, uplifting modern tech-startup anthem. Driving four-on-the-floor electronic beat, " +
  "punchy drums, bright plucky synth arpeggios, optimistic rising chord progression, cinematic " +
  "build with a confident drop. Sleek, premium, energetic, forward-momentum. Instrumental, no vocals. ~120 BPM.";

const body = JSON.stringify({ prompt: PROMPT, music_length_ms: probe ? 10000 : ms });

const res = await fetch("https://api.elevenlabs.io/v1/music", {
  method: "POST",
  headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
  body,
});

if (!res.ok) {
  console.error(`FAIL ${res.status}: ${await res.text()}`);
  process.exit(2);
}

const buf = Buffer.from(await res.arrayBuffer());
const dest = join(here, "public", probe ? "music-probe.mp3" : "music.mp3");
writeFileSync(dest, buf);
console.log(`wrote ${dest} (${buf.length} bytes)`);
