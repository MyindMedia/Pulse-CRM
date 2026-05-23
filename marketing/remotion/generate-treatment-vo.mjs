// Treatment-spec promo VO (Charlie, deep). ELEVENLABS_API_KEY=... node generate-treatment-vo.mjs [--force]
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "public", "vo");
mkdirSync(outDir, { recursive: true });
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error("Missing ELEVENLABS_API_KEY"); process.exit(1); }
const VOICE_ID = "IKne3meq5aSn9XLyUdCD"; // Charlie
const MODEL = "eleven_multilingual_v2";

const LINES = {
  t_rhythm: "Every studio has a rhythm.",
  t_chaos: "But behind the music, the business can fall out of sync fast.",
  t_pain: "Bookings in text threads. Files in random folders. Splits in someone's head. Payments waiting on a follow-up.",
  t_buried: "And the song, the one thing everyone is working toward, gets buried under the chaos around it.",
  t_reveal: "Pulse changes the way the studio moves.",
  t_centric: "Pulse is the studio management CRM built around the song. From first idea to demo, session, mix, master, and release.",
  t_orbit: "Every track becomes the center of its own workflow. People, sessions, files, splits, invoices, revisions, and deliverables, connected in one place.",
  t_montage: "Bookings, calendars, rooms, roster, inventory, releases. One command center for the whole studio.",
  t_booking: "Book rooms, assign engineers, manage equipment, and let clients request sessions through a public booking flow that feeds the pipeline automatically.",
  t_pipeline: "See every opportunity. From inquiry to booked session, delivered project, upsell, license, and sync placement.",
  t_payments: "Keep money moving with deposits, milestones, invoices, overdue reminders, and Stripe-backed payment workflows.",
  t_agents: "Then bring in AI operations agents for booking, follow-up, collections, client success, and insights. With approvals when it matters.",
  t_scale: "Whether you run one room, one studio, or an agency network, Pulse gives your team one source of truth.",
  t_end: "Pulse turns studio chaos into a system. So your team can focus on the music, the clients, and the next release.",
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
