import { describe, it, expect } from "vitest";
import {
  leadCandidates,
  prepCandidates,
  recapCandidates,
  revisionTriageCandidates,
  pricingCandidates,
  noShowCandidates,
  weakLeadSourceCandidates,
} from "./generators";
import type { Id } from "../_generated/dataModel";

const NOW = Date.now();
const DAY = 86_400_000;

describe("leadCandidates (Booking Conversion agent)", () => {
  it("maps a fresh lead with an email to a high-priority convert_lead email", () => {
    const out = leadCandidates(
      [{ id: "a1" as Id<"artists">, name: "Nova Reign", email: "nova@x.com", source: "instagram", genres: ["R&B"], createdAt: NOW - DAY }],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("convert_lead");
    expect(out[0].priority).toBe("high");
    expect(out[0].entityId).toBe("a1");
    expect(out[0].payload.kind).toBe("email");
    if (out[0].payload.kind === "email") expect(out[0].payload.body).toContain("Nova");
  });

  it("falls back to note_only without an email and skips stale leads", () => {
    const out = leadCandidates(
      [
        { id: "a2" as Id<"artists">, name: "No Email", genres: [], createdAt: NOW - DAY },
        { id: "a3" as Id<"artists">, name: "Too Old", email: "old@x.com", genres: [], createdAt: NOW - 30 * DAY },
      ],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0].payload.kind).toBe("note_only");
  });
});

describe("prepCandidates (Session Prep agent)", () => {
  it("emits a session_prep_packet note action per upcoming session", () => {
    const out = prepCandidates([
      { id: "s1" as Id<"sessions">, title: "Vocal day", startTime: NOW + DAY, artistName: "Aria", serviceType: "recording", roomName: "A" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("session_prep_packet");
    expect(out[0].entityType).toBe("session");
    expect(out[0].payload.kind).toBe("note_only");
  });
});

describe("recapCandidates (Post-Session Recap agent)", () => {
  it("drafts a recap email when the artist has an email", () => {
    const out = recapCandidates([
      { id: "s2" as Id<"sessions">, title: "Mix review", endTime: NOW - 3600_000, artistName: "Bishop Grey", artistEmail: "b@x.com", songTitle: "Tide" },
    ]);
    expect(out[0].type).toBe("post_session_recap");
    if (out[0].payload.kind === "email") {
      expect(out[0].payload.subject).toContain("Mix review");
      expect(out[0].payload.body).toContain("Tide");
    }
  });
});

describe("revisionTriageCandidates (Revision Triage agent)", () => {
  it("clusters open notes into a single triage action with a count in the title", () => {
    const out = revisionTriageCandidates([
      {
        id: "song1" as Id<"songs">,
        title: "Skyline",
        deliverableId: "d1" as Id<"deliverables">,
        deliverableLabel: "Mix v3",
        openComments: [
          { timestampSec: 12, body: "vocal too hot", authorName: "Lee" },
          { timestampSec: 44, body: "more low end", authorName: "Lee" },
          { timestampSec: 90, body: "fade the outro", authorName: "Ana" },
        ],
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("revision_triage");
    expect(out[0].title).toContain("3 notes");
    expect(out[0].entityId).toBe("song1");
  });
});

describe("Revenue Ops variant generators", () => {
  it("pricingCandidates only fires on hot rooms with a rate", () => {
    const out = pricingCandidates([
      { id: "r1" as Id<"rooms">, name: "Live", hourlyRateCents: 10000, utilizationPct: 92 },
      { id: "r2" as Id<"rooms">, name: "Cold", hourlyRateCents: 10000, utilizationPct: 20 },
      { id: "r3" as Id<"rooms">, name: "Free", hourlyRateCents: 0, utilizationPct: 99 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("pricing_opportunity");
    expect(out[0].entityId).toBe("r1");
  });

  it("noShowCandidates flags flagged artists or unpaid deposits", () => {
    const out = noShowCandidates([
      { id: "s1" as Id<"sessions">, title: "Solid", startTime: NOW + DAY, artistName: "Solid", reliability: "solid", depositPaid: true },
      { id: "s2" as Id<"sessions">, title: "Risk", startTime: NOW + DAY, artistName: "Flaky", artistEmail: "f@x.com", reliability: "flagged", depositPaid: true },
      { id: "s3" as Id<"sessions">, title: "Unpaid", startTime: NOW + DAY, artistName: "Owes", reliability: "solid", depositPaid: false },
    ]);
    expect(out.map((o) => o.entityId).sort()).toEqual(["s2", "s3"]);
    expect(out.every((o) => o.type === "no_show_risk")).toBe(true);
  });

  it("weakLeadSourceCandidates fires only on enough volume and low conversion", () => {
    const out = weakLeadSourceCandidates([
      { source: "instagram", leadCount: 10, bookedCount: 1 }, // 10% -> weak
      { source: "referral", leadCount: 10, bookedCount: 8 }, // strong
      { source: "tiny", leadCount: 2, bookedCount: 0 }, // too small
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("weak_lead_source");
    expect(out[0].entityId).toBe("instagram");
  });
});
