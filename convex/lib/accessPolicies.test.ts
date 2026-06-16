import { describe, it, expect } from "vitest";
import {
  AGENCY_ROLE_CAPABILITIES,
  STUDIO_ROLE_CAPABILITIES,
  GUEST_SCOPE_CAPABILITIES,
  SENSITIVE_CAPABILITIES,
  applyOverrides,
} from "./accessPolicies";

describe("access-policies", () => {
  it("agency owner has full surface", () => {
    expect(AGENCY_ROLE_CAPABILITIES.owner).toContain("agency.subaccount.delete");
    expect(AGENCY_ROLE_CAPABILITIES.owner).toContain("billing.edit");
  });

  it("agency admin cannot delete sub-accounts", () => {
    expect(AGENCY_ROLE_CAPABILITIES.admin).not.toContain("agency.subaccount.delete");
  });

  it("agency admin cannot edit billing", () => {
    expect(AGENCY_ROLE_CAPABILITIES.admin).not.toContain("billing.edit");
  });

  it("agency staff is minimal until scoped", () => {
    expect(AGENCY_ROLE_CAPABILITIES.staff).toContain("act_as_studio");
    expect(AGENCY_ROLE_CAPABILITIES.staff).not.toContain("billing.edit");
  });

  it("agency billing sees money but not sub-accounts", () => {
    expect(AGENCY_ROLE_CAPABILITIES.billing).toContain("billing.edit");
    expect(AGENCY_ROLE_CAPABILITIES.billing).not.toContain("agency.subaccount.create");
  });

  it("studio engineer cannot delete songs", () => {
    expect(STUDIO_ROLE_CAPABILITIES.engineer).not.toContain("songs.delete");
  });

  it("studio engineer cannot refund money", () => {
    expect(STUDIO_ROLE_CAPABILITIES.engineer).not.toContain("finance.refund");
  });

  it("studio intern is read-only across the board", () => {
    for (const cap of STUDIO_ROLE_CAPABILITIES.intern) {
      expect(cap.endsWith(".read") || cap.endsWith(".own")).toBe(true);
    }
  });

  it("assistant engineer cannot approve deliverables", () => {
    expect(STUDIO_ROLE_CAPABILITIES.assistant_engineer).not.toContain("deliverables.approve");
  });

  it("accountant can refund and invoice but not edit songs", () => {
    expect(STUDIO_ROLE_CAPABILITIES.accountant).toContain("finance.refund");
    expect(STUDIO_ROLE_CAPABILITIES.accountant).toContain("invoices.send");
    expect(STUDIO_ROLE_CAPABILITIES.accountant).not.toContain("songs.edit");
  });

  it("artist_relations can edit artists and cancel sessions", () => {
    expect(STUDIO_ROLE_CAPABILITIES.artist_relations).toContain("artists.edit");
    expect(STUDIO_ROLE_CAPABILITIES.artist_relations).toContain("sessions.cancel");
  });

  it("producer can sign split sheets, engineer cannot", () => {
    expect(STUDIO_ROLE_CAPABILITIES.producer).toContain("splitsheet.sign");
    expect(STUDIO_ROLE_CAPABILITIES.engineer).not.toContain("splitsheet.sign");
  });

  // Financial + exec visibility is leadership-only: owner / manager / accountant.
  it("financial + exec data is leadership-only", () => {
    // Only owner, manager, accountant may read invoices (the money).
    for (const role of ["engineer", "assistant_engineer", "artist_relations", "producer", "intern"] as const) {
      expect(STUDIO_ROLE_CAPABILITIES[role]).not.toContain("invoices.read");
      expect(STUDIO_ROLE_CAPABILITIES[role]).not.toContain("finance.refund");
    }
    for (const role of ["owner", "manager", "accountant"] as const) {
      expect(STUDIO_ROLE_CAPABILITIES[role]).toContain("invoices.read");
    }
    // Exec analytics (Reports / insights) follow the same leadership rule.
    expect(STUDIO_ROLE_CAPABILITIES.engineer).not.toContain("insights.read");
    expect(STUDIO_ROLE_CAPABILITIES.artist_relations).not.toContain("insights.read");
    for (const role of ["owner", "manager", "accountant"] as const) {
      expect(STUDIO_ROLE_CAPABILITIES[role]).toContain("insights.read");
    }
  });

  // Inviting / removing teammates is locked to owner + manager (remove = owner only).
  it("only owner and manager can invite teammates", () => {
    expect(STUDIO_ROLE_CAPABILITIES.owner).toContain("members.invite");
    expect(STUDIO_ROLE_CAPABILITIES.manager).toContain("members.invite");
    for (const role of ["engineer", "assistant_engineer", "artist_relations", "producer", "intern", "accountant"] as const) {
      expect(STUDIO_ROLE_CAPABILITIES[role]).not.toContain("members.invite");
    }
    expect(STUDIO_ROLE_CAPABILITIES.owner).toContain("members.remove");
    expect(STUDIO_ROLE_CAPABILITIES.manager).not.toContain("members.remove");
  });

  it("guest session scope is read-only", () => {
    for (const cap of GUEST_SCOPE_CAPABILITIES.session) {
      expect(cap.endsWith(".read")).toBe(true);
    }
  });

  it("guest artist_portal scope can approve deliverables", () => {
    expect(GUEST_SCOPE_CAPABILITIES.artist_portal).toContain("deliverables.approve");
  });

  it("guest splitsheet scope can sign", () => {
    expect(GUEST_SCOPE_CAPABILITIES.splitsheet).toContain("splitsheet.sign");
  });

  it("sensitive set contains money + member + grant actions", () => {
    expect(SENSITIVE_CAPABILITIES.has("finance.refund")).toBe(true);
    expect(SENSITIVE_CAPABILITIES.has("members.remove")).toBe(true);
    expect(SENSITIVE_CAPABILITIES.has("grants.issue")).toBe(true);
    expect(SENSITIVE_CAPABILITIES.has("songs.read")).toBe(false);
  });

  describe("applyOverrides", () => {
    it("adds with +cap", () => {
      const result = applyOverrides(["songs.read"], ["+finance.read"]);
      expect(result.has("finance.read")).toBe(true);
      expect(result.has("songs.read")).toBe(true);
    });

    it("removes with -cap", () => {
      const result = applyOverrides(["songs.read", "songs.edit"], ["-songs.edit"]);
      expect(result.has("songs.edit")).toBe(false);
      expect(result.has("songs.read")).toBe(true);
    });

    it("ignores malformed tokens", () => {
      const result = applyOverrides(["songs.read"], ["bogus", "+ok"]);
      expect(result.has("ok")).toBe(true);
      expect(result.has("bogus")).toBe(false);
    });

    it("handles undefined overrides", () => {
      const result = applyOverrides(["songs.read"], undefined);
      expect(result.size).toBe(1);
    });
  });
});
