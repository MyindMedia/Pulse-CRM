/* ============================================================
   What is happening across the studio right now, for the Pulse agent.

   The agent's other context is the business on paper: revenue, invoices,
   leads, gear. This is the business in motion: today's sessions, every
   client conversation (texts, email, portal), who is waiting on a reply,
   the texts Pulse sent the team and what they answered, who is on the
   clock, and changes waiting for a decision. One org only, read inside the
   agent's own internalQuery, so it never crosses a sub-account.

   Message bodies and names are client- or staff-written text: the formatter
   fences all of it as untrusted data before it reaches a model.
   ============================================================ */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { fenceUntrusted } from "./aiGuard";
import { clockTime, localDayKey, whenLabel } from "./tz";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** How much of the recent past the agent reads. A week of conversation is
 *  enough to know what is going on; older threads stay on the client page. */
const MESSAGE_WINDOW = 7 * DAY;
const MESSAGES_MAX = 40;
const BODY_MAX = 240;

const PROMPT_LABEL: Record<Doc<"smsPrompts">["kind"], string> = {
  booking_confirm: "session confirmation (client)",
  rebook_offer: "rebook offer (client)",
  staff_confirm: "shift confirmation (staff)",
  overtime_confirm: "overtime check (staff)",
  intern_checkin: "intern 4-hour check (intern)",
  intern_approval: "intern extension approval (manager)",
  waitlist_claim: "waitlist slot offer (client)",
  cover_offer: "cover offer (engineer)",
  review_rating: "review request (client)",
};

const CHANNEL: Record<Doc<"clientMessages">["channel"], string> = {
  sms: "text",
  google: "email",
  internal: "email",
  portal: "portal",
};

const clip = (s: string) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > BODY_MAX ? `${one.slice(0, BODY_MAX - 3)}...` : one;
};

export type BusinessActivity = Awaited<ReturnType<typeof businessActivity>>;

export async function businessActivity(ctx: QueryCtx, orgId: string, tz: string, now: number) {
  // "Today" is the studio's local day. Read a window wide enough for any
  // timezone, then keep only rows whose local date is today's.
  const dayStart = now - DAY;
  const dayEnd = now + DAY;
  const todayKey = localDayKey(now, tz);
  const isToday = (t: number) => localDayKey(t, tz) === todayKey;

  const names = new Map<string, string>();
  async function artistName(id: Id<"artists">) {
    if (!names.has(id)) {
      const a = await ctx.db.get(id);
      names.set(id, a && a.orgId === orgId && !a.erasedAt ? a.name : "a client");
    }
    return names.get(id)!;
  }
  async function memberName(id: Id<"members">) {
    if (!names.has(id)) {
      const m = await ctx.db.get(id);
      names.set(id, m && m.orgId === orgId ? m.name : "a team member");
    }
    return names.get(id)!;
  }
  const membersByClerk = new Map(
    (await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect())
      .filter((m) => m.clerkUserId)
      .map((m) => [m.clerkUserId!, m.name]),
  );

  // Today's sessions, in order.
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", dayStart).lt("startTime", dayEnd))
    .take(80);
  const today = [];
  for (const s of sessions) {
    if (!isToday(s.startTime)) continue;
    const room = s.roomId ? await ctx.db.get(s.roomId) : null;
    today.push({
      startTime: s.startTime,
      endTime: s.endTime,
      title: s.title,
      client: await artistName(s.artistId),
      room: room?.name ?? null,
      engineer: s.engineerId ? await memberName(s.engineerId) : null,
      status: s.status,
    });
  }

  // Client conversations: the last week, newest first.
  const recent = (
    await ctx.db.query("clientMessages").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(400)
  ).filter((m) => m._creationTime >= now - MESSAGE_WINDOW);
  const latestByClient = new Map<Id<"artists">, Doc<"clientMessages">>();
  for (const m of recent) if (!latestByClient.has(m.artistId)) latestByClient.set(m.artistId, m);
  const waiting = [];
  for (const m of latestByClient.values()) {
    if (m.direction === "in" && !m.handledAt) {
      waiting.push({ client: await artistName(m.artistId), at: m._creationTime, channel: CHANNEL[m.channel], body: clip(m.body) });
    }
  }
  const messages = [];
  for (const m of recent.slice(0, MESSAGES_MAX)) {
    const by = m.sentBy;
    const author =
      m.direction === "in"
        ? "client"
        : !by || by === "Autopilot"
          ? "automatic"
          : by.startsWith("receptionist")
            ? "Pulse agent"
            : (membersByClerk.get(by) ?? "the studio");
    messages.push({
      at: m._creationTime,
      client: await artistName(m.artistId),
      direction: m.direction,
      channel: CHANNEL[m.channel],
      author,
      status: m.status,
      body: clip(m.body),
    });
  }

  // Texts Pulse sent with a YES/NO question: open ones, and answers from the last day.
  const prompts = await ctx.db
    .query("smsPrompts")
    .withIndex("by_org_sent", (q) => q.eq("orgId", orgId).gte("sentAt", now - 3 * DAY))
    .order("desc")
    .take(60);
  const staffTexts = [];
  for (const p of prompts) {
    if (p.status === "expired" && p.expiresAt < now - DAY) continue;
    if (p.status === "answered" && (p.answeredAt ?? 0) < now - DAY) continue;
    const about = p.memberId ? await memberName(p.memberId) : p.artistId ? await artistName(p.artistId) : null;
    staffTexts.push({ kind: PROMPT_LABEL[p.kind], about, status: p.status, answer: p.answer ?? null, sentAt: p.sentAt });
    if (staffTexts.length >= 20) break;
  }

  // The team: who is on the clock and who is scheduled today.
  const active = await ctx.db.query("timeEntries").withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "active")).collect();
  const clockedIn = [];
  for (const e of active) clockedIn.push({ name: await memberName(e.memberId), since: e.clockInAt });
  const shiftRows = await ctx.db
    .query("shifts")
    .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", dayStart).lt("startTime", dayEnd))
    .take(80);
  const shifts = [];
  for (const sh of shiftRows) {
    if (sh.status === "cancelled" || !isToday(sh.startTime)) continue;
    shifts.push({ name: await memberName(sh.memberId), startTime: sh.startTime, endTime: sh.endTime, status: sh.status });
  }

  const pendingChanges = (
    await ctx.db.query("sessionChangeRequests").withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "pending")).take(50)
  ).length;

  return {
    today,
    waiting,
    messages,
    messagesThisWeek: {
      inbound: recent.filter((m) => m.direction === "in").length,
      outbound: recent.filter((m) => m.direction === "out").length,
    },
    staffTexts,
    clockedIn,
    shifts,
    pendingChanges,
  };
}

/** The activity as prompt text, fenced: every line carries names or words
 *  that clients and staff wrote. */
export function formatActivity(a: BusinessActivity, tz: string, now: number): string {
  const ago = (t: number) => {
    const h = Math.round((now - t) / HOUR);
    return h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  };
  const lines: string[] = [];

  lines.push(a.today.length ? `Today's sessions (${a.today.length}):` : "Today's sessions: none booked.");
  for (const s of a.today) {
    lines.push(`- ${clockTime(s.startTime, tz)}-${clockTime(s.endTime, tz)} ${s.title} | client ${s.client}${s.room ? ` | ${s.room}` : ""}${s.engineer ? ` | engineer ${s.engineer}` : " | no engineer"} | ${s.status}`);
  }

  lines.push(
    `Client messages this week: ${a.messagesThisWeek.inbound} in, ${a.messagesThisWeek.outbound} out. ` +
      (a.waiting.length ? `${a.waiting.length} client(s) waiting on a reply:` : "Nobody is waiting on a reply."),
  );
  for (const w of a.waiting) lines.push(`- ${w.client} (${w.channel}, ${ago(w.at)}): "${w.body}"`);

  if (a.messages.length) {
    lines.push("Recent conversation log (newest first):");
    for (const m of a.messages) {
      const who = m.direction === "in" ? `${m.client} wrote` : `${m.author} to ${m.client}`;
      lines.push(`- ${whenLabel(m.at, tz)} ${who} by ${m.channel}${m.status === "failed" ? " (FAILED to send)" : ""}: "${m.body}"`);
    }
  }

  if (a.staffTexts.length) {
    lines.push("Texts Pulse sent asking for a reply (last 3 days):");
    for (const p of a.staffTexts) {
      const state = p.status === "answered" ? `answered ${p.answer ?? ""}`.trim() : p.status === "open" ? "no answer yet" : "expired unanswered";
      lines.push(`- ${p.kind}${p.about ? ` about ${p.about}` : ""}, sent ${ago(p.sentAt)}: ${state}`);
    }
  }

  lines.push(a.clockedIn.length ? `On the clock now: ${a.clockedIn.map((c) => `${c.name} (since ${clockTime(c.since, tz)})`).join(", ")}.` : "Nobody is on the clock right now.");
  if (a.shifts.length) {
    lines.push(`Shifts today: ${a.shifts.map((s) => `${s.name} ${clockTime(s.startTime, tz)}-${clockTime(s.endTime, tz)} (${s.status})`).join("; ")}.`);
  }
  if (a.pendingChanges) lines.push(`Session changes waiting for a decision: ${a.pendingChanges}.`);

  return fenceUntrusted("STUDIO ACTIVITY (sessions, messages, texts, team)", lines.join("\n"));
}
