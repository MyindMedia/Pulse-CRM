// Generates the Pulse promo (hero) voiceover beats via ElevenLabs (Charlie).
// ELEVENLABS_API_KEY=... node generate-promo-vo.mjs [--force]
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "public", "vo");
mkdirSync(outDir, { recursive: true });
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error("Missing ELEVENLABS_API_KEY"); process.exit(1); }

const VOICE_ID = "IKne3meq5aSn9XLyUdCD"; // Charlie — deep, confident
const MODEL = "eleven_multilingual_v2";

const LINES = {
  p1: "Every studio knows the feeling.",
  p2: "The session is booked, but the room isn't ready. The client paid a deposit, but nobody can find the invoice.",
  p3: "The song is moving, but the business around it is scattered everywhere.",
  p4: "Sticky notes. Group chats. Personal calendars. Forgotten split sheets. Chasing payments by hand.",
  p5: "And when every engineer, artist, and client lives in a different place, momentum disappears.",
  p6: "Introducing Pulse. The studio management CRM built around the song.",
  p7: "In Pulse, every track becomes the center of the workflow. From first idea to demo, session, mix, master, and release, everything stays connected.",
  p8: "Book sessions across rooms, engineers, and equipment, with one shared calendar everyone can trust.",
  p9: "Track every opportunity, from inquiry to booked session, delivered project, upsell, license, and sync placement.",
  p10: "Keep payments moving with deposits, milestones, invoices, and automatic reminders.",
  p11: "Attach split sheets, revisions, deliverables, and release campaigns directly to the song.",
  p12: "Then let embedded AI agents handle booking, follow-up, collections, and insights, with your approval when it matters.",
  p13: "Whether you run one room or an entire agency network, Pulse gives your team one place to work from.",
  p14: "Pulse turns studio chaos into a system. So your team can focus on the music.",
};

const force = process.argv.includes("--force");
for (const [key, text] of Object.entries(LINES)) {
  const dest = join(outDir, `${key}.mp3`);
  if (existsSync(dest) && !force) { console.log(`skip ${key}`); continue; }
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true } }),
  });
  if (!res.ok) { console.error(`FAIL ${key}: ${res.status} ${await res.text()}`); process.exit(1); }
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`wrote ${key}.mp3`);
}
console.log("done");
