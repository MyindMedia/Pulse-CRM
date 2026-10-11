import { internalAction } from "./_generated/server";
import { complete } from "./lib/openai";

/** Operator check: which AI provider answers on this deployment, and with
 *  which model. One tiny request through the same chokepoint the agents use.
 *  Run with `npx convex run aiHealth:ping` (add the deployment's deploy key). */
export const ping = internalAction({
  args: {},
  handler: async (): Promise<{ source: string; model: string | null; text: string | null }> => {
    const res = await complete("Reply with the single word: ready", { maxOutputTokens: 20 });
    return res
      ? { source: res.source, model: res.model, text: res.text.slice(0, 40) }
      : { source: "none", model: null, text: null };
  },
});
