import { v } from "convex/values";
import { action, mutation } from "./_generated/server";

export const create = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("tenants", {
      name: args.name,
      slug: args.slug,
      status: "active",
    });
  },
});

export const setGhlLocationId = mutation({
  args: {
    tenantId: v.id("tenants"),
    ghlLocationId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.tenantId, {
      ghlLocationId: args.ghlLocationId,
    });
  },
});

export const createWithGhl = action({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Create tenant
    const tenantId = await ctx.runMutation(
      "tenants:create" as any,
      {
        name: args.name,
        slug: args.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      }
    );

    // 2. We can try to create GHL sub-account or just return the tenantId 
    // depending on if GHL API keys are set up. But onboarding/page.tsx just needs 
    // it to return { tenantId, ghlLocationId }
    try {
      if (!process.env.GHL_AGENCY_API_KEY) {
        throw new Error("Missing GHL API Key");
      }
      
      const ghlResponse = await fetch(
        "https://services.leadconnectorhq.com/locations/",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${process.env.GHL_AGENCY_API_KEY}`,
            Version: "2021-07-28",
          },
          body: JSON.stringify({
            companyId: process.env.GHL_COMPANY_ID,
            name: args.name,
            email: args.email,
            phone: args.phone,
          }),
        }
      );

      if (ghlResponse.ok) {
        const ghlData = (await ghlResponse.json()) as Record<string, any>;
        const locationId: string | undefined = ghlData.id ?? ghlData.location?.id;

        if (locationId) {
          await ctx.runMutation("tenants:setGhlLocationId" as any, {
            tenantId,
            ghlLocationId: locationId,
          });
          return { tenantId, ghlLocationId: locationId };
        }
      }
    } catch (error) {
      console.error("GHL integration skipped/failed inside createWithGhl:", error);
    }
    
    return { tenantId };
  },
});
