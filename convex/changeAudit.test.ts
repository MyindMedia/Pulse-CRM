/* The change log records people, hides money, and is for owners and managers. */
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { AUDITED_TABLES, UNAUDITED_TABLES, auditEntry, isSecretField } from "./lib/changeAudit";

async function studio() {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: "pulse-demo", name: "Demo", slug: "demo", tier: "growth", status: "active",
    });
    for (const [name, role, subject] of [
      ["Olu", "owner", "user_owner"],
      ["Mo", "manager", "user_manager"],
      ["Ellis", "engineer", "user_engineer"],
    ] as const) {
      await ctx.db.insert("members", {
        orgId: "pulse-demo", name, role, email: `${subject}@demo.com`, skills: [], clerkUserId: subject,
      });
    }
  });
  return {
    t,
    owner: t.withIdentity({ subject: "user_owner", name: "Olu" }),
    manager: t.withIdentity({ subject: "user_manager", name: "Mo" }),
    engineer: t.withIdentity({ subject: "user_engineer", name: "Ellis" }),
  };
}

describe("the change log", () => {
  it("records who changed what, with the fields and their values", async () => {
    const { owner } = await studio();
    const roomId = await owner.mutation(api.rooms.create, { name: "Studio A", hourlyRateCents: 7500 });
    await owner.mutation(api.rooms.update, { id: roomId, name: "Live Room" });

    const log = await owner.query(api.changeAudit.list, {});
    const renamed = log.find((e) => e.op === "update" && e.tableName === "rooms");
    expect(renamed?.actorName).toBe("Olu");
    expect(renamed?.fields).toEqual(["name"]);
    expect(renamed?.before).toEqual({ name: "Studio A" });
    expect(renamed?.after).toEqual({ name: "Live Room" });
    expect(renamed?.area).toBe("bookings");
    expect(log.some((e) => e.op === "insert" && e.tableName === "rooms")).toBe(true);
  });

  it("records an engineer's booking under their name", async () => {
    const { owner, engineer } = await studio();
    const roomId = await owner.mutation(api.rooms.create, { name: "Studio A", hourlyRateCents: 7500 });
    const start = Date.now() + 86_400_000;
    await engineer.mutation(api.sessions.create, {
      title: "Tracking", clientName: "Ye West", serviceType: "recording", roomId,
      startTime: start, endTime: start + 3_600_000,
    });
    const log = await owner.query(api.changeAudit.list, { area: "bookings" });
    expect(log.some((e) => e.tableName === "sessions" && e.actorName === "Ellis")).toBe(true);
  });

  it("is for owners and managers only", async () => {
    const { engineer, manager } = await studio();
    await expect(engineer.query(api.changeAudit.list, {})).rejects.toThrow();
    await expect(manager.query(api.changeAudit.list, {})).resolves.toBeDefined();
  });

  it("shows a manager without money that a rate changed, never the figures", async () => {
    const { owner, manager } = await studio();
    const roomId = await owner.mutation(api.rooms.create, { name: "Studio A", hourlyRateCents: 7500 });
    await owner.mutation(api.orgs.setManagersSeeMoney, { enabled: false });
    await owner.mutation(api.rooms.update, { id: roomId, hourlyRateCents: 9000 });

    const forManager = await manager.query(api.changeAudit.list, { area: "bookings" });
    const rate = forManager.find((e) => e.fields.includes("hourlyRateCents"));
    expect(rate?.actorName).toBe("Olu");
    expect(rate?.before).toBeNull();
    expect(rate?.after).toBeNull();

    const forOwner = await owner.query(api.changeAudit.list, { area: "bookings" });
    const same = forOwner.find((e) => e.fields.includes("hourlyRateCents"));
    expect(same?.after).toEqual({ hourlyRateCents: 9000 });
  });

  it("does not record the studio's own automation", async () => {
    const { t } = await studio();
    await t.mutation(api.rooms.create, { name: "Seeded" }).catch(() => undefined);
    const rows = await t.run(async (ctx) => ctx.db.query("changeAudit").collect());
    expect(rows.every((r) => r.actorClerkUserId)).toBe(true);
  });

  it("covers every table a person works in, including the newest features", async () => {
    for (const table of [
      "equipment", "gearCheckouts", "sessionNotes", "sessionSongs", "mediaAssets",
      "featureRequests", "featureRequestVotes", "googleEvents", "orgs", "invites",
    ]) {
      expect(AUDITED_TABLES).toContain(table);
    }
    // Every table is either recorded or named as machinery on purpose.
    for (const table of Object.keys(schema.tables)) {
      expect(AUDITED_TABLES.includes(table) || UNAUDITED_TABLES.has(table)).toBe(true);
    }
  });

  it("records who handed gear to whom, by name", async () => {
    const { t, owner } = await studio();
    const ellis = await t.run(async (ctx) =>
      (await ctx.db.query("members").collect()).find((m) => m.name === "Ellis")!._id,
    );
    const mic = await owner.mutation(api.equipment.create, {
      name: "U87", category: "mic", purchaseCents: 0, currentValueCents: 0,
    });
    await owner.mutation(api.equipment.update, { id: mic, ownerMemberId: ellis });

    const log = await owner.query(api.changeAudit.list, { area: "inventory" });
    const handed = log.find((e) => e.op === "update" && e.fields.includes("ownerMemberId"));
    expect(handed?.actorName).toBe("Olu");
    expect(handed?.label).toBe("U87");
    expect(handed?.after).toEqual({ ownerMemberId: "Ellis" });
  });

  it("records a session note under the person who wrote it", async () => {
    const { owner, engineer } = await studio();
    const roomId = await owner.mutation(api.rooms.create, { name: "Studio A", hourlyRateCents: 7500 });
    const start = Date.now() + 86_400_000;
    const { sessionId } = await owner.mutation(api.sessions.create, {
      title: "Tracking", clientName: "Ye West", serviceType: "recording", roomId,
      startTime: start, endTime: start + 3_600_000,
    });
    await engineer.mutation(api.sessionNotes.add, { sessionId, body: "Bring the Juno" });
    const log = await owner.query(api.changeAudit.list, { area: "sessionNotes" });
    expect(log.some((e) => e.tableName === "sessionNotes" && e.op === "insert" && e.actorName === "Ellis")).toBe(true);
  });

  it("files a feature request under the studio that asked", async () => {
    const { owner } = await studio();
    const entry = await owner.run((ctx) =>
      auditEntry({ ...ctx, innerDb: ctx.db } as never, "featureRequests", {
        id: "fr1", operation: "update",
        oldDoc: { requesterOrgId: "pulse-demo", title: "CSV export", status: "pending" },
        newDoc: { requesterOrgId: "pulse-demo", title: "CSV export", status: "in_the_works" },
      }),
    );
    expect(entry?.orgId).toBe("pulse-demo");
    expect(entry?.after).toEqual({ status: "in_the_works" });
  });

  it("says a token changed, never what it is", async () => {
    const { owner } = await studio();
    const entry = await owner.run((ctx) =>
      auditEntry({ ...ctx, innerDb: ctx.db } as never, "orgs", {
        id: "o1", operation: "update",
        oldDoc: { orgId: "pulse-demo", googleRefreshToken: "1//old", name: "Demo" },
        newDoc: { orgId: "pulse-demo", googleRefreshToken: "1//new-secret", name: "Demo Studio" },
      }),
    );
    expect(entry?.fields).toEqual(["googleRefreshToken", "name"]);
    expect(entry?.before).toEqual({ name: "Demo" });
    expect(entry?.after).toEqual({ name: "Demo Studio" });
    expect(JSON.stringify(entry)).not.toContain("secret");
    for (const field of ["refreshToken", "tokenCiphertext", "tokenIv", "apiKey", "webhookSecret"]) {
      expect(isSecretField(field)).toBe(true);
    }
    expect(isSecretField("name")).toBe(false);
  });
});
