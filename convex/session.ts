import { query } from "./_generated/server";
import { resolveViewer } from "./lib/access";
import { currentOrg } from "./lib/tenant";

/* Who the caller is, and which studio they are looking at.
 *
 * The native clients need this and the web app never did. A browser knows
 * because it renders the agency console and the studio app at different routes;
 * a phone opens to one screen and has to be told. Without it a signed-in agency
 * owner syncs the DEMO workspace and it looks exactly like a working app with
 * the wrong studio's data in it.
 *
 * The list of studios comes from the same scoping the agency console uses, so a
 * studio member gets an empty list and an agency member gets only their own
 * sub-accounts. This adds no reach: everything here is already readable by the
 * caller through `agency.subaccounts`, minus the revenue rollups a phone has no
 * use for and no business carrying.
 */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    let viewer;
    try {
      viewer = await resolveViewer(ctx);
    } catch {
      return {
        signedIn: identity !== null,
        email: identity?.email ?? null,
        kind: "none" as const,
        orgId: null,
        orgName: null,
        needsStudio: false,
        studios: [],
      };
    }

    const orgId = await currentOrg(ctx);
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();

    // Only an agency member can enter another studio, and only their own.
    // A studio member is already where they belong and is offered no list.
    let studios: { orgId: string; name: string; slug: string }[] = [];
    if (viewer.kind === "agency_member") {
      const all = await ctx.db.query("orgs").collect();
      studios = all
        .filter((o) => o.agencyId === viewer.agencyId && o.orgId !== "pulse-demo")
        .filter((o) =>
          viewer.scopedSubAccountOrgIds === "all"
            ? true
            : viewer.scopedSubAccountOrgIds.includes(o.orgId),
        )
        .map((o) => ({ orgId: o.orgId, name: o.name, slug: o.slug }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    // An agency member who has not entered a sub-account resolves to the demo
    // workspace. That is the case worth naming, because the app otherwise looks
    // like it is working and is showing somebody else's studio.
    const needsStudio =
      viewer.kind === "agency_member" && (orgId === "pulse-demo" || org === null);

    return {
      signedIn: identity !== null,
      email: identity?.email ?? null,
      kind: viewer.kind,
      orgId: org ? orgId : null,
      orgName: org?.name ?? null,
      needsStudio,
      studios,
    };
  },
});
