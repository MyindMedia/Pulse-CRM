import { v } from "convex/values";

/* ============================================================
   Shared argument validators for the patch feature.

   The same vocabulary the schema uses, declared once. A port
   created through addPort, a port template on a profile, a port
   restored by undo and a cable end in the locker all have to
   speak the same language or the connector checks are worthless.
   ============================================================ */

export const portDirectionV = v.union(
  v.literal("input"),
  v.literal("output"),
  v.literal("bidirectional"),
);

export const signalLevelV = v.union(
  v.literal("mic"),
  v.literal("line"),
  v.literal("instrument"),
  v.literal("speaker"),
  v.literal("digital"),
  v.literal("control"),
);

/** Kept in step with `connectorType` in schema.ts and CONNECTOR_DEFS. */
export const connectorV = v.union(
  v.literal("xlr3"),
  v.literal("xlr5"),
  v.literal("trs"),
  v.literal("ts"),
  v.literal("trs_mini"),
  v.literal("bantam"),
  v.literal("db25"),
  v.literal("speakon"),
  v.literal("banana"),
  v.literal("rca"),
  v.literal("bnc"),
  v.literal("wordclock_bnc"),
  v.literal("midi_din"),
  v.literal("rj45"),
  v.literal("usb_a"),
  v.literal("usb_b"),
  v.literal("usb_b_mini"),
  v.literal("usb_b_micro"),
  v.literal("usb_c"),
  v.literal("thunderbolt"),
  v.literal("adat_optical"),
  v.literal("spdif_optical"),
  v.literal("spdif_coax"),
  v.literal("xlr4"),
  v.literal("mini_xlr"),
  v.literal("euroblock"),
  v.literal("trrs"),
  // Legacy, pre-split.
  v.literal("xlr"),
  v.literal("usb"),
  v.literal("other"),
);

export const genderV = v.union(
  v.literal("male"),
  v.literal("female"),
  v.literal("unspecified"),
);

export const portCapabilityV = v.union(
  v.literal("phantom"),
  v.literal("pad"),
  v.literal("polarity"),
  v.literal("monoSum"),
  v.literal("hpf"),
  v.literal("impedance"),
);

export const normallingModeV = v.union(
  v.literal("full"),
  v.literal("half"),
  v.literal("none"),
);

export const cableFitV = v.union(
  v.literal("exact"),
  v.literal("compatible"),
  v.literal("vague"),
  v.literal("mismatch"),
);

export const portStateV = v.object({
  phantom: v.optional(v.boolean()),
  pad: v.optional(v.boolean()),
  polarity: v.optional(v.boolean()),
  monoSum: v.optional(v.boolean()),
  hpf: v.optional(v.boolean()),
  impedance: v.optional(v.string()),
});

export const portTemplateV = v.object({
  label: v.string(),
  direction: portDirectionV,
  signalLevel: signalLevelV,
  connector: connectorV,
  gender: v.optional(genderV),
  channelIndex: v.optional(v.number()),
  capabilities: v.array(portCapabilityV),
  bayRow: v.optional(v.union(v.literal("top"), v.literal("bottom"))),
  bayColumn: v.optional(v.number()),
});
