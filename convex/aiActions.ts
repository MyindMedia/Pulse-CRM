"use node";
/* ============================================================
   AI generation actions. Node runtime because the OpenAI SDK is
   Node-only. All actions follow the same shape:

   1. Pull the data they need via internal queries
   2. Build a prompt
   3. Call OpenAI; on failure (or missing key) use a templated
      fallback so the artifact still lands
   4. Persist via internal.aiArtifacts.insertInternal

   That keeps the rest of the product working even without an
   OPENAI_API_KEY set on the deployment.
   ============================================================ */
import { v } from "convex/values";
import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { complete, DEFAULT_MODEL } from "./lib/openai";

/** Format a Date for human-readable display. */
function fmt(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

/* ============================================================
   Feature 5: Session recap email (post-completion)
   ============================================================ */
export const generateSessionRecap = action({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const ctxData = await ctx.runQuery(api.aiContext.sessionRecapContext, {
      sessionId,
    });
    if (!ctxData) return;

    const { session, artistName, artistEmail, songTitle, roomName, engineerName, log } = ctxData;

    const baseFacts = [
      `Session: ${session.title}`,
      `Artist: ${artistName}`,
      songTitle ? `Song: ${songTitle}` : null,
      `Service: ${session.serviceType}`,
      `Room: ${roomName ?? "n/a"}`,
      `Engineer: ${engineerName ?? "n/a"}`,
      `Time: ${fmt(session.startTime)} - ${fmt(session.endTime)}`,
      log?.sampleRate ? `Sample rate / bit depth: ${log.sampleRate} / ${log.bitDepth}` : null,
      log?.monitoring ? `Monitoring: ${log.monitoring}` : null,
      log?.tuningRef ? `Tuning reference: ${log.tuningRef}` : null,
      session.notes ? `Notes: ${session.notes}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const prompt = `You are the in-house communications voice for an indie recording studio. Write a friendly, warm post-session recap email to the artist. Use the facts below. 3-4 short sentences. Mention what got done, sound generous about their work, and end with a soft next step (mixing? mastering? another tracking date?).

FACTS:
${baseFacts}

Output ONLY the email body. Do not include a subject line. Sign off with the engineer's first name when given.`;

    const ai = await complete(prompt, {
      system:
        "You write polished, human, never-corny session recap emails for a recording studio.",
      maxOutputTokens: 400,
    });

    const fallbackBody = `Hey ${artistName.split(" ")[0]},

Great session today on ${session.title}. We tracked clean takes${songTitle ? ` for "${songTitle}"` : ""} in ${roomName ?? "the room"} and everything is saved + backed up.

When you're ready, let me know if you want to slot in a mix date.

- ${engineerName?.split(" ")[0] ?? "The studio"}`;

    const body = ai?.text?.trim() || fallbackBody;
    const subject = `Recap: ${session.title}`;

    await ctx.runMutation(internal.aiArtifacts.insertInternal, {
      orgId: session.orgId,
      kind: "session_recap",
      sessionId,
      roomId: session.roomId,
      title: `Recap drafted - ${session.title}`,
      summary: `Friendly post-session note ready for ${artistName}.`,
      body,
      emailDraft: {
        to: artistEmail,
        subject,
        body,
      },
      source: ai ? "openai" : "fallback",
      model: ai?.model ?? undefined,
    });
  },
});

/* ============================================================
   Feature 4: Session prep packet (1h-before)
   ============================================================ */
export const generatePrepPacket = action({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const data = await ctx.runQuery(api.aiContext.prepPacketContext, {
      sessionId,
    });
    if (!data) return;

    const { session, artistName, songTitle, roomName, engineerName, lastNotes, artistGenres, gear } = data;

    const facts = [
      `Session: ${session.title}`,
      `Artist: ${artistName}${artistGenres?.length ? ` (${artistGenres.join(", ")})` : ""}`,
      songTitle ? `Song: ${songTitle}` : null,
      `Service: ${session.serviceType}`,
      `Room: ${roomName ?? "Unassigned"}`,
      `Engineer: ${engineerName ?? "Unassigned"}`,
      `Time: ${fmt(session.startTime)} - ${fmt(session.endTime)}`,
      gear?.length ? `Installed gear: ${gear.slice(0, 6).join(", ")}` : null,
      lastNotes ? `Notes from last time: ${lastNotes}` : null,
      session.notes ? `Session notes: ${session.notes}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const prompt = `You are the studio's session prep AI. Write a tight, scannable one-page brief for the engineer running this session in one hour. Use markdown headings + bullets. Cover: who they are + what they're working on + what to set up + anything to remember from last time. Don't pad. Keep it under 200 words.

FACTS:
${facts}`;

    const ai = await complete(prompt, {
      system:
        "You write crisp engineer-facing prep packets for a recording studio. Markdown only. No fluff.",
      maxOutputTokens: 600,
    });

    const fallback = `# Prep packet - ${session.title}

**Artist:** ${artistName}
**Song:** ${songTitle ?? "n/a"}
**Service:** ${session.serviceType}
**Room:** ${roomName ?? "Unassigned"}
**Time:** ${fmt(session.startTime)} - ${fmt(session.endTime)}

## Setup
- Patch + line check the room
- Confirm Pro Tools session loaded
- Stage refreshments

## Context
${lastNotes ? `Last time: ${lastNotes}` : "First session with this artist or no prior notes."}
${session.notes ? `\nNotes: ${session.notes}` : ""}`;

    const body = ai?.text?.trim() || fallback;

    await ctx.runMutation(internal.aiArtifacts.insertInternal, {
      orgId: session.orgId,
      kind: "prep_packet",
      sessionId,
      roomId: session.roomId,
      title: `Prep packet - ${session.title}`,
      summary: `Engineer brief for ${artistName} at ${fmt(session.startTime)}.`,
      body,
      source: ai ? "openai" : "fallback",
      model: ai?.model ?? undefined,
    });
  },
});

/* ============================================================
   Feature 1: No-show prevention (24h + 1h reminders)
   ============================================================ */
async function generateReminder(
  ctx: ActionCtx,
  sessionId: Id<"sessions">,
  kind: "reminder_24h" | "reminder_1h",
): Promise<void> {
  const data = await ctx.runQuery(api.aiContext.reminderContext, { sessionId });
  if (!data) return;
  const { session, artistName, artistEmail, roomName } = data;

  const horizon = kind === "reminder_24h" ? "tomorrow" : "in an hour";
  const subject =
    kind === "reminder_24h"
      ? `Confirming your session ${horizon}`
      : `See you in 1 hour - ${session.title}`;

  const fallback =
    kind === "reminder_24h"
      ? `Hey ${artistName.split(" ")[0]},

Quick confirm for ${horizon}: ${session.title} at ${fmt(session.startTime)} in ${roomName ?? "the studio"}. Reply YES if you're locked in - we'll release the slot if we don't hear back 12 hours before.

- The studio`
      : `Hey ${artistName.split(" ")[0]},

Just a heads-up - we're set up and ready for you in ${roomName ?? "the studio"} at ${fmt(session.startTime)}. The door code is on the booking page. Drive safe.

- The studio`;

  const prompt =
    kind === "reminder_24h"
      ? `You write friendly studio confirmation messages. Write the artist a 2-3 sentence note asking them to confirm tomorrow's session. Be warm but make the ask clear. Mention the time + room. End with a soft hold-release note.

FACTS:
Artist: ${artistName}
Session: ${session.title}
Time: ${fmt(session.startTime)}
Room: ${roomName ?? "the studio"}`
      : `You write friendly studio 1-hour-out reminders. Write the artist a 2-sentence note that we're set up and ready, includes the address / room, and reassures them.

FACTS:
Artist: ${artistName}
Session: ${session.title}
Time: ${fmt(session.startTime)}
Room: ${roomName ?? "the studio"}`;

  const ai = await complete(prompt, {
    system: "You write SMS-friendly, warm, brief studio reminders. Two to three sentences max.",
    maxOutputTokens: 200,
  });

  const body = ai?.text?.trim() || fallback;
  await ctx.runMutation(internal.aiArtifacts.insertInternal, {
    orgId: session.orgId,
    kind,
    sessionId,
    roomId: session.roomId,
    title:
      kind === "reminder_24h"
        ? `24h reminder ready - ${session.title}`
        : `1h reminder ready - ${session.title}`,
    summary:
      kind === "reminder_24h"
        ? `Confirm-or-release prompt for ${artistName} 24 hours out.`
        : `"Address + we're set up" nudge for ${artistName} 1 hour out.`,
    body,
    emailDraft: { to: artistEmail, subject, body },
    source: ai ? "openai" : "fallback",
    model: ai?.model ?? undefined,
  });
}

export const generateReminder24h = action({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) =>
    generateReminder(ctx, sessionId, "reminder_24h"),
});

export const generateReminder1h = action({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) =>
    generateReminder(ctx, sessionId, "reminder_1h"),
});

/* ============================================================
   Feature 2: Weekly briefing (manual trigger or scheduled)
   ============================================================ */
export const generateWeeklyBriefing = action({
  args: {},
  handler: async (ctx) => {
    const data = await ctx.runQuery(api.aiContext.weeklyBriefingContext, {});
    if (!data) return;

    const facts = `Org: ${data.orgName}
Week of: ${fmt(data.weekStart)} - ${fmt(data.weekEnd)}

Sessions this week:
  Confirmed: ${data.confirmedCount}
  Completed: ${data.completedCount}
  Cancelled: ${data.cancelledCount}
  No-show: ${data.noShowCount}

Revenue:
  Booked (cleared deposits): ${fmtCents(data.depositRevenueCents)}
  Completed sessions value: ${fmtCents(data.completedRevenueCents)}

Top artists (sessions this week):
${data.topArtists.map((a) => `  - ${a.name}: ${a.count}x`).join("\n")}

Most-used rooms:
${data.topRooms.map((r) => `  - ${r.name}: ${r.hours}h (${r.utilization}% of bookable)`).join("\n")}

Risks / opportunities:
${data.churnRisk.length ? data.churnRisk.map((a) => `  - ${a} hasn't booked in 60+ days`).join("\n") : "  - No churn risk detected"}
`;

    const prompt = `You are the studio operating system. Write a tight Monday-morning briefing for the studio owner.

Required structure (markdown):
1. Two-sentence headline of the week
2. "What worked" - 2 bullets
3. "What to watch" - 2 bullets
4. "Recommended actions for this week" - 3 bullets, each a concrete next step

Keep it human, direct, business-savvy. No corporate fluff. 180-220 words.

DATA:
${facts}`;

    const ai = await complete(prompt, {
      system:
        "You write Monday-morning briefings for indie recording studio owners. Crisp, direct, business-minded. Markdown.",
      maxOutputTokens: 800,
    });

    const fallback = `# Week in review

**Sessions:** ${data.confirmedCount} confirmed, ${data.completedCount} completed, ${data.cancelledCount} cancelled.
**Revenue cleared:** ${fmtCents(data.depositRevenueCents)} in deposits + ${fmtCents(data.completedRevenueCents)} on completed work.
**Top room:** ${data.topRooms[0]?.name ?? "n/a"} (${data.topRooms[0]?.hours ?? 0}h booked).

## Recommended actions
- Reach out to any 60-day-quiet repeat clients with a check-in.
- Confirm next week's sessions early to lower no-show risk.
- Slot underused rooms into the next email blast.`;

    const body = ai?.text?.trim() || fallback;
    await ctx.runMutation(internal.aiArtifacts.insertInternal, {
      orgId: data.orgId,
      kind: "weekly_briefing",
      title: `Weekly briefing - ${data.orgName}`,
      summary: `${data.confirmedCount} sessions, ${fmtCents(data.completedRevenueCents)} cleared.`,
      body,
      source: ai ? "openai" : "fallback",
      model: ai?.model ?? undefined,
    });
  },
});

/* ============================================================
   Feature 3: Rate-cut recommender + promo email draft
   ============================================================ */
export const generateRateCutPromos = action({
  args: {},
  handler: async (ctx) => {
    const data = await ctx.runQuery(api.aiContext.rateCutContext, {});
    if (!data || data.recommendations.length === 0) return;

    for (const rec of data.recommendations) {
      const facts = `Studio: ${data.orgName}
Room: ${rec.roomName}
Underused window: ${rec.windowLabel}
Current rate: ${fmtCents(rec.currentRateCents)}/hr
Recommended cut: ${rec.cutPct}% (new rate ${fmtCents(rec.newRateCents)}/hr)
Hours below 40% utilization over the last 8 weeks: ${rec.lowUtilHours}
Past audience for this room: ${data.audienceSize} artists`;

      const prompt = `You are the studio's marketing voice. Write a short promotional email blast that drives bookings into an underused window in one specific room. Be warm, specific, and slightly playful. Mention the room, the window, the rate cut, and a clear call to action with a booking link placeholder {{booking_link}}. 100-150 words max.

DETAILS:
${facts}

Output:
SUBJECT: <one-line subject>
BODY: <the email body>`;

      const ai = await complete(prompt, {
        system:
          "You are the marketing voice of an indie recording studio. Warm, specific, never desperate.",
        maxOutputTokens: 500,
      });

      let subject = `${rec.cutPct}% off ${rec.roomName} - ${rec.windowLabel}`;
      let body = `Hey,

We have ${rec.windowLabel} availability open in ${rec.roomName} and we'd love to fill it. Sessions in that window are ${rec.cutPct}% off this month - ${fmtCents(rec.newRateCents)}/hr instead of ${fmtCents(rec.currentRateCents)}/hr.

Book here: {{booking_link}}

- ${data.orgName}`;

      if (ai?.text) {
        const t = ai.text;
        const subjectMatch = t.match(/SUBJECT:\s*(.+)/i);
        const bodyMatch = t.match(/BODY:\s*([\s\S]+)/i);
        if (subjectMatch && bodyMatch) {
          subject = subjectMatch[1].trim();
          body = bodyMatch[1].trim();
        } else {
          // GPT didn't follow the format - use whole output as body
          body = t.trim();
        }
      }

      await ctx.runMutation(internal.aiArtifacts.insertInternal, {
        orgId: data.orgId,
        kind: "rate_cut_promo",
        roomId: rec.roomId,
        title: `Rate-cut promo - ${rec.roomName} ${rec.windowLabel}`,
        summary: `${rec.lowUtilHours}h underused in the last 8 weeks. Suggested ${rec.cutPct}% off.`,
        body,
        emailDraft: { subject, body },
        source: ai ? "openai" : "fallback",
        model: ai?.model ?? DEFAULT_MODEL,
      });
    }
  },
});
