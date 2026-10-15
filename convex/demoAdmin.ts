import { internalMutation } from "./functions";
import { v } from "convex/values";

/* Operator switches for a studio, run with the deploy key
   (npx convex run demoAdmin:setSmsAutomation '{"slug":"myind-sound","enabled":false}').
   smsRemindersEnabled gates every automated text: session reminders and
   their YES/NO confirm prompts, waitlist blasts, review requests and the
   owner's 8am digest. Staff-typed messages are not affected. */
export const setSmsAutomation = internalMutation({
  args: { slug: v.string(), enabled: v.boolean() },
  handler: async (ctx, { slug, enabled }) => {
    const org = (await ctx.db.query("orgs").collect()).find((o) => o.slug === slug);
    if (!org) throw new Error(`No studio with slug ${slug}`);
    await ctx.db.patch(org._id, { smsRemindersEnabled: enabled });
    return { orgId: org.orgId, name: org.name, smsRemindersEnabled: enabled };
  },
});
