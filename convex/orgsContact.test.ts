import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/* orgs.update writes the studio's public callback number into the nested
   `contact` object that the onboarding wizard also owns. The merge matters:
   editing the phone in Settings must not wipe legalName / address / website. */
describe("orgs.update - studio callback phone", () => {
  let t: ReturnType<typeof convexTest>;

  const asOwner = () =>
    t.withIdentity({ subject: "u_owner", name: "Owner", orgId: "org_s1" } as {
      subject: string;
      name: string;
      orgId: string;
    });

  beforeEach(async () => {
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_s1",
        name: "Aurum Sound Studio",
        slug: "aurum",
        plan: "studio",
        status: "active",
        contact: {
          legalName: "Aurum LLC",
          contactEmail: "hi@aurum.com",
          address: "1 Sunset Blvd",
          website: "https://aurum.com",
        },
      });
      await ctx.db.insert("members", {
        orgId: "org_s1",
        name: "Owner",
        role: "owner",
        clerkUserId: "u_owner",
        skills: [],
      });
    });
  });

  const readContact = () =>
    t.run(async (ctx) => {
      const org = await ctx.db.query("orgs").first();
      return org?.contact;
    });

  it("sets the phone without dropping the other onboarding fields", async () => {
    await asOwner().mutation(api.orgs.update, { contactPhone: "(213) 823-2720" });
    const contact = await readContact();
    expect(contact?.phone).toBe("(213) 823-2720");
    expect(contact?.legalName).toBe("Aurum LLC");
    expect(contact?.address).toBe("1 Sunset Blvd");
    expect(contact?.website).toBe("https://aurum.com");
  });

  it("clears the phone when blanked, still keeping the rest", async () => {
    await asOwner().mutation(api.orgs.update, { contactPhone: "(213) 823-2720" });
    await asOwner().mutation(api.orgs.update, { contactPhone: "   " });
    const contact = await readContact();
    expect(contact?.phone).toBeUndefined();
    expect(contact?.legalName).toBe("Aurum LLC");
  });

  it("leaves contact untouched when the phone is not part of the patch", async () => {
    await asOwner().mutation(api.orgs.update, { tagline: "Where the record gets made." });
    const contact = await readContact();
    expect(contact?.legalName).toBe("Aurum LLC");
    expect(contact?.website).toBe("https://aurum.com");
  });

  it("surfaces the phone to Settings via the org query", async () => {
    await asOwner().mutation(api.orgs.update, { contactPhone: "(213) 823-2720" });
    const org = await asOwner().query(api.orgs.current, {});
    expect(org!.contactPhone).toBe("(213) 823-2720");
  });
});
