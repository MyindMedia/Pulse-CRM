import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { CAPABILITY_TIER, ALL_FEATURES, TIERS, tierRank, type TierKey } from "./lib/pricing";
import { hasCapability, entitlementForCapability } from "./lib/entitlements";
import { STUDIO_ROLE_CAPABILITIES } from "./lib/accessPolicies";
import { PROJECT_STAGES } from "./projectsTables";

/* ============================================================
   Post-production project tracking: tier gate, studio isolation,
   stage moves, task CRUD, the Today card, the group view, and the
   reminder sweep. Real access engine, real schema (convex-test).
   ============================================================ */

const UPGRADE = { data: { code: "UPGRADE_REQUIRED" } };
const NOT_FOUND = { data: { code: "NOT_FOUND" } };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 7, 15, 0, 0);

type T = ReturnType<typeof convexTest>;

async function studio(t: T, orgId: string, tier: TierKey, extra: Record<string, unknown> = {}) {
  const user = `u_${orgId}`;
  const memberId = await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, tier, status: "active", ...extra });
    return ctx.db.insert("members", {
      orgId, name: `Owner ${orgId}`, role: "owner", skills: [], clerkUserId: user, email: `${orgId}@x.com`,
    });
  });
  return { as: t.withIdentity({ subject: user, name: "Owner", orgId }), orgId, memberId };
}

async function seedSong(t: T, orgId: string, stage: "demo" | "tracking" | "released" = "demo") {
  return t.run(async (ctx) => {
    const artistId = await ctx.db.insert("artists", {
      orgId, name: "Client One", type: "artist", genres: [], tags: [], status: "active",
      lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    const songId = await ctx.db.insert("songs", {
      orgId, title: "Night Drive", artistId, kind: "single", stage, moodTags: [],
      referenceTracks: [], revisionsIncluded: 3, revisionsUsed: 0,
    });
    return { artistId, songId };
  });
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

async function settle(t: T) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("config: the tier gate matches the plan config", () => {
  it("post-production tracking is Growth, the cross-studio view is Max", () => {
    const own = ALL_FEATURES.find((f) => f.name === "Post-production project tracking")!;
    const cross = ALL_FEATURES.find((f) => f.name === "Projects across every studio")!;
    expect(own).toMatchObject({ tier: "growth", gate: "projects" });
    expect(cross).toMatchObject({ tier: "max", gate: "crossStudioProjects" });
    expect(CAPABILITY_TIER.projects).toBe("growth");
    expect(CAPABILITY_TIER.crossStudioProjects).toBe("max");
  });

  it("each gate is present at its tier and absent one tier down", () => {
    for (const key of ["projects", "crossStudioProjects"] as const) {
      const tier = CAPABILITY_TIER[key];
      expect(hasCapability(tier, key)).toBe(true);
      const below = TIERS[tierRank(tier) - 1];
      if (below) expect(hasCapability(below, key)).toBe(false);
    }
  });

  it("the permissions map to the entitlement, and every studio role can at least read", () => {
    expect(entitlementForCapability("projects.read")).toBe("projects");
    expect(entitlementForCapability("projects.edit")).toBe("projects");
    for (const caps of Object.values(STUDIO_ROLE_CAPABILITIES)) {
      expect(caps).toContain("projects.read");
    }
  });
});

describe("tier gate through the access engine", () => {
  it("Core is refused on every read and write; Growth and Max are allowed", async () => {
    const t = convexTest(schema);
    const core = await studio(t, "o_core", "core");
    const growth = await studio(t, "o_growth", "growth");
    const max = await studio(t, "o_max", "max");

    await expect(core.as.query(api.projects.board, {})).rejects.toMatchObject(UPGRADE);
    await expect(core.as.mutation(api.projects.create, { name: "EP mix" })).rejects.toMatchObject(UPGRADE);
    await expect(growth.as.mutation(api.projects.create, { name: "EP mix" })).resolves.toBeTruthy();
    await expect(max.as.mutation(api.projects.create, { name: "EP mix" })).resolves.toBeTruthy();
    const board = await growth.as.query(api.projects.board, {});
    expect(board.projects).toHaveLength(1);
  });

  it("an intern can read but not write", async () => {
    const t = convexTest(schema);
    await studio(t, "o_g", "growth");
    await t.run((ctx) =>
      ctx.db.insert("members", { orgId: "o_g", name: "Intern", role: "intern", skills: [], clerkUserId: "u_intern" }),
    );
    const intern = t.withIdentity({ subject: "u_intern", orgId: "o_g" });
    await expect(intern.query(api.projects.board, {})).resolves.toBeTruthy();
    await expect(intern.mutation(api.projects.create, { name: "x" })).rejects.toMatchObject({
      data: { code: "CAPABILITY_DENIED" },
    });
  });

  it("the Today card degrades to disabled instead of throwing on Core", async () => {
    const t = convexTest(schema);
    const core = await studio(t, "o_core", "core");
    const res = await core.as.query(api.projects.todayCards, {});
    expect(res).toMatchObject({ enabled: false, projects: [] });
  });
});

describe("studio isolation", () => {
  async function two() {
    const t = convexTest(schema);
    const a = await studio(t, "o_a", "growth");
    const b = await studio(t, "o_b", "growth");
    const bProject = await b.as.mutation(api.projects.create, { name: "B secret record" });
    const bTask = await b.as.mutation(api.projects.addTask, { projectId: bProject, title: "B task" });
    const bSong = await seedSong(t, "o_b");
    return { t, a, b, bProject, bTask, bSong };
  }

  it("A never sees B's projects on the board, the card, or by id", async () => {
    const { a, bProject } = await two();
    await a.as.mutation(api.projects.create, { name: "A record" });
    const board = await a.as.query(api.projects.board, {});
    expect(board.projects.map((p) => p.name)).toEqual(["A record"]);
    expect(await a.as.query(api.projects.get, { id: bProject })).toBeNull();
    const today = await a.as.query(api.projects.todayCards, {});
    expect(today.projects.map((p) => p.name)).toEqual(["A record"]);
  });

  it("A cannot write to B's project, tasks or links", async () => {
    const { a, bProject, bTask, bSong } = await two();
    await expect(a.as.mutation(api.projects.update, { id: bProject, name: "pwned" })).rejects.toMatchObject(NOT_FOUND);
    await expect(a.as.mutation(api.projects.setStage, { id: bProject, stage: "mixing" })).rejects.toMatchObject(NOT_FOUND);
    await expect(a.as.mutation(api.projects.archive, { id: bProject })).rejects.toMatchObject(NOT_FOUND);
    await expect(a.as.mutation(api.projects.remove, { id: bProject })).rejects.toMatchObject(NOT_FOUND);
    await expect(a.as.mutation(api.projects.addTask, { projectId: bProject, title: "x" })).rejects.toMatchObject(NOT_FOUND);
    await expect(a.as.mutation(api.projects.setTaskDone, { id: bTask, done: true })).rejects.toMatchObject(NOT_FOUND);
    await expect(a.as.mutation(api.projects.removeTask, { id: bTask })).rejects.toMatchObject(NOT_FOUND);
    await expect(
      a.as.mutation(api.projects.addLink, { projectId: bProject, kind: "song", refId: bSong.songId }),
    ).rejects.toMatchObject(NOT_FOUND);
  });

  it("A cannot attach B's song, teammate or other rows to A's own project", async () => {
    const { t, a, b, bSong } = await two();
    const mine = await a.as.mutation(api.projects.create, { name: "Mine" });
    await expect(
      a.as.mutation(api.projects.update, { id: mine, songId: bSong.songId }),
    ).rejects.toMatchObject(NOT_FOUND);
    await expect(
      a.as.mutation(api.projects.update, { id: mine, ownerMemberId: b.memberId }),
    ).rejects.toMatchObject(NOT_FOUND);
    await expect(
      a.as.mutation(api.projects.addLink, { projectId: mine, kind: "song", refId: bSong.songId }),
    ).rejects.toMatchObject(NOT_FOUND);
    await expect(
      a.as.mutation(api.projects.addLink, { projectId: mine, kind: "artist", refId: bSong.artistId }),
    ).rejects.toMatchObject(NOT_FOUND);
    // The right id in the wrong table is also a miss.
    await expect(
      a.as.mutation(api.projects.addLink, { projectId: mine, kind: "room", refId: bSong.songId }),
    ).rejects.toMatchObject(NOT_FOUND);
    const links = await t.run((ctx) => ctx.db.query("projectLinks").collect());
    expect(links.filter((l) => l.orgId === "o_a")).toHaveLength(0);
  });

  it("a project's links are all inside its own studio", async () => {
    const t = convexTest(schema);
    const a = await studio(t, "o_a", "growth");
    const { songId, artistId } = await seedSong(t, "o_a");
    const roomId = await t.run((ctx) => ctx.db.insert("rooms", { orgId: "o_a", name: "Live Room", status: "available" }));
    const id = await a.as.mutation(api.projects.create, {
      name: "Album", songId,
      links: [
        { kind: "room", refId: roomId },
        { kind: "artist", refId: artistId },
        { kind: "engineer", refId: a.memberId },
      ],
    });
    const p = await a.as.query(api.projects.get, { id });
    expect(p!.links.map((l) => l.kind).sort()).toEqual(["artist", "engineer", "room", "song"]);
    expect(p!.links.find((l) => l.kind === "song")!.label).toBe("Night Drive");
    // Linking the same row twice keeps one link.
    await a.as.mutation(api.projects.addLink, { projectId: id, kind: "room", refId: roomId });
    expect((await a.as.query(api.projects.get, { id }))!.links).toHaveLength(4);
  });

  it("the bill link needs invoices.read", async () => {
    const t = convexTest(schema);
    const a = await studio(t, "o_a", "growth");
    await t.run((ctx) =>
      ctx.db.insert("members", { orgId: "o_a", name: "Eng", role: "engineer", skills: [], clerkUserId: "u_eng" }),
    );
    const eng = t.withIdentity({ subject: "u_eng", orgId: "o_a" });
    const { artistId } = await seedSong(t, "o_a");
    const invoiceId = await t.run((ctx) =>
      ctx.db.insert("invoices", {
        orgId: "o_a", number: "INV-1", artistId, status: "draft", lineItems: [],
        amountCents: 0, dueDate: NOW,
      }),
    );
    const id = await a.as.mutation(api.projects.create, { name: "P" });
    await expect(
      eng.mutation(api.projects.addLink, { projectId: id, kind: "invoice", refId: invoiceId }),
    ).rejects.toMatchObject({ data: { code: "CAPABILITY_DENIED" } });
    await expect(
      a.as.mutation(api.projects.addLink, { projectId: id, kind: "invoice", refId: invoiceId }),
    ).resolves.toBeTruthy();
    const p = await a.as.query(api.projects.get, { id });
    expect(p!.links[0].label).toBe("Invoice INV-1");
  });

  it("create with a bill in links[] needs invoices.read too", async () => {
    const t = convexTest(schema);
    const a = await studio(t, "o_a", "growth");
    await t.run((ctx) =>
      ctx.db.insert("members", { orgId: "o_a", name: "Eng", role: "engineer", skills: [], clerkUserId: "u_eng" }),
    );
    const eng = t.withIdentity({ subject: "u_eng", orgId: "o_a" });
    const { artistId } = await seedSong(t, "o_a");
    const invoiceId = await t.run((ctx) =>
      ctx.db.insert("invoices", {
        orgId: "o_a", number: "INV-2", artistId, status: "draft", lineItems: [],
        amountCents: 0, dueDate: NOW,
      }),
    );
    await expect(
      eng.mutation(api.projects.create, { name: "Sneaky", links: [{ kind: "invoice", refId: invoiceId }] }),
    ).rejects.toMatchObject({ data: { code: "CAPABILITY_DENIED" } });
    expect(await t.run(async (ctx) => (await ctx.db.query("projects").collect()).length)).toBe(0);
    const id = await a.as.mutation(api.projects.create, { name: "P", links: [{ kind: "invoice", refId: invoiceId }] });
    expect((await a.as.query(api.projects.get, { id }))!.links[0].label).toBe("Invoice INV-2");
  });
});

describe("stage transitions", () => {
  it("starts in tracking and walks through every stage in order", async () => {
    const t = convexTest(schema);
    const a = await studio(t, "o_a", "growth");
    const id = await a.as.mutation(api.projects.create, { name: "EP" });
    expect((await a.as.query(api.projects.get, { id }))!.stage).toBe("tracking");
    for (const stage of PROJECT_STAGES.slice(1)) {
      const res = await a.as.mutation(api.projects.setStage, { id, stage });
      expect(res.changed).toBe(true);
      expect((await a.as.query(api.projects.get, { id }))!.stage).toBe(stage);
    }
    await settle(t);
  });

  it("completing stamps completedAt; reopening clears it; the same stage is a no-op", async () => {
    const t = convexTest(schema);
    const a = await studio(t, "o_a", "growth");
    const id = await a.as.mutation(api.projects.create, { name: "EP" });
    await a.as.mutation(api.projects.setStage, { id, stage: "complete" });
    expect((await a.as.query(api.projects.get, { id }))!.completedAt).toBe(NOW);
    expect(await a.as.mutation(api.projects.setStage, { id, stage: "complete" })).toEqual({ changed: false });
    await a.as.mutation(api.projects.setStage, { id, stage: "editing" });
    expect((await a.as.query(api.projects.get, { id }))!.completedAt).toBeUndefined();
    await settle(t);
  });

  it("moves the linked song with it, never a released one", async () => {
    const t = convexTest(schema);
    const a = await studio(t, "o_a", "growth");
    const { songId } = await seedSong(t, "o_a", "demo");
    const id = await a.as.mutation(api.projects.create, { name: "Single", songId });
    await a.as.mutation(api.projects.setStage, { id, stage: "mixing" });
    expect((await t.run((ctx) => ctx.db.get(songId)))!.stage).toBe("mixing");
    await a.as.mutation(api.projects.setStage, { id, stage: "delivery" });
    expect((await t.run((ctx) => ctx.db.get(songId)))!.stage).toBe("delivered");

    const rel = await seedSong(t, "o_a", "released");
    const id2 = await a.as.mutation(api.projects.create, { name: "Reissue", songId: rel.songId });
    await a.as.mutation(api.projects.setStage, { id: id2, stage: "mixing" });
    expect((await t.run((ctx) => ctx.db.get(rel.songId)))!.stage).toBe("released");
    await settle(t);
  });

  it("writes an activity row and a team notification on a stage change", async () => {
    const t = convexTest(schema);
    const a = await studio(t, "o_a", "growth");
    const id = await a.as.mutation(api.projects.create, { name: "EP", ownerMemberId: a.memberId });
    await a.as.mutation(api.projects.setStage, { id, stage: "mastering" });
    const acts = await t.run((ctx) => ctx.db.query("activity").collect());
    expect(acts.map((r) => r.kind)).toEqual(expect.arrayContaining(["project.created", "project.stage"]));
    const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ orgId: "o_a", kind: "project.stage", recipient: "o_a@x.com" });
    await settle(t);
  });
});

describe("task CRUD", () => {
  it("adds, edits, completes, reopens and removes a task", async () => {
    const t = convexTest(schema);
    const a = await studio(t, "o_a", "growth");
    const projectId = await a.as.mutation(api.projects.create, { name: "EP" });
    const t1 = await a.as.mutation(api.projects.addTask, {
      projectId, title: "  Tune vocals ", stage: "editing", ownerMemberId: a.memberId, dueDate: NOW + DAY,
    });
    const t2 = await a.as.mutation(api.projects.addTask, { projectId, title: "Print stems" });
    let p = (await a.as.query(api.projects.get, { id: projectId }))!;
    expect(p.tasks.map((x) => x.title)).toEqual(["Tune vocals", "Print stems"]);
    expect(p.tasks[0]).toMatchObject({ stage: "editing", ownerName: `Owner o_a`, done: false });

    await a.as.mutation(api.projects.updateTask, { id: t1, title: "Tune lead vocal", dueDate: null, stage: null });
    p = (await a.as.query(api.projects.get, { id: projectId }))!;
    expect(p.tasks[0].title).toBe("Tune lead vocal");
    expect(p.tasks[0].dueDate).toBeUndefined();
    expect(p.tasks[0].stage).toBeUndefined();

    await a.as.mutation(api.projects.setTaskDone, { id: t2, done: true });
    p = (await a.as.query(api.projects.get, { id: projectId }))!;
    expect(p.tasks[1]).toMatchObject({ done: true, completedAt: NOW });
    await a.as.mutation(api.projects.setTaskDone, { id: t2, done: false });
    expect((await a.as.query(api.projects.get, { id: projectId }))!.tasks[1].completedAt).toBeUndefined();

    await a.as.mutation(api.projects.removeTask, { id: t1 });
    expect((await a.as.query(api.projects.get, { id: projectId }))!.tasks).toHaveLength(1);
  });

  it("rejects an empty title and a task owner from another studio", async () => {
    const t = convexTest(schema);
    const a = await studio(t, "o_a", "growth");
    const b = await studio(t, "o_b", "growth");
    const projectId = await a.as.mutation(api.projects.create, { name: "EP" });
    await expect(a.as.mutation(api.projects.addTask, { projectId, title: "   " })).rejects.toMatchObject({
      data: { code: "INVALID" },
    });
    await expect(
      a.as.mutation(api.projects.addTask, { projectId, title: "x", ownerMemberId: b.memberId }),
    ).rejects.toMatchObject(NOT_FOUND);
  });

  it("deleting a project removes its tasks and links", async () => {
    const t = convexTest(schema);
    const a = await studio(t, "o_a", "growth");
    const projectId = await a.as.mutation(api.projects.create, { name: "EP", links: [{ kind: "engineer", refId: a.memberId }] });
    await a.as.mutation(api.projects.addTask, { projectId, title: "x" });
    await a.as.mutation(api.projects.remove, { id: projectId });
    expect(await t.run((ctx) => ctx.db.query("projectTasks").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("projectLinks").collect())).toHaveLength(0);
  });
});

describe("board and the Today card", () => {
  it("the board carries task counts and flags overdue work", async () => {
    const t = convexTest(schema);
    const a = await studio(t, "o_a", "growth");
    const late = await a.as.mutation(api.projects.create, { name: "Late", dueDate: NOW - DAY });
    await a.as.mutation(api.projects.addTask, { projectId: late, title: "Bounce", dueDate: NOW - HOUR });
    await a.as.mutation(api.projects.create, { name: "Fine", stage: "mixing", dueDate: NOW + 20 * DAY });
    const board = await a.as.query(api.projects.board, { nowMs: NOW });
    const byName = Object.fromEntries(board.projects.map((p) => [p.name, p]));
    expect(byName.Late).toMatchObject({ overdue: true, openTaskCount: 1, overdueTaskCount: 1 });
    expect(byName.Fine).toMatchObject({ overdue: false, stage: "mixing" });
    expect(board.projects[0].name).toBe("Late");
  });

  it("archived projects leave the board", async () => {
    const t = convexTest(schema);
    const a = await studio(t, "o_a", "growth");
    const id = await a.as.mutation(api.projects.create, { name: "Old" });
    await a.as.mutation(api.projects.archive, { id });
    expect((await a.as.query(api.projects.board, {})).projects).toHaveLength(0);
  });

  it("the Today card puts overdue first, then soonest due, and skips finished work", async () => {
    const t = convexTest(schema);
    const a = await studio(t, "o_a", "growth");
    await a.as.mutation(api.projects.create, { name: "Far", dueDate: NOW + 30 * DAY });
    await a.as.mutation(api.projects.create, { name: "Soon", dueDate: NOW + 2 * DAY });
    await a.as.mutation(api.projects.create, { name: "Overdue", dueDate: NOW - 3 * DAY });
    const done = await a.as.mutation(api.projects.create, { name: "Done", dueDate: NOW - 9 * DAY });
    await a.as.mutation(api.projects.setStage, { id: done, stage: "complete" });
    const res = await a.as.query(api.projects.todayCards, { nowMs: NOW });
    expect(res.enabled).toBe(true);
    expect(res.projects.map((p) => p.name)).toEqual(["Overdue", "Soon", "Far"]);
    expect(res).toMatchObject({ activeCount: 3, overdueCount: 1 });
    const limited = await a.as.query(api.projects.todayCards, { nowMs: NOW, limit: 1 });
    expect(limited.projects).toHaveLength(1);
    await settle(t);
  });
});

describe("Max: the cross-studio view", () => {
  async function group(agencyPlan: "core" | "growth" | "max") {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_ag", name: "AG", slug: "ag", plan: agencyPlan, status: "active",
        ownerClerkUserId: "u_ag", ownerEmail: "ag@x.com",
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "u_ag", email: "ag@x.com", name: "Owner",
        role: "owner", status: "active", invitedAt: 0,
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "u_staff", email: "s@x.com", name: "Staff",
        role: "staff", status: "active", invitedAt: 0,
      });
    });
    const s1 = await studio(t, "sub_1", "growth", { agencyId: "org_ag" });
    const s2 = await studio(t, "sub_2", "max", { agencyId: "org_ag" });
    await studio(t, "sub_core", "core", { agencyId: "org_ag" });
    const outsider = await studio(t, "other_group", "max", { agencyId: "org_other" });
    await s1.as.mutation(api.projects.create, { name: "One EP", dueDate: NOW - DAY });
    await s2.as.mutation(api.projects.create, { name: "Two LP" });
    await outsider.as.mutation(api.projects.create, { name: "Someone else's record" });
    await t.run((ctx) => ctx.db.insert("projects", {
      orgId: "sub_core", name: "Core leftover", stage: "tracking", createdAt: 1, updatedAt: 1, stageChangedAt: 1,
    }));
    const owner = t.withIdentity({ subject: "u_ag", orgId: "org_ag", orgType: "agency" });
    return { t, owner };
  }

  it("a Max group sees its own studios that hold projects, nobody else's", async () => {
    const { owner } = await group("max");
    const res = await owner.query(api.projects.crossStudio, { nowMs: NOW });
    expect(res.studios.map((s) => s.orgId).sort()).toEqual(["sub_1", "sub_2"]);
    const names = res.studios.flatMap((s) => s.projects.map((p) => p.name)).sort();
    expect(names).toEqual(["One EP", "Two LP"]);
    expect(res.studios[0]).toMatchObject({ orgId: "sub_1", overdueCount: 1 });
  });

  it("a Core or Growth group is refused", async () => {
    for (const plan of ["core", "growth"] as const) {
      const { owner } = await group(plan);
      await expect(owner.query(api.projects.crossStudio, {})).rejects.toMatchObject(UPGRADE);
    }
  });

  it("a studio member, even on Max, cannot open the group view", async () => {
    const { t } = await group("max");
    const s2 = t.withIdentity({ subject: "u_sub_2", orgId: "sub_2" });
    await expect(s2.query(api.projects.crossStudio, {})).rejects.toMatchObject({
      data: { code: "CAPABILITY_DENIED" },
    });
  });

  it("scoped staff only see the studios they are scoped to", async () => {
    const { t } = await group("max");
    const staffRow = await t.run((ctx) =>
      ctx.db.query("agencyMembers").filter((q) => q.eq(q.field("clerkUserId"), "u_staff")).first(),
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(staffRow!._id, { capabilityOverrides: ["+agency.viewAll"] });
      await ctx.db.insert("agencyMemberScopes", {
        agencyId: "org_ag", agencyMemberId: staffRow!._id, subAccountOrgId: "sub_2",
      } as never);
    });
    const staff = t.withIdentity({ subject: "u_staff", orgId: "org_ag", orgType: "agency" });
    const res = await staff.query(api.projects.crossStudio, { nowMs: NOW });
    expect(res.studios.map((s) => s.orgId)).toEqual(["sub_2"]);
  });
});

describe("due and overdue reminders", () => {
  it("reminds once per project, to its owner, and not again inside the day", async () => {
    const t = convexTest(schema);
    const a = await studio(t, "o_a", "growth");
    const core = await studio(t, "o_core", "core");
    const id = await a.as.mutation(api.projects.create, { name: "Late EP", ownerMemberId: a.memberId, dueDate: NOW - HOUR });
    await a.as.mutation(api.projects.addTask, { projectId: id, title: "Bounce", dueDate: NOW - HOUR, ownerMemberId: a.memberId });
    await t.run((ctx) => ctx.db.insert("projects", {
      orgId: "o_core", name: "Core row", stage: "tracking", dueDate: NOW - HOUR, createdAt: 1, updatedAt: 1, stageChangedAt: 1,
    }));
    await t.run((ctx) => ctx.db.insert("projects", {
      orgId: "o_a", name: "Not due", stage: "tracking", dueDate: NOW + 10 * DAY, createdAt: 1, updatedAt: 1, stageChangedAt: 1,
    }));
    void core;
    const res = await t.mutation(internal.projects.sendDueReminders, { nowMs: NOW });
    expect(res.sent).toBe(1);
    const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ orgId: "o_a", kind: "project.due", recipient: "o_a@x.com" });
    expect(notes[0].body).toContain("overdue");
    // Same sweep a few hours later: nothing new. A day later: again.
    expect((await t.mutation(internal.projects.sendDueReminders, { nowMs: NOW + 3 * HOUR })).sent).toBe(0);
    expect((await t.mutation(internal.projects.sendDueReminders, { nowMs: NOW + DAY })).sent).toBe(1);
    await settle(t);
  });

  it("does not remind about finished projects", async () => {
    const t = convexTest(schema);
    const a = await studio(t, "o_a", "growth");
    const id = await a.as.mutation(api.projects.create, { name: "Done", dueDate: NOW - DAY });
    await a.as.mutation(api.projects.setStage, { id, stage: "complete" });
    await settle(t);
    const before = (await t.run((ctx) => ctx.db.query("notifications").collect())).length;
    expect((await t.mutation(internal.projects.sendDueReminders, { nowMs: NOW })).sent).toBe(0);
    expect((await t.run((ctx) => ctx.db.query("notifications").collect())).length).toBe(before);
  });
});

describe("the mirror (iOS) reads these tables", () => {
  it("is a mirrored, gated table set", async () => {
    const { MIRRORED_TABLES, MIRRORED_CAPABILITY } = await import("./lib/mirroredTables");
    for (const name of ["projects", "projectTasks", "projectLinks"] as const) {
      expect(MIRRORED_TABLES).toContain(name);
      expect(MIRRORED_CAPABILITY[name]).toBe("projects.read");
    }
  });
});
