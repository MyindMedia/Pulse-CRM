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
import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { WeeklyBriefingData, RateCutData } from "./aiContext";
import { complete, DEFAULT_MODEL } from "./lib/openai";
import { verifyDraft } from "./lib/aiVerify";
import { tenantGuard, fenceUntrusted } from "./lib/aiGuard";

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

PERSONALIZATION TOKENS - use these EXACTLY where appropriate:
- {{user_FirstName}} for the artist's first name (do not substitute with a literal name)
- {{room_name}} for the studio room

FACTS (the room and song are NOT tokens, but the recipient first name IS):
${baseFacts}

Output ONLY the email body. Do not include a subject line. Sign off with the engineer's first name when given. Use {{user_FirstName}} in the greeting.`;

    const ai = await complete(prompt, {
      system:
        "You write polished, human, never-corny session recap emails for a recording studio. Use {{user_FirstName}} for the artist's name so the downstream blast system can personalize per recipient.",
      maxOutputTokens: 400,
    });

    const fallbackBody = `Hey {{user_FirstName}},

Great session today on ${session.title}. We tracked clean takes${songTitle ? ` for "${songTitle}"` : ""} in ${roomName ?? "{{room_name}}"} and everything is saved + backed up.

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
      ? `Hey {{user_FirstName}},

Quick confirm for ${horizon}: ${session.title} at ${fmt(session.startTime)} in ${roomName ?? "{{room_name}}"}. Reply YES if you're locked in - we'll release the slot if we don't hear back 12 hours before.

- The studio`
      : `Hey {{user_FirstName}},

Just a heads-up - we're set up and ready for you in ${roomName ?? "{{room_name}}"} at ${fmt(session.startTime)}. The door code is on the booking page. Drive safe.

- The studio`;

  const prompt =
    kind === "reminder_24h"
      ? `You write friendly studio confirmation messages. Write the artist a 2-3 sentence note asking them to confirm tomorrow's session. Be warm but make the ask clear. Mention the time + room. End with a soft hold-release note.

PERSONALIZATION TOKENS - use EXACTLY:
- {{user_FirstName}} for the recipient (artist) first name; do NOT substitute their literal name

FACTS:
Session: ${session.title}
Time: ${fmt(session.startTime)}
Room: ${roomName ?? "the studio"}

Greet the artist with {{user_FirstName}}.`
      : `You write friendly studio 1-hour-out reminders. Write the artist a 2-sentence note that we're set up and ready, includes the address / room, and reassures them.

PERSONALIZATION TOKENS - use EXACTLY:
- {{user_FirstName}} for the recipient (artist) first name; do NOT substitute their literal name

FACTS:
Session: ${session.title}
Time: ${fmt(session.startTime)}
Room: ${roomName ?? "the studio"}

Greet the artist with {{user_FirstName}}.`;

  const ai = await complete(prompt, {
    system:
      "You write SMS-friendly, warm, brief studio reminders. Two to three sentences max. Always use {{user_FirstName}} for the recipient's first name.",
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
async function writeWeeklyBriefing(ctx: ActionCtx, data: NonNullable<WeeklyBriefingData>) {
  {
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
  }
}

/** Public: generate the weekly briefing for the caller's active org. */
export const generateWeeklyBriefing = action({
  args: {},
  handler: async (ctx) => {
    const data = await ctx.runQuery(api.aiContext.weeklyBriefingContext, {});
    if (!data) return;
    await writeWeeklyBriefing(ctx, data);
  },
});

/** Internal: weekly briefing for an explicit org (cron fan-out). */
export const generateWeeklyBriefingForOrg = internalAction({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const data = await ctx.runQuery(internal.aiContext.weeklyBriefingContextForOrg, { orgId });
    if (!data) return;
    await writeWeeklyBriefing(ctx, data);
  },
});

/** Internal: fan the weekly briefing across every active subaccount. */
export const runWeeklyForAllOrgs = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const ids: string[] = await ctx.runQuery(internal.orgs.listActiveOrgIds, {});
    for (const orgId of ids) {
      await ctx.scheduler.runAfter(0, internal.aiActions.generateWeeklyBriefingForOrg, { orgId });
    }
    return { scheduled: ids.length };
  },
});

/* ============================================================
   Feature 3: Rate-cut recommender + promo email draft
   ============================================================ */
async function writeRateCutPromos(ctx: ActionCtx, data: NonNullable<RateCutData>) {
  {
    if (data.recommendations.length === 0) return;

    // Booking-link helper: studios have a public slug at /book/<slug>.
    // We build a real URL with the discount code pre-applied so the
    // recipient lands on a discounted booking flow.
    const baseBookingUrl =
      data.orgSlug
        ? `https://pulse-dash-kit.netlify.app/book/${data.orgSlug}`
        : "https://pulse-dash-kit.netlify.app/book";

    for (const rec of data.recommendations) {
      // Register the generated code on the org so the ?code= link actually
      // applies a discount at checkout (otherwise the promo is a dead link).
      await ctx.runMutation(internal.orgs.ensureDiscountCode, {
        orgId: data.orgId,
        code: rec.discountCode,
        pct: rec.cutPct,
        label: `${rec.roomName} ${rec.windowLabel}`,
      });
      const bookingLink = `${baseBookingUrl}/${rec.roomId}?code=${rec.discountCode}`;
      const minBlockLabel = `${fmtCents(rec.minBlockCents)} for the ${rec.minimumHours}h minimum`;
      const facts = `Studio: ${data.orgName}
Room: ${rec.roomName}
Underused window: ${rec.windowLabel}
Current rate: ${fmtCents(rec.currentRateCents)}/hr
Recommended cut: ${rec.cutPct}% (new rate ${fmtCents(rec.newRateCents)}/hr)
Minimum block (auto-applied): ${minBlockLabel}
Discount code: ${rec.discountCode}
Booking link: ${bookingLink}
Hours below 40% utilization over the last 8 weeks: ${rec.lowUtilHours}
Past audience for this room: ${data.audienceSize} artists`;

      const prompt = `You are the studio's marketing voice. Write a short promotional email blast that drives bookings into an underused window in one specific room. Be warm, specific, and slightly playful. 100-150 words max.

REQUIRED CONTENT (every email MUST include these literally):
- Greeting using {{user_FirstName}} (this is a merge token; DO NOT substitute a real name)
- The room name: ${rec.roomName}
- The exact window: ${rec.windowLabel}
- The discount code (verbatim, so the recipient can use it): ${rec.discountCode}
- The discounted minimum-block price (what they'd actually pay if they book the smallest block): ${minBlockLabel}
- The booking link as a clickable URL: ${bookingLink}

DETAILS:
${facts}

Output:
SUBJECT: <one-line subject>
BODY: <the email body>`;

      const ai = await complete(prompt, {
        system:
          "You are the marketing voice of an indie recording studio. Warm, specific, never desperate. ALWAYS use {{user_FirstName}} as the recipient greeting merge token; never substitute a literal name.",
        maxOutputTokens: 600,
      });

      let subject = `${rec.cutPct}% off ${rec.roomName} - ${rec.windowLabel}`;
      let body = `Hey {{user_FirstName}},

We have ${rec.windowLabel} availability open in ${rec.roomName} and we'd love to fill it. Sessions in that window are ${rec.cutPct}% off this month - ${fmtCents(rec.newRateCents)}/hr instead of ${fmtCents(rec.currentRateCents)}/hr. That works out to ${minBlockLabel}.

Use code ${rec.discountCode} - it's already baked into this link so you can book in one tap:
${bookingLink}

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
        summary: `${rec.lowUtilHours}h underused. ${rec.cutPct}% off - ${minBlockLabel}. Code ${rec.discountCode}.`,
        body,
        emailDraft: { subject, body },
        source: ai ? "openai" : "fallback",
        model: ai?.model ?? DEFAULT_MODEL,
      });
    }
  }
}

/** Public: generate rate-cut promos for the caller's active org. */
export const generateRateCutPromos = action({
  args: {},
  handler: async (ctx) => {
    const data = await ctx.runQuery(api.aiContext.rateCutContext, {});
    if (!data) return;
    await writeRateCutPromos(ctx, data);
  },
});

/** Internal: rate-cut promos for an explicit org (cron fan-out). */
export const generateRateCutPromosForOrg = internalAction({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const data = await ctx.runQuery(internal.aiContext.rateCutContextForOrg, { orgId });
    if (!data) return;
    await writeRateCutPromos(ctx, data);
  },
});

/** Internal: fan the rate-cut sweep across every active subaccount. */
export const runRateCutForAllOrgs = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const ids: string[] = await ctx.runQuery(internal.orgs.listActiveOrgIds, {});
    for (const orgId of ids) {
      await ctx.scheduler.runAfter(0, internal.aiActions.generateRateCutPromosForOrg, { orgId });
    }
    return { scheduled: ids.length };
  },
});

/* ============================================================
   Named-agent LLM enrichment.

   opsBrain seeds every action with a deterministic fallback body, then
   schedules this action with the ids of the just-created rows whose
   draft an LLM should upgrade. For email actions we rewrite the body in
   place; for the rich-body agents (session prep, post-session recap,
   revision triage) we write an aiArtifacts row and link it back via
   opsActions.artifactId. Without an OPENAI_API_KEY, complete() returns
   null and we leave the deterministic fallback untouched - nothing breaks.
   ============================================================ */

/** kind label used on the linked artifact, per action type. */
type ArtifactKind = "lead_followup" | "revision_triage" | "reactivation_campaign" | "rights_alert" | "prep_packet" | "session_recap";

function maskTokens(s: string): string {
  // Keep the {{user_FirstName}} merge token intact for the blast system.
  return s;
}

/** Guarantee the real pay URL ends up in the body: swap any bracketed
 *  placeholder ("[payment link]", "[link to portal]"…) for it, and append it
 *  if the model omitted the link entirely. */
function ensurePayLink(body: string, url: string): string {
  let out = body.replace(/\[[^\]]*(?:link|pay|portal|url|invoice)[^\]]*\]/gi, url);
  if (!out.includes(url)) out = `${out.trimEnd()}\n\nPay it here: ${url}`;
  return out;
}

export const enrichOpsActions = internalAction({
  args: { ids: v.array(v.id("opsActions")) },
  handler: async (ctx, { ids }) => {
    let enriched = 0;
    for (const id of ids) {
      const c = await ctx.runQuery(internal.opsActions.enrichmentContext, { id });
      if (!c) continue; // gone or already decided

      const firstNameToken = "{{user_FirstName}}";

      // ── Email-body agents: rewrite the payload body in place. ──
      if (
        c.type === "convert_lead" ||
        c.type === "reengage_quiet_artist" ||
        c.type === "payment_reminder" ||
        c.type === "post_session_recap" ||
        c.type === "no_show_risk"
      ) {
        const persona =
          c.type === "convert_lead"
            ? `You are the booking voice of ${c.orgName}, an indie recording studio. A new lead just came in. Write a warm, concrete reply that offers two specific time options and asks for a deposit to hold the slot. 90-130 words.`
            : c.type === "reengage_quiet_artist"
              ? `You are the relationship voice of ${c.orgName}. Win back a client who has gone quiet for 90+ days. Warm, no guilt, one soft call to book. 70-110 words.`
              : c.type === "payment_reminder"
                ? `You are the billing voice of ${c.orgName}. Nudge a past-due invoice. Friendly, clear, easy to act on. 60-90 words.`
                : c.type === "post_session_recap"
                  ? `You are the studio's communications voice for ${c.orgName}. Write a warm post-session recap to the artist and propose the next stage. 3-4 sentences.`
                  : `You are the front desk of ${c.orgName}. Send a confirm-or-release nudge for an at-risk upcoming session. Warm, clear, 2-3 sentences.`;

        const facts = [
          c.artistName ? `Artist: ${c.artistName}` : null,
          c.genres?.length ? `Genres: ${c.genres.join(", ")}` : null,
          c.artistGenres?.length ? `Genres: ${c.artistGenres.join(", ")}` : null,
          c.songTitle ? `Song: ${c.songTitle}` : null,
          c.session ? `Session: ${c.session.title} (${c.session.serviceType})` : null,
          c.roomName ? `Room: ${c.roomName}` : null,
          c.subject ? `Working subject: ${c.subject}` : null,
        ]
          .filter(Boolean)
          .join("\n");

        const payLine = c.payLink
          ? `\nPAYMENT LINK (include this EXACT url on its own line as a clickable link so they can pay now - never write a placeholder like "[payment link]"): ${c.payLink}`
          : "";

        const guide = await ctx.runQuery(internal.predictions.styleGuidance, {
          orgId: c.orgId,
          actionType: c.type,
        });

        const prompt = `${persona}

Use ${firstNameToken} for the recipient's first name in the greeting - it is a merge token, do NOT substitute a literal name.

${fenceUntrusted("FACTS", facts || "(no extra facts)")}${payLine}${guide ? `\n\n${guide}` : ""}

Output ONLY the email body. No subject line.`;

        let withinAiCap = true;
        try {
          await ctx.runQuery(internal.usage.checkLimit, {
            orgId: c.orgId,
            metric: "ai_credits",
            add: 1,
          });
        } catch {
          withinAiCap = false;
        }
        if (withinAiCap) {
          const ai = await complete(prompt, {
            system: `You write warm, human, on-brand studio emails for ${c.orgName}. ${tenantGuard(c.orgName)} Always greet with ${firstNameToken}. Never corny, never corporate. Never invent placeholder links - only use URLs you are given.`,
            maxOutputTokens: 400,
          });
          if (ai?.text) {
            await ctx.runMutation(internal.usage.record, {
              orgId: c.orgId,
              metric: "ai_credits",
              amount: 1,
            });
          }
          if (ai?.text?.trim()) {
            const masked = maskTokens(ai.text.trim());
            const finalBody = c.payLink ? ensurePayLink(masked, c.payLink) : masked;
            // Verifier gate: never surface an AI body with a placeholder token
            // or an invented dollar amount (these emails are not given a money
            // fact, so any $ figure is a hallucination). On failure we keep the
            // deterministic fallback the rule layer already wrote.
            const verdict = verifyDraft(finalBody, { allowedMoney: [] });
            if (verdict.ok) {
              await ctx.runMutation(internal.opsActions.applyEnrichment, {
                id,
                body: finalBody,
                model: ai.model,
              });
              enriched++;
            } else {
              console.warn(`[enrich] rejected AI draft for ${c.type}: ${verdict.issues.join("; ")}`);
            }
          }
        }
        continue;
      }

      // ── Rich-body agents: write an aiArtifact + link it. ──
      let artifactKind: ArtifactKind | null = null;
      let prompt = "";
      let system = "";
      let title = c.title;
      let summary = "";
      let fallback = "";
      const maxOut = 600;

      if (c.type === "session_prep_packet") {
        artifactKind = "prep_packet";
        const facts = [
          c.session ? `Session: ${c.session.title} (${c.session.serviceType})` : null,
          c.artistName ? `Artist: ${c.artistName}${c.artistGenres?.length ? ` (${c.artistGenres.join(", ")})` : ""}` : null,
          c.songTitle ? `Song: ${c.songTitle}` : null,
          c.roomName ? `Room: ${c.roomName}` : null,
          c.engineerName ? `Engineer: ${c.engineerName}` : null,
          c.gear?.length ? `Installed gear: ${c.gear.join(", ")}` : null,
          c.session?.notes ? `Notes: ${c.session.notes}` : null,
        ]
          .filter(Boolean)
          .join("\n");
        prompt = `You are the session prep AI for ${c.orgName}. Write a tight, scannable engineer prep brief (markdown headings + bullets): who the artist is, what they're working on, what to set up, anything to remember. Under 180 words.

FACTS:
${facts}`;
        system = "You write crisp engineer-facing prep packets for a recording studio. Markdown only. No fluff.";
        summary = `Engineer brief for ${c.artistName ?? "the artist"}.`;
        fallback = `# Prep packet - ${c.session?.title ?? c.title}

**Artist:** ${c.artistName ?? "n/a"}
**Room:** ${c.roomName ?? "Unassigned"}
**Engineer:** ${c.engineerName ?? "Unassigned"}

## Setup
- Patch + line check the room
- Confirm the session is loaded
- Stage refreshments`;
      } else if (c.type === "revision_triage") {
        artifactKind = "revision_triage";
        const notes = (c.openNotes ?? [])
          .map((n) => `- [${Math.floor(n.timestampSec / 60)}:${String(Math.floor(n.timestampSec % 60)).padStart(2, "0")}] ${n.body} (${n.authorName})`)
          .join("\n");
        prompt = `You are the studio's revision-triage AI for ${c.orgName}. Cluster these timestamped revision notes on "${c.songTitle ?? "the deliverable"}" into a scoped, ordered task list the engineer can knock out in one mix pass. Group related notes, drop duplicates, flag anything out of scope. Markdown. Under 200 words.

NOTES:
${notes || "(no open notes)"}`;
        system = "You turn scattered revision comments into a tight, scoped task list for a mix engineer. Markdown only.";
        summary = `${(c.openNotes ?? []).length} open notes clustered into a scoped task list.`;
        fallback = `# Revision triage - ${c.songTitle ?? c.title}

${(c.openNotes ?? []).map((n) => `- [${Math.floor(n.timestampSec / 60)}:${String(Math.floor(n.timestampSec % 60)).padStart(2, "0")}] ${n.body}`).join("\n") || "- No open notes."}`;
      } else if (c.type === "chase_split_sheet" || c.type === "complete_rights_metadata") {
        artifactKind = "rights_alert";
        const missing = [
          c.isrc ? null : "ISRC",
          c.iswc ? null : "ISWC",
          c.splitStatus !== "fully_executed" ? "an executed split sheet" : null,
        ]
          .filter(Boolean)
          .join(", ");
        prompt = `You are the rights + metadata AI for ${c.orgName}. "${c.songTitle ?? "This song"}" is at the ${c.stage ?? "release"} stage and is missing: ${missing || "some rights data"}. Write a short internal action note: what's missing, why it blocks release/distribution, and the exact next steps to lock it. Markdown. Under 150 words.`;
        system = "You write concise rights/metadata action notes for a recording studio. Markdown only.";
        summary = `Missing: ${missing || "rights data"}.`;
        title = `Rights alert - ${c.songTitle ?? c.title}`;
        fallback = `# Rights alert - ${c.songTitle ?? c.title}

Missing before release: ${missing || "rights data"}.

## Next steps
- Pull/assign the missing identifiers
- Send the split sheet for signature
- Confirm all contributors are executed before distribution`;
      }

      if (!artifactKind) continue;

      let withinAiCap = true;
      try {
        await ctx.runQuery(internal.usage.checkLimit, {
          orgId: c.orgId,
          metric: "ai_credits",
          add: 1,
        });
      } catch {
        withinAiCap = false;
      }
      const ai = withinAiCap
        ? await complete(prompt, { system, maxOutputTokens: maxOut })
        : null;
      if (ai?.text) {
        await ctx.runMutation(internal.usage.record, {
          orgId: c.orgId,
          metric: "ai_credits",
          amount: 1,
        });
      }
      const body = ai?.text?.trim() || fallback;
      const artifactId = await ctx.runMutation(internal.aiArtifacts.insertInternal, {
        orgId: c.orgId,
        kind: artifactKind,
        title,
        summary,
        body,
        source: ai ? "openai" : "fallback",
        model: ai?.model ?? undefined,
      });
      await ctx.runMutation(internal.opsActions.applyEnrichment, {
        id,
        artifactId,
        model: ai?.model ?? undefined,
      });
      enriched++;
    }
    return { enriched };
  },
});
