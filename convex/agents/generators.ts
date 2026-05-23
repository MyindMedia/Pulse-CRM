/* ============================================================
   Named AI agents - pure candidate generators.

   Each function here is the deterministic rule layer for one of the
   four new named agents (Booking Conversion, Session Prep,
   Post-Session Recap, Revision Triage) plus the Revenue Ops variants
   (pricing opportunity, no-show risk, weak lead source).

   They take plain data (the agent signals gathered by opsBrain) and
   return ProposedAction rows. Keeping them pure + V8-safe means they
   stay unit-testable and run inside the same per-org scan mutation.
   The OpenAI enrichment in aiActions.ts rewrites the draft bodies
   later; these fallbacks are the product's safety floor.
   ============================================================ */
import type { Id } from "../_generated/dataModel";
import type { ProposedAction } from "../opsBrain";

const DAY = 86_400_000;

function firstName(name: string): string {
  return name.split(" ")[0] || name;
}
function fmtCents(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

/* ----------------------------------------------------------------
   Signal shapes - plain data the generators reason over.
   ---------------------------------------------------------------- */
export type LeadSignal = {
  id: Id<"artists">;
  name: string;
  email?: string;
  source?: string;
  genres: string[];
  createdAt: number;
};

export type PrepSessionSignal = {
  id: Id<"sessions">;
  title: string;
  startTime: number;
  artistName: string;
  serviceType: string;
  roomName?: string;
  engineerName?: string;
};

export type RecapSessionSignal = {
  id: Id<"sessions">;
  title: string;
  endTime: number;
  artistName: string;
  artistEmail?: string;
  songTitle?: string;
};

export type RevisionTriageSignal = {
  id: Id<"songs">;
  title: string;
  deliverableId: Id<"deliverables">;
  deliverableLabel: string;
  openComments: { timestampSec: number; body: string; authorName: string }[];
};

export type PricingOppSignal = {
  id: Id<"rooms">;
  name: string;
  hourlyRateCents: number;
  utilizationPct: number; // 0-100 over the recent window
};

export type NoShowRiskSignal = {
  id: Id<"sessions">;
  title: string;
  startTime: number;
  artistName: string;
  artistEmail?: string;
  reliability: string; // "solid" | "watch" | "flagged"
  depositPaid: boolean;
};

export type WeakLeadSourceSignal = {
  source: string;
  leadCount: number;
  bookedCount: number;
};

const NEW_LEAD_WINDOW = 14 * DAY;
const PRICING_HOT_UTIL = 85; // rooms this hot can take a rate bump

/* ----------------------------------------------------------------
   Booking Conversion -> convert_lead
   ---------------------------------------------------------------- */
export function leadCandidates(leads: LeadSignal[], now: number): ProposedAction[] {
  return leads
    .filter((l) => now - l.createdAt <= NEW_LEAD_WINDOW)
    .map((l) => {
      const genreLine = l.genres.length ? ` We work with a lot of ${l.genres[0]} artists and would love to dig into your sound.` : "";
      return {
        type: "convert_lead",
        priority: "high",
        title: `Convert lead - ${l.name}`,
        rationale: `New ${l.source ? `${l.source} ` : ""}lead with no booking yet. A fast, warm reply with concrete times + a deposit ask converts best.`,
        entityType: "artist",
        entityId: l.id,
        payload: l.email
          ? {
              kind: "email",
              to: l.email,
              subject: "Let's get you on the books",
              body: `Hi ${firstName(l.name)}, thanks for reaching out!${genreLine} I have a couple of openings this week - would Tuesday afternoon or Thursday evening work for a first session? We hold the slot with a deposit, then the balance is due on the day. Reply with what suits you and I will lock it in.`,
              notifyKind: "lead.convert",
            }
          : { kind: "note_only" },
      } satisfies ProposedAction;
    });
}

/* ----------------------------------------------------------------
   Session Prep -> session_prep_packet (rich body in aiArtifacts)
   ---------------------------------------------------------------- */
export function prepCandidates(sessions: PrepSessionSignal[]): ProposedAction[] {
  return sessions.map((s) => ({
    type: "session_prep_packet",
    priority: "medium",
    title: `Prep packet - ${s.title}`,
    rationale: `${s.artistName}'s ${s.serviceType} session is coming up. Draft an engineer prep packet so the room is ready before they walk in.`,
    entityType: "session",
    entityId: s.id,
    payload: { kind: "note_only" },
  }));
}

/* ----------------------------------------------------------------
   Post-Session Recap -> post_session_recap (rich body in aiArtifacts)
   ---------------------------------------------------------------- */
export function recapCandidates(sessions: RecapSessionSignal[]): ProposedAction[] {
  return sessions.map((s) => ({
    type: "post_session_recap",
    priority: "medium",
    title: `Recap + next step - ${s.title}`,
    rationale: `${s.artistName}'s session just wrapped. Send a warm recap and propose the next stage while it is fresh.`,
    entityType: "session",
    entityId: s.id,
    payload: s.artistEmail
      ? {
          kind: "email",
          to: s.artistEmail,
          subject: `Recap: ${s.title}`,
          body: `Hi ${firstName(s.artistName)}, great session today${s.songTitle ? ` on "${s.songTitle}"` : ""}. Everything is saved and backed up. When you are ready, let me know if you want to slot in the next stage - happy to hold a date.`,
          notifyKind: "session.recap",
        }
      : { kind: "note_only" },
  }));
}

/* ----------------------------------------------------------------
   Revision Triage -> revision_triage (clustered task summary in aiArtifacts)
   ---------------------------------------------------------------- */
export function revisionTriageCandidates(items: RevisionTriageSignal[]): ProposedAction[] {
  return items.map((it) => ({
    type: "revision_triage",
    priority: "medium",
    title: `Triage ${it.openComments.length} notes - ${it.title}`,
    rationale: `"${it.deliverableLabel}" has ${it.openComments.length} open timestamped notes. Cluster them into a scoped task list before the next mix pass.`,
    entityType: "song",
    entityId: it.id,
    payload: { kind: "note_only" },
  }));
}

/* ----------------------------------------------------------------
   Revenue Ops: pricing_opportunity
   ---------------------------------------------------------------- */
export function pricingCandidates(rooms: PricingOppSignal[]): ProposedAction[] {
  return rooms
    .filter((r) => r.utilizationPct >= PRICING_HOT_UTIL && r.hourlyRateCents > 0)
    .map((r) => ({
      type: "pricing_opportunity",
      priority: "low",
      title: `Raise ${r.name} rate`,
      rationale: `${r.name} is running at ${r.utilizationPct}% utilization at ${fmtCents(r.hourlyRateCents)}/hr. Demand supports a 10-15% rate bump on peak windows.`,
      entityType: "room",
      entityId: r.id,
      payload: { kind: "note_only" },
    }));
}

/* ----------------------------------------------------------------
   Revenue Ops: no_show_risk
   ---------------------------------------------------------------- */
export function noShowCandidates(sessions: NoShowRiskSignal[]): ProposedAction[] {
  return sessions
    .filter((s) => s.reliability !== "solid" || !s.depositPaid)
    .map((s) => ({
      type: "no_show_risk",
      priority: "high",
      title: `No-show risk - ${s.title}`,
      rationale: `${s.artistName} is ${s.reliability}${s.depositPaid ? "" : " and the deposit is unpaid"}. Send a confirm-or-release nudge to protect the slot.`,
      entityType: "session",
      entityId: s.id,
      payload: s.artistEmail
        ? {
            kind: "email",
            to: s.artistEmail,
            subject: `Confirming ${s.title}`,
            body: `Hi ${firstName(s.artistName)}, just confirming your upcoming session. Can you reply YES to lock it in? ${s.depositPaid ? "" : "If the deposit is still open, settling it now secures the room. "}We release unconfirmed holds 12 hours out.`,
            notifyKind: "session.confirm",
          }
        : { kind: "note_only" },
    }));
}

/* ----------------------------------------------------------------
   Revenue Ops: weak_lead_source
   ---------------------------------------------------------------- */
export function weakLeadSourceCandidates(sources: WeakLeadSourceSignal[]): ProposedAction[] {
  return sources
    .filter((s) => s.leadCount >= 5 && s.bookedCount / s.leadCount < 0.2)
    .map((s) => {
      const pct = Math.round((s.bookedCount / s.leadCount) * 100);
      return {
        type: "weak_lead_source",
        priority: "low",
        title: `Weak source - ${s.source}`,
        rationale: `${s.source} sent ${s.leadCount} leads but only ${s.bookedCount} booked (${pct}%). Tighten qualification or cut spend here.`,
        entityType: "lead_source",
        entityId: s.source,
        payload: { kind: "note_only" },
      } satisfies ProposedAction;
    });
}
