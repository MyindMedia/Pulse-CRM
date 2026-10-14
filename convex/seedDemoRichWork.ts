import { internalMutation } from "./functions";
import { v } from "convex/values";
import type { Id, Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/* ============================================================
   Demo rich-work fill. Makes the work surfaces of a demo org look
   lived-in: Projects (board + detail), Releases, Licensing, Songs
   (+ detail: split sheet, deliverables, revision notes), Finished
   mixes, and Sync placements.

   Convex mutations time out at ~1 second and every insert also writes
   a changeLog row via the trigger, so the work is split. CALL ORDER
   (each is idempotent and wipes only its own tagged rows first):

     1. fillSongs     12 new songs (6 beats, 6 tracks)
     2. fillProjects  8 projects + links
     3. fillTasks     tasks on those projects (run after fillProjects)
     4. fillRelease   release campaigns + licenses + sync pitches
     5. fillSongWork  split sheets, deliverables, revision comments,
                      mix notes, engineering logs

   Each takes { orgId, nowMs? }. Re-running one step is safe. Re-run
   fillSongs only if you then re-run steps 4 and 5 (they treat rows
   whose song vanished as theirs and wipe them).

   TAGS (nothing here touches rows it did not create):
     songs             isrc starts "US-DMR-"
     projects          notes end with a zero-width space (U+200B)
     projectTasks      belong to a tagged project (or a deleted one)
     projectLinks      belong to a tagged project (or a deleted one)
     releaseCampaigns  song is tagged (or deleted)
     licenses          song is tagged (or deleted)
     splitSheets       song is tagged (or deleted)
     deliverables      song is tagged (or deleted)
     revisionComments  song is tagged (or deleted)
     mediaNotes        body ends with U+200B
     syncOpportunities notes end with U+200B
     engineeringLogs   notes end with U+200B
   ============================================================ */

const ZW = "​";
const ISRC_PREFIX = "US-DMR-";
const DAY = 86_400_000;
const HOUR = 3_600_000;

type Ctx = MutationCtx;

async function base(ctx: Ctx, orgId: string) {
  const members = await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const artists = await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const songs = await ctx.db.query("songs").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const mine = songs.filter((s) => s.isrc?.startsWith(ISRC_PREFIX));
  const others = songs.filter((s) => !s.isrc?.startsWith(ISRC_PREFIX));
  return { members, artists, songs, mine, others, mineIds: new Set<string>(mine.map((s) => s._id as string)) };
}

/** A row is ours when its song is tagged or no longer exists. */
async function isOursBySong(ctx: Ctx, mineIds: Set<string>, songId: Id<"songs">) {
  if (mineIds.has(songId as string)) return true;
  return (await ctx.db.get(songId)) === null;
}

const args = { orgId: v.string(), nowMs: v.optional(v.number()) };

/* ───────────────────────── 1. songs ───────────────────────── */

const SONGS: {
  title: string;
  kind: "beat" | "single" | "album_track";
  stage: Doc<"songs">["stage"];
  genre: string;
  bpm: number;
  key: string;
  mode: string;
  mood: string[];
  color: string;
  releaseOffset?: number;
}[] = [
  { title: "Midnight Overdrive", kind: "beat", stage: "released", genre: "Trap", bpm: 142, key: "F#", mode: "Minor", mood: ["dark", "driving"], color: "#2b2d42", releaseOffset: -60 },
  { title: "Golden Hour Loop", kind: "beat", stage: "released", genre: "R&B", bpm: 88, key: "A", mode: "Major", mood: ["warm", "smooth"], color: "#f4a261", releaseOffset: -35 },
  { title: "Concrete Garden", kind: "beat", stage: "delivered", genre: "Boom Bap", bpm: 92, key: "D", mode: "Minor", mood: ["gritty", "nostalgic"], color: "#6b705c" },
  { title: "Neon Static", kind: "beat", stage: "mastering", genre: "Synthwave", bpm: 118, key: "C", mode: "Minor", mood: ["neon", "cinematic"], color: "#7b2cbf" },
  { title: "Slow Burn Sunday", kind: "beat", stage: "released", genre: "Soul", bpm: 76, key: "Bb", mode: "Major", mood: ["relaxed", "soulful"], color: "#bc6c25", releaseOffset: -90 },
  { title: "Wire to Wire", kind: "beat", stage: "delivered", genre: "Drill", bpm: 144, key: "G", mode: "Minor", mood: ["aggressive", "tense"], color: "#1b263b" },
  { title: "Paper Planes at Dawn", kind: "single", stage: "mixing", genre: "Pop", bpm: 104, key: "E", mode: "Major", mood: ["bright", "hopeful"], color: "#ffb703", releaseOffset: 14 },
  { title: "Static Hearts", kind: "single", stage: "mastering", genre: "Alt R&B", bpm: 96, key: "C#", mode: "Minor", mood: ["moody", "intimate"], color: "#3a0ca3", releaseOffset: 6 },
  { title: "Low Tide Letters", kind: "single", stage: "released", genre: "Indie", bpm: 110, key: "G", mode: "Major", mood: ["airy", "reflective"], color: "#219ebc", releaseOffset: -18 },
  { title: "Velvet Receipts", kind: "album_track", stage: "editing", genre: "Neo-Soul", bpm: 84, key: "F", mode: "Major", mood: ["lush", "playful"], color: "#9d0208", releaseOffset: 38 },
  { title: "Gravity Is a Suggestion", kind: "album_track", stage: "tracking", genre: "Hip-Hop", bpm: 128, key: "A", mode: "Minor", mood: ["confident", "big"], color: "#005f73", releaseOffset: 60 },
  { title: "Porch Light", kind: "single", stage: "demo", genre: "Singer-Songwriter", bpm: 72, key: "D", mode: "Major", mood: ["warm", "sparse"], color: "#e9c46a", releaseOffset: 90 },
];

export const fillSongs = internalMutation({
  args,
  handler: async (ctx, a) => {
    const now = a.nowMs ?? Date.now();
    const { members, artists, mine } = await base(ctx, a.orgId);
    if (!artists.length) return { error: "No artists in org." };
    for (const s of mine) await ctx.db.delete(s._id);
    let n = 0;
    for (let i = 0; i < SONGS.length; i++) {
      const s = SONGS[i];
      const artist = artists[(i * 5 + 2) % artists.length];
      const owner = members.length ? members[i % members.length] : undefined;
      await ctx.db.insert("songs", {
        orgId: a.orgId,
        title: s.title,
        artistId: artist._id,
        kind: s.kind,
        stage: s.stage,
        genre: s.genre,
        bpm: s.bpm,
        musicalKey: s.key,
        mode: s.mode,
        moodTags: s.mood,
        coverColor: s.color,
        brief:
          s.kind === "beat"
            ? `${s.genre} instrumental at ${s.bpm} BPM, built for licensing. Leave space for a lead vocal.`
            : `${s.genre} record for ${artist.name}. Keep the hook up front and the low end tight.`,
        referenceTracks: [],
        isrc: `${ISRC_PREFIX}26-${String(1001 + i)}`,
        releaseDate: s.releaseOffset !== undefined ? now + s.releaseOffset * DAY : undefined,
        revisionsIncluded: 3,
        revisionsUsed: s.stage === "delivered" || s.stage === "released" ? 3 : s.stage === "mastering" ? 2 : 1,
        streamCount: s.stage === "released" ? 18_000 + i * 41_300 : undefined,
        deadline: s.releaseOffset !== undefined && s.releaseOffset > 0 ? now + (s.releaseOffset - 5) * DAY : undefined,
        ownerMemberId: owner?._id,
      });
      n++;
    }
    return { songs: n };
  },
});

/* ───────────────────────── 2. projects ───────────────────────── */

type Stage = "tracking" | "editing" | "mixing" | "mastering" | "delivery" | "complete";
const PROJECTS: { name: string; stage: Stage; dueDays: number; songIdx: number; note: string; sinceDays: number }[] = [
  { name: "Debut EP, full production", stage: "tracking", dueDays: 28, songIdx: 10, note: "Six tracks, live drums on all of them. Vocal days booked through the month.", sinceDays: 6 },
  { name: "Lead single vocal edit", stage: "editing", dueDays: 9, songIdx: 9, note: "Comp the lead takes and tighten the stacks before mix.", sinceDays: 4 },
  { name: "Summer single mix", stage: "mixing", dueDays: 5, songIdx: 6, note: "Second mix round after client notes. Keep the vocal forward.", sinceDays: 3 },
  { name: "Static Hearts master", stage: "mastering", dueDays: 2, songIdx: 7, note: "Streaming master plus a vinyl-safe version.", sinceDays: 2 },
  { name: "Sync pitch stems package", stage: "delivery", dueDays: -2, songIdx: 3, note: "Stems, instrumental and TV mix for the music supervisor. Waiting on final sign-off.", sinceDays: 8 },
  { name: "Low Tide Letters, release", stage: "complete", dueDays: -20, songIdx: 8, note: "Delivered, approved and live on all platforms.", sinceDays: 24 },
  { name: "Beat catalog refresh", stage: "mixing", dueDays: -4, songIdx: 0, note: "Remix the top sellers for the new tier of trackout licenses. Running behind.", sinceDays: 12 },
  { name: "Acoustic EP rough demos", stage: "tracking", dueDays: 40, songIdx: 11, note: "Piano and voice, one mic. Capture the room.", sinceDays: 1 },
];

export const fillProjects = internalMutation({
  args,
  handler: async (ctx, a) => {
    const now = a.nowMs ?? Date.now();
    const { members, artists, songs, mine, others } = await base(ctx, a.orgId);
    // Wipe tagged projects and their children.
    const old = (await ctx.db.query("projects").withIndex("by_org", (q) => q.eq("orgId", a.orgId)).collect()).filter(
      (p) => p.notes?.endsWith(ZW),
    );
    for (const p of old) {
      for (const l of await ctx.db.query("projectLinks").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect())
        await ctx.db.delete(l._id);
      for (const t of await ctx.db.query("projectTasks").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect())
        await ctx.db.delete(t._id);
      await ctx.db.delete(p._id);
    }
    const rooms = await ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", a.orgId)).collect();
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) => q.eq("orgId", a.orgId))
      .order("desc")
      .take(12);
    const pool = mine.length ? mine : songs;
    let np = 0;
    let nl = 0;
    for (let i = 0; i < PROJECTS.length; i++) {
      const p = PROJECTS[i];
      const song = pool.length ? pool[p.songIdx % pool.length] : undefined;
      const owner = members.length ? members[i % members.length] : undefined;
      const created = now - (p.sinceDays + 6) * DAY;
      const done = p.stage === "complete";
      const projectId = await ctx.db.insert("projects", {
        orgId: a.orgId,
        name: p.name,
        stage: p.stage,
        ownerMemberId: owner?._id,
        dueDate: now + p.dueDays * DAY,
        notes: p.note + ZW,
        songId: song?._id,
        createdAt: created,
        updatedAt: now - (i % 3) * DAY,
        stageChangedAt: now - p.sinceDays * DAY,
        completedAt: done ? now - 20 * DAY : undefined,
      });
      np++;
      const add = async (kind: "song" | "artist" | "room" | "engineer" | "session", refId: string, label: string) => {
        await ctx.db.insert("projectLinks", { orgId: a.orgId, projectId, kind, refId, label, createdAt: created });
        nl++;
      };
      if (song) {
        await add("song", song._id, song.title);
        const art = artists.find((x) => x._id === song.artistId);
        if (art) await add("artist", art._id, art.name);
      }
      if (rooms.length) await add("room", rooms[i % rooms.length]._id, rooms[i % rooms.length].name);
      if (owner) await add("engineer", owner._id, owner.name);
      const ses = sessions[i % Math.max(1, sessions.length)];
      if (ses && i % 2 === 0) await add("session", ses._id, ses.title);
    }
    void others;
    return { projects: np, links: nl };
  },
});

/* ───────────────────────── 3. tasks ───────────────────────── */

const TASKS: Record<Stage, string[]> = {
  tracking: ["Book vocal booth for two days", "Set up session template", "Capture scratch vocals", "Print guide mix for artist", "Back up raw takes"],
  editing: ["Comp lead vocal takes", "Tune and time the backing stacks", "Clean breaths and clicks", "Send edit for approval", "Archive the edit session"],
  mixing: ["Rough balance and gain staging", "Drum bus and low-end pass", "Vocal chain and effects", "Send mix v1 to artist", "Apply revision notes", "Print stems"],
  mastering: ["Reference against the target tracks", "Streaming master at -14 LUFS", "Vinyl-safe version", "Check true peak and metadata", "Upload final masters"],
  delivery: ["Export WAV and MP3 deliverables", "Send the split sheet for signature", "Package stems and instrumental", "Collect the final balance", "Share the delivery link"],
  complete: ["Final approval received", "Invoice paid", "Files archived", "Release assets sent"],
};

export const fillTasks = internalMutation({
  args,
  handler: async (ctx, a) => {
    const now = a.nowMs ?? Date.now();
    const { members } = await base(ctx, a.orgId);
    const projects = (await ctx.db.query("projects").withIndex("by_org", (q) => q.eq("orgId", a.orgId)).collect()).filter(
      (p) => p.notes?.endsWith(ZW),
    );
    // Wipe tasks of tagged projects (and of vanished projects).
    const allTasks = await ctx.db.query("projectTasks").withIndex("by_org", (q) => q.eq("orgId", a.orgId)).collect();
    const projIds = new Set(projects.map((p) => p._id as string));
    for (const t of allTasks) {
      if (projIds.has(t.projectId as string) || (await ctx.db.get(t.projectId)) === null) await ctx.db.delete(t._id);
    }
    let n = 0;
    for (let i = 0; i < projects.length; i++) {
      const p = projects[i];
      const list = TASKS[p.stage as Stage];
      const doneCount =
        p.stage === "complete" ? list.length : Math.min(list.length - 1, Math.max(1, Math.floor(list.length * (0.3 + 0.12 * (i % 4)))));
      for (let k = 0; k < list.length; k++) {
        const done = k < doneCount;
        // Open tasks: for an overdue project, make the first open ones late.
        const lateProject = (p.dueDate ?? now) < now;
        const due = done
          ? now - (list.length - k + 1) * DAY
          : lateProject && k === doneCount
            ? now - 2 * DAY
            : (p.dueDate ?? now) - Math.max(0, list.length - 1 - k) * DAY + (k % 2 ? 0 : -HOUR);
        const owner = members.length ? members[(i + k) % members.length] : undefined;
        await ctx.db.insert("projectTasks", {
          orgId: a.orgId,
          projectId: p._id,
          title: list[k],
          stage: p.stage as Stage,
          ownerMemberId: owner?._id,
          dueDate: due,
          done,
          completedAt: done ? due + HOUR * 3 : undefined,
          sortOrder: k,
          createdAt: p.createdAt,
        });
        n++;
      }
    }
    return { tasks: n };
  },
});

/* ───────────────────────── 4. releases, licenses, sync ───────────────────────── */

const ROLLOUT: { label: string; offsetDays: number; owner: string }[] = [
  { label: "Announce the release date", offsetDays: -14, owner: "Marketing" },
  { label: "Teaser clip #1", offsetDays: -12, owner: "Social" },
  { label: "Behind-the-scenes post", offsetDays: -9, owner: "Social" },
  { label: "Open pre-save / pre-order", offsetDays: -7, owner: "Marketing" },
  { label: "Email the fan list", offsetDays: -6, owner: "Marketing" },
  { label: "Teaser clip #2", offsetDays: -4, owner: "Social" },
  { label: "Cover-art reveal", offsetDays: -2, owner: "Design" },
  { label: "Release day, all platforms live", offsetDays: 0, owner: "Label" },
  { label: "Release-day SMS blast", offsetDays: 0, owner: "Marketing" },
  { label: "Thank-you and momentum post", offsetDays: 2, owner: "Social" },
  { label: "Playlist pitch follow-up", offsetDays: 5, owner: "Marketing" },
  { label: "First-week numbers recap", offsetDays: 7, owner: "Manager" },
];

const BUYERS = [
  "Marcus Hale", "Priya Nandakumar", "Dante Rivers", "Lila Okafor", "Jonah Weiss",
  "Camila Reyes", "Theo Bridges", "Nova Lane Records", "Skyline Sound Co.", "Eli Marchetti",
];
const SUPERVISORS: { name: string; outlet: string; stage: Doc<"syncOpportunities">["stage"]; fee?: number; note: string }[] = [
  { name: "Dana Whitfield", outlet: "Netflix original series, season finale", stage: "placed", fee: 4_500_000, note: "Placed in the closing montage. Cue sheet filed." },
  { name: "Marcus Oyelaran", outlet: "Apple, product launch spot", stage: "negotiating", fee: 6_000_000, note: "Quote sent for worldwide, one year. Waiting on legal." },
  { name: "Rachel Kim", outlet: "Nike, running campaign", stage: "shortlisted", fee: 3_500_000, note: "Down to three tracks. Callback expected this week." },
  { name: "Tom Valdez", outlet: "HBO drama, episode 5", stage: "heard", note: "Listened twice. Asked for the instrumental." },
  { name: "Simone Achebe", outlet: "EA Sports, game trailer", stage: "pitched", note: "Sent the pitch with stems attached." },
  { name: "Greg Lindqvist", outlet: "Indie feature film", stage: "passed", note: "Loved it but the scene moved to score." },
  { name: "Hannah Ortiz", outlet: "Spotify, branded playlist feature", stage: "pitched", note: "Cleared for a first listen." },
  { name: "Wes Calloway", outlet: "Amazon Prime comedy, pilot", stage: "negotiating", fee: 1_800_000, note: "Counter at 20 percent higher. Reviewing." },
];

export const fillRelease = internalMutation({
  args,
  handler: async (ctx, a) => {
    const now = a.nowMs ?? Date.now();
    const { artists, mine, others, mineIds } = await base(ctx, a.orgId);
    if (!mine.length) return { error: "Run fillSongs first." };

    // Wipe our campaigns, licenses, sync opps.
    for (const r of await ctx.db.query("releaseCampaigns").withIndex("by_org", (q) => q.eq("orgId", a.orgId)).collect())
      if (await isOursBySong(ctx, mineIds, r.songId)) await ctx.db.delete(r._id);
    for (const l of await ctx.db.query("licenses").withIndex("by_org", (q) => q.eq("orgId", a.orgId)).collect())
      if (await isOursBySong(ctx, mineIds, l.songId)) await ctx.db.delete(l._id);
    for (const s of await ctx.db.query("syncOpportunities").withIndex("by_org", (q) => q.eq("orgId", a.orgId)).collect())
      if (s.notes?.endsWith(ZW)) await ctx.db.delete(s._id);

    const byTitle = (t: string) => mine.find((s) => s.title === t);
    // Release campaigns across stages: [title, days from now to release].
    const camps: [string, number][] = [
      ["Low Tide Letters", -18],
      ["Slow Burn Sunday", -90],
      ["Midnight Overdrive", -60],
      ["Static Hearts", 6],
      ["Paper Planes at Dawn", 14],
      ["Velvet Receipts", 38],
      ["Gravity Is a Suggestion", 60],
    ];
    let nc = 0;
    for (const [title, off] of camps) {
      const song = byTitle(title);
      if (!song) continue;
      const releaseDate = now + off * DAY;
      const status = off < 0 ? "released" : off <= 14 ? "active" : "planning";
      await ctx.db.insert("releaseCampaigns", {
        orgId: a.orgId,
        songId: song._id,
        releaseDate,
        status,
        tasks: ROLLOUT.map((t) => ({
          label: t.label,
          offsetDays: t.offsetDays,
          done: off + t.offsetDays <= 0 && (status !== "planning" || false),
          owner: t.owner,
        })),
      });
      nc++;
    }

    // Beat licenses: [beat, buyer idx, tier, price, term, cap, days ago, active, artistIdx?]
    const beats = mine.filter((s) => s.kind === "beat");
    const L: [number, number, "mp3" | "wav" | "trackout" | "exclusive", number, number | undefined, number | undefined, number, boolean, number | undefined][] = [
      [0, 0, "mp3", 3_000, 12, 50_000, 71, true, undefined],
      [0, 1, "wav", 7_500, 24, 250_000, 44, true, undefined],
      [0, 2, "trackout", 15_000, 36, 1_000_000, 12, true, 3],
      [1, 3, "wav", 7_500, 24, 250_000, 58, true, undefined],
      [1, 4, "exclusive", 85_000, undefined, undefined, 20, true, 6],
      [2, 5, "mp3", 3_000, 12, 50_000, 33, true, undefined],
      [3, 6, "trackout", 15_000, 36, 1_000_000, 9, true, 9],
      [4, 7, "wav", 7_500, 24, 250_000, 80, true, undefined],
      [4, 8, "mp3", 3_000, 12, 50_000, 27, false, undefined],
      [5, 9, "exclusive", 120_000, undefined, undefined, 5, true, 12],
      [5, 2, "wav", 7_500, 24, 250_000, 3, true, undefined],
      [2, 1, "trackout", 15_000, 36, 1_000_000, 1, true, undefined],
    ];
    let nl = 0;
    for (const [bi, who, tier, price, term, cap, ago, active, art] of L) {
      const beat = beats[bi % Math.max(1, beats.length)];
      if (!beat) continue;
      await ctx.db.insert("licenses", {
        orgId: a.orgId,
        songId: beat._id,
        buyerName: BUYERS[who % BUYERS.length],
        buyerArtistId: art !== undefined && artists.length ? artists[art % artists.length]._id : undefined,
        tier,
        priceCents: price,
        termMonths: term,
        streamCap: cap,
        active,
        soldAt: now - ago * DAY,
      });
      nl++;
    }

    // Sync pitches across stages, on our tracks plus the org's existing songs.
    const syncSongs = [...mine.filter((s) => s.kind !== "beat"), ...others, ...mine.filter((s) => s.kind === "beat")];
    let ns = 0;
    for (let i = 0; i < SUPERVISORS.length; i++) {
      const s = SUPERVISORS[i];
      const song = syncSongs[i % syncSongs.length];
      await ctx.db.insert("syncOpportunities", {
        orgId: a.orgId,
        songId: song._id,
        supervisorName: s.name,
        outlet: s.outlet,
        stage: s.stage,
        feeCents: s.fee,
        notes: s.note + ZW,
        updatedAt: now - (i * 2 + 1) * DAY,
      });
      ns++;
    }
    return { campaigns: nc, licenses: nl, sync: ns };
  },
});

/* ───────────────────────── 5. split sheets, deliverables, notes, logs ───────────────────────── */

const WRITERS = [
  { name: "Jordan Ellis", role: "Writer", pro: "ASCAP", ipi: "00618420931" },
  { name: "Maya Castellanos", role: "Writer", pro: "BMI", ipi: "00734512067" },
  { name: "Devon Park", role: "Producer", pro: "BMI", ipi: "00591873420" },
  { name: "Amara Okonkwo", role: "Writer", pro: "SESAC", ipi: "00812649305" },
];
const NOTES = [
  "Vocal is a touch buried in the second chorus.",
  "Love the low end. Can the kick sit a hair louder?",
  "Bridge reverb feels long, try a shorter tail.",
  "Hi-hats are sharp at 1:12, soften them.",
  "Can we hear the guitar earlier in verse one?",
  "Ad-libs are perfect, keep them as they are.",
  "Lift the outro by half a dB.",
];

export const fillSongWork = internalMutation({
  args,
  handler: async (ctx, a) => {
    const now = a.nowMs ?? Date.now();
    const { members, artists, mine, mineIds } = await base(ctx, a.orgId);
    if (!mine.length) return { error: "Run fillSongs first." };

    // Wipe ours.
    for (const x of await ctx.db.query("revisionComments").withIndex("by_org", (q) => q.eq("orgId", a.orgId)).collect())
      if (await isOursBySong(ctx, mineIds, x.songId)) await ctx.db.delete(x._id);
    for (const x of await ctx.db.query("mediaNotes").withIndex("by_org", (q) => q.eq("orgId", a.orgId)).collect())
      if (x.body.endsWith(ZW)) await ctx.db.delete(x._id);
    for (const x of await ctx.db.query("deliverables").withIndex("by_org", (q) => q.eq("orgId", a.orgId)).collect())
      if (await isOursBySong(ctx, mineIds, x.songId)) await ctx.db.delete(x._id);
    for (const x of await ctx.db.query("splitSheets").withIndex("by_org", (q) => q.eq("orgId", a.orgId)).collect())
      if (await isOursBySong(ctx, mineIds, x.songId)) await ctx.db.delete(x._id);
    for (const x of await ctx.db.query("engineeringLogs").withIndex("by_org", (q) => q.eq("orgId", a.orgId)).collect())
      if (x.notes?.endsWith(ZW)) await ctx.db.delete(x._id);

    const tracks = mine.filter((s) => s.kind !== "beat");
    const artistName = (id: Id<"artists">) => artists.find((x) => x._id === id)?.name ?? "Artist";

    // Split sheets on 8 songs.
    const statuses: ("draft" | "sent" | "fully_executed")[] = ["fully_executed", "fully_executed", "sent", "sent", "draft", "fully_executed", "sent", "draft"];
    const pool = [...tracks, ...mine.filter((s) => s.kind === "beat")].slice(0, 8);
    let nsp = 0;
    for (let i = 0; i < pool.length; i++) {
      const song = pool[i];
      const status = statuses[i];
      const w1 = WRITERS[i % WRITERS.length];
      const w2 = WRITERS[(i + 1) % WRITERS.length];
      const eng = members.length ? members[i % members.length] : undefined;
      const allSigned = status === "fully_executed";
      const sentSome = status === "sent";
      const split = i % 2 ? [50, 30, 20] : [60, 25, 15];
      const mk = (idx: number, name: string, role: string, pro: string, ipi: string, email: string) => ({
        name,
        role,
        masterPct: split[idx],
        publishingPct: split[idx],
        pro,
        ipi,
        email,
        signed: allSigned || (sentSome && idx === 0),
        signedAt: allSigned || (sentSome && idx === 0) ? now - (6 + idx + i) * DAY : undefined,
        signature: allSigned || (sentSome && idx === 0) ? name : undefined,
        signatureKind: allSigned || (sentSome && idx === 0) ? ("typed" as const) : undefined,
        signatureFont: allSigned || (sentSome && idx === 0) ? "Caveat" : undefined,
      });
      await ctx.db.insert("splitSheets", {
        orgId: a.orgId,
        songId: song._id,
        status,
        contributors: [
          mk(0, artistName(song.artistId), "Artist", "ASCAP", `0059${1000 + i}0${i}`, `artist${i}@example.com`),
          mk(1, w1.name, w1.role, w1.pro, w1.ipi, `${w1.name.split(" ")[0].toLowerCase()}@example.com`),
          mk(2, eng?.name ?? w2.name, eng ? "Producer / Engineer" : w2.role, w2.pro, w2.ipi, `studio${i}@example.com`),
        ],
        updatedAt: now - (i + 1) * DAY,
      });
      nsp++;
    }

    // Deliverables on 6 songs: mix versions + master/stems, mixed statuses.
    type Spec = { kind: "mix" | "master" | "stems" | "instrumental"; version: number; label: string; status: "delivered" | "in_review" | "approved" | "final"; dur: number; gated: boolean };
    const plan: Spec[][] = [
      [
        { kind: "mix", version: 1, label: "Mix v1", status: "delivered", dur: 214, gated: false },
        { kind: "mix", version: 2, label: "Mix v2, vocal up", status: "approved", dur: 214, gated: false },
        { kind: "master", version: 3, label: "Master, streaming", status: "final", dur: 214, gated: true },
      ],
      [
        { kind: "mix", version: 1, label: "Mix v1", status: "delivered", dur: 187, gated: false },
        { kind: "mix", version: 2, label: "Mix v2, revised", status: "in_review", dur: 187, gated: false },
      ],
      [
        { kind: "mix", version: 1, label: "Mix v1", status: "approved", dur: 232, gated: false },
        { kind: "master", version: 2, label: "Master, vinyl safe", status: "approved", dur: 232, gated: true },
        { kind: "stems", version: 3, label: "Stems package", status: "delivered", dur: 232, gated: true },
      ],
      [{ kind: "mix", version: 1, label: "Rough mix", status: "in_review", dur: 201, gated: false }],
      [
        { kind: "mix", version: 1, label: "Mix v1", status: "delivered", dur: 176, gated: false },
        { kind: "mix", version: 2, label: "Mix v2", status: "in_review", dur: 176, gated: false },
        { kind: "instrumental", version: 3, label: "Instrumental", status: "delivered", dur: 176, gated: false },
      ],
      [
        { kind: "mix", version: 1, label: "Mix v1", status: "approved", dur: 245, gated: false },
        { kind: "master", version: 2, label: "Final master", status: "final", dur: 245, gated: true },
      ],
    ];
    const dpool = [...mine.filter((s) => s.kind !== "beat"), ...mine.filter((s) => s.kind === "beat")].slice(0, plan.length);
    let nd = 0;
    let nc = 0;
    let nn = 0;
    let noteIdx = 0;
    for (let i = 0; i < dpool.length; i++) {
      const song = dpool[i];
      for (const d of plan[i]) {
        const approved = d.status === "approved" || d.status === "final";
        const id = await ctx.db.insert("deliverables", {
          orgId: a.orgId,
          songId: song._id,
          kind: d.kind,
          version: d.version,
          label: d.label,
          status: d.status,
          durationSec: d.dur,
          paymentGated: d.gated,
          approvedAt: approved ? now - (3 + i) * DAY : undefined,
          approvedBy: approved ? artistName(song.artistId) : undefined,
        });
        nd++;
        if (d.kind === "mix" || d.kind === "master") {
          if (d.status === "in_review" || d.status === "delivered") {
            const count = d.status === "in_review" ? 2 : 1;
            for (let k = 0; k < count && nc < 16; k++) {
              await ctx.db.insert("revisionComments", {
                orgId: a.orgId,
                songId: song._id,
                deliverableId: id,
                timestampSec: 22 + k * 57 + i * 9,
                body: NOTES[noteIdx++ % NOTES.length],
                authorName: artistName(song.artistId),
                resolved: d.status === "delivered",
              });
              nc++;
            }
          }
          if (nn < 8) {
            await ctx.db.insert("mediaNotes", {
              orgId: a.orgId,
              deliverableId: id,
              body: (d.status === "approved" || d.status === "final" ? "Approved. Ready to send to distribution." : NOTES[(noteIdx + 3) % NOTES.length]) + ZW,
              author: members.length ? members[i % members.length].name : "Studio",
              createdAt: now - (i + 2) * DAY,
            });
            nn++;
          }
        }
      }
    }

    // Engineering logs on recent completed sessions.
    const sessions = (
      await ctx.db
        .query("sessions")
        .withIndex("by_org_start", (q) => q.eq("orgId", a.orgId).lt("startTime", now))
        .order("desc")
        .take(40)
    )
      .filter((s) => s.status === "completed")
      .slice(0, 4);
    const chains = [
      [
        { track: "Lead vocal", source: "Voice", mic: "Neumann U87", preamp: "Neve 1073", outboard: "1176 into LA-2A", input: "Input 1", micPosition: "8 inches, pop filter" },
        { track: "Acoustic guitar", source: "Martin D-28", mic: "AKG C451", preamp: "API 512c", input: "Input 2", micPosition: "12th fret, 10 inches" },
      ],
      [
        { track: "Kick in", source: "Drum kit", mic: "Beta 91A", preamp: "Neve 1073", input: "Input 3" },
        { track: "Overheads", source: "Drum kit", mic: "Coles 4038 pair", preamp: "API 512c", input: "Inputs 5-6", micPosition: "Recorderman" },
      ],
      [{ track: "Piano", source: "Yamaha C7", mic: "DPA 4011 pair", preamp: "Grace m101", input: "Inputs 7-8", micPosition: "Over the hammers" }],
      [{ track: "Bass DI", source: "Fender Precision", preamp: "Avalon U5", outboard: "1176", input: "Input 9" }],
    ];
    let nlg = 0;
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      await ctx.db.insert("engineeringLogs", {
        orgId: a.orgId,
        sessionId: s._id,
        songId: s.songId ?? (mine.length ? mine[(i + 6) % mine.length]._id : undefined),
        sampleRate: i % 3 === 2 ? "96 kHz" : "48 kHz",
        bitDepth: "24-bit",
        tuningRef: "A=440",
        monitoring: i % 2 ? "ATC SCM25 and Auratone" : "Genelec 8351 and Yamaha NS-10",
        tempoMap: `${[96, 104, 88, 120][i]} BPM, 4/4, no changes`,
        signalChains: chains[i % chains.length],
        notes: ["Tracked live with the full band, three takes kept.", "Vocal takes comped from takes 4 and 7.", "Piano re-amped for width, print kept.", "DI plus amp blend, phase checked."][i] + ZW,
        updatedAt: now - (i + 1) * DAY,
      });
      nlg++;
    }
    return { splitSheets: nsp, deliverables: nd, comments: nc, mixNotes: nn, engineeringLogs: nlg };
  },
});
