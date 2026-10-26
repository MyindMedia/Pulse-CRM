"use node";

import { createHash } from "node:crypto";
import { action } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { headerSignature, parseStatement, type ColumnMap } from "./lib/royaltyCsv";

/* Reads an uploaded statement back from R2 and writes it (royalties.ts).
   Node runtime: a 20 MB export plus its fold needs more memory than the
   default runtime gives an action. */

const LINES_PER_BATCH = 200;

const columnsV = v.object({
  isrc: v.optional(v.string()),
  title: v.optional(v.string()),
  artist: v.optional(v.string()),
  amount: v.string(),
  currency: v.optional(v.string()),
  units: v.optional(v.string()),
  period: v.optional(v.string()),
});

type ImportResult =
  | { kind: "ok"; statementId: Id<"royaltyStatements">; lines: number; rows: number; skippedRows: number }
  | { kind: "needsMapping"; headers: string[]; sample: string[][] };

export const importStatement = action({
  args: { mediaId: v.id("mediaFiles"), mapping: v.optional(columnsV) },
  handler: async (ctx, { mediaId, mapping }): Promise<ImportResult> => {
    // Gate, role, and that this upload is this studio's statement.
    const c = await ctx.runQuery(internal.royalties._importContext, { mediaId });
    const res = await fetch(c.url);
    if (!res.ok) throw new ConvexError({ code: "NOT_FOUND", message: "The uploaded file could not be read." });
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > 20 * 1024 * 1024) throw new ConvexError({ code: "TOO_LARGE", message: "Statements up to 20 MB." });
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    if (await ctx.runQuery(internal.royalties._byHash, { orgId: c.orgId, fileHash })) {
      throw new ConvexError({ code: "DUPLICATE", message: "This statement was already imported." });
    }
    const text = bytes.toString("utf8");

    let parsed = parseStatement(text, mapping ? { mapping: mapping as ColumnMap } : {});
    let saveMapping: { signature: string; columns: ColumnMap } | undefined;
    if (parsed.kind === "needsMapping") {
      const signature = headerSignature(parsed.headers);
      const saved = c.mappings.find((m) => m.signature === signature);
      if (!saved) return { kind: "needsMapping", headers: parsed.headers, sample: parsed.sample };
      parsed = parseStatement(text, { mapping: saved.columns });
    } else if (parsed.kind === "ok" && mapping) {
      saveMapping = { signature: headerSignature(parsed.headers), columns: mapping as ColumnMap };
    }
    if (parsed.kind === "invalid") throw new ConvexError({ code: "BAD_FILE", message: parsed.reason });
    if (parsed.kind !== "ok") throw new ConvexError({ code: "BAD_FILE", message: "Couldn't read that statement." });
    const st = parsed.statement;
    if (st.lines.length === 0) throw new ConvexError({ code: "BAD_FILE", message: "No earnings rows found in that file." });

    const statementId = await ctx.runMutation(internal.royalties._createStatement, {
      orgId: c.orgId,
      actor: c.actor,
      mediaId,
      fileName: c.fileName,
      fileHash,
      source: parsed.source,
      periodStart: st.periodStart,
      periodEnd: st.periodEnd,
      totals: st.totals,
      rowCount: st.rowCount,
      lineCount: st.lines.length,
      saveMapping,
    });
    try {
      for (let i = 0; i < st.lines.length; i += LINES_PER_BATCH) {
        await ctx.runMutation(internal.royalties._addLines, { statementId, lines: st.lines.slice(i, i + LINES_PER_BATCH) });
      }
      await ctx.runMutation(internal.royalties._finishStatement, { statementId });
    } catch (err) {
      await ctx.runMutation(internal.royalties._finishStatement, {
        statementId,
        error: err instanceof Error ? err.message : "Import failed",
      });
      throw err;
    }
    return { kind: "ok", statementId, lines: st.lines.length, rows: st.rowCount, skippedRows: st.skippedRows };
  },
});
