// Generates per-scene voiceover clips via ElevenLabs into public/vo/.
// Usage:
//   ELEVENLABS_API_KEY=... node generate-vo.mjs [--list] [--force]
// Lines are short + scene-keyed so the same clip syncs across all three cuts.
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "public", "vo");
mkdirSync(outDir, { recursive: true });

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error("Missing ELEVENLABS_API_KEY");
  process.exit(1);
}

// Charlie — "Deep, Confident, Energetic" (premade): deep brand-narrator read.
// Premade voices work on all plans; the ThaMyind instant-clone does not.
const VOICE_ID = "IKne3meq5aSn9XLyUdCD";
const MODEL = "eleven_multilingual_v2";

const LINES = {
  hook: "You didn't get into music to babysit spreadsheets.",
  chaos: "Sessions in your texts. Splits in your head. Money you can't track.",
  turn: "Pulse changes that.",
  songs: "One home for every song. From first idea to final master.",
  automate: "Bookings, deposits, splits. Handled while you sleep.",
  growth: "Watch your catalog grow. And your revenue with it.",
  scale: "From one room to an empire. The same calm control.",
  payoff: "Less chaos. More music.",
  cta: "Pulse. Run your studio like a hit.",
};

const args = process.argv.slice(2);

if (args.includes("--list")) {
  const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": KEY } });
  const json = await res.json();
  for (const v of json.voices ?? []) console.log(v.voice_id, "-", v.name);
  process.exit(0);
}

const force = args.includes("--force");

for (const [key, text] of Object.entries(LINES)) {
  const dest = join(outDir, `${key}.mp3`);
  if (existsSync(dest) && !force) {
    console.log(`skip ${key} (exists)`);
    continue;
  }
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    console.error(`FAIL ${key}: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`wrote ${key}.mp3 (${buf.length} bytes)`);
}
console.log("done");
