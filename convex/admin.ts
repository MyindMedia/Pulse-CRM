import { v } from "convex/values";
import { mutation, action, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// ─── Tenant Queries ───

export const listTenants = query({
  handler: async (ctx) => {
    return await ctx.db.query("tenants").collect();
  },
});

export const updateTenant = mutation({
  args: {
    tenantId: v.id("tenants"),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    ghlLocationId: v.optional(v.string()),
    plan: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { tenantId, ...fields } = args;
    // Only patch defined fields
    const patch: Record<string, any> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) patch[key] = value;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(tenantId, patch);
    }
    return await ctx.db.get(tenantId);
  },
});

export const deleteTenantInternal = mutation({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.tenantId);
  },
});

export const deleteTenant = action({
  args: {
    tenantId: v.id("tenants"),
    ghlLocationId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ success: boolean; ghlDeleted: boolean; error?: string }> => {
    let ghlDeleted = false;

    // 1. Delete GHL sub-account if linked
    if (args.ghlLocationId) {
      try {
        const response = await fetch(
          `https://services.leadconnectorhq.com/locations/${args.ghlLocationId}`,
          {
            method: "DELETE",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${process.env.GHL_AGENCY_API_KEY}`,
              Version: "2021-07-28",
            },
          }
        );

        if (response.ok) {
          ghlDeleted = true;
        } else {
          const errorBody = await response.text();
          console.error(`GHL delete failed (${response.status}): ${errorBody}`);
        }
      } catch (error) {
        console.error("GHL delete request failed:", error);
      }
    }

    // 2. Delete tenant from Convex
    await ctx.runMutation("admin:deleteTenantInternal" as any, {
      tenantId: args.tenantId,
    });

    return { success: true, ghlDeleted };
  },
});

// ─── GHL Sub-Account Management ───

export const createSubAccount = action({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    country: v.optional(v.string()),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    tenantId: string;
    ghlLocationId: string | null;
    error?: string;
  }> => {
    // 1. Create tenant
    const tenantId: Id<"tenants"> = await ctx.runMutation(
      "tenants:create" as any,
      {
        name: args.name,
        slug: args.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      }
    );

    // 2. Create GHL sub-account
    try {
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
            address: args.address,
            city: args.city,
            state: args.state,
            country: args.country ?? "US",
            timezone: args.timezone ?? "America/Los_Angeles",
          }),
        }
      );

      if (!ghlResponse.ok) {
        const errorBody = await ghlResponse.text();
        throw new Error(`GHL API Error (${ghlResponse.status}): ${errorBody}`);
      }

      const ghlData = (await ghlResponse.json()) as Record<string, any>;
      const locationId: string | undefined = ghlData.id ?? ghlData.location?.id;

      if (locationId) {
        await ctx.runMutation("tenants:setGhlLocationId" as any, {
          tenantId,
          ghlLocationId: locationId,
        });
      }

      return { tenantId, ghlLocationId: locationId ?? null };
    } catch (error) {
      console.error("GHL sub-account creation failed:", error);
      return { tenantId, ghlLocationId: null, error: String(error) };
    }
  },
});

export const listGhlSubAccounts = action({
  handler: async (): Promise<{
    locations: Array<{ id: string; name: string; email: string; phone?: string }>;
    error?: string;
  }> => {
    try {
      const response = await fetch(
        `https://services.leadconnectorhq.com/locations/search`,
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
            limit: 100,
            skip: 0,
          }),
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`GHL API Error (${response.status}): ${errorBody}`);
      }

      const data = (await response.json()) as Record<string, any>;
      const locations = (data.locations ?? []).map((loc: any) => ({
        id: loc.id ?? loc._id,
        name: loc.name ?? "",
        email: loc.email ?? "",
        phone: loc.phone,
      }));

      return { locations };
    } catch (error) {
      console.error("GHL list sub-accounts failed:", error);
      return { locations: [], error: String(error) };
    }
  },
});

export const deleteGhlSubAccount = action({
  args: { locationId: v.string() },
  handler: async (_, args): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(
        `https://services.leadconnectorhq.com/locations/${args.locationId}`,
        {
          method: "DELETE",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${process.env.GHL_AGENCY_API_KEY}`,
            Version: "2021-07-28",
          },
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`GHL API Error (${response.status}): ${errorBody}`);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
});

// ─── Backend Data Viewer Queries ───

export const listProfiles = query({
  handler: async (ctx) => {
    return await ctx.db.query("profiles").collect();
  },
});

export const listClients = query({
  handler: async (ctx) => {
    return await ctx.db.query("clients").collect();
  },
});

export const listProjects = query({
  handler: async (ctx) => {
    return await ctx.db.query("projects").collect();
  },
});

export const listSessions = query({
  handler: async (ctx) => {
    return await ctx.db.query("sessions").collect();
  },
});

export const listInvoices = query({
  handler: async (ctx) => {
    return await ctx.db.query("invoices").collect();
  },
});

export const listPayments = query({
  handler: async (ctx) => {
    return await ctx.db.query("payments").collect();
  },
});

export const listRoles = query({
  handler: async (ctx) => {
    return await ctx.db.query("roles").collect();
  },
});

export const listPermissions = query({
  handler: async (ctx) => {
    return await ctx.db.query("permissions").collect();
  },
});

export const listTenantMemberships = query({
  handler: async (ctx) => {
    return await ctx.db.query("tenantMemberships").collect();
  },
});

export const listWebhookEvents = query({
  handler: async (ctx) => {
    return await ctx.db.query("webhookEventsRaw").collect();
  },
});

export const listActivityLog = query({
  handler: async (ctx) => {
    return await ctx.db.query("activityLog").collect();
  },
});

export const listIntegrationSyncState = query({
  handler: async (ctx) => {
    return await ctx.db.query("integrationSyncState").collect();
  },
});
