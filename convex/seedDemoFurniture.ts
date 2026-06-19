import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/* ============================================================
   Demo furniture-fill. Loads the non-gear assets a high-end
   studio carries - desks, sofas, lounge seating, a beverage
   cooler, espresso machine, lounge TV, decor and acoustic
   treatment - into the equipment table for a demo org (default:
   Myind Sound) so the Inventory module reads like a real,
   fully-outfitted facility for pitching. Idempotent - every row
   it creates is tagged (notes ends with the TAG marker) and
   wiped before a re-fill, so real assets are untouched.
   ============================================================ */

const TAG = "[demo_furniture]";
const DAY = 86_400_000;

type Category = "furniture" | "decor" | "acoustic" | "other";
type Status = "available" | "in_use" | "maintenance" | "retired";

type Item = {
  name: string;
  slug: string; // → /gear/items/<slug>.png (generated product photo)
  category: Category;
  purchaseCents: number; // per unit
  currentValueCents: number; // per unit
  quantity?: number;
  roomIndex?: number; // 0..n into the org's rooms; omit = in storage / common area
  status?: Status; // default available
  condition?: string;
  purchasedDaysAgo?: number;
  note?: string; // TAG appended automatically
};

const ITEMS: Item[] = [
  // ── Furniture ─────────────────────────────────────────
  { name: "Custom Walnut Producer Desk", slug: "producer-desk-walnut", category: "furniture", purchaseCents: 650_000, currentValueCents: 580_000, roomIndex: 0, status: "in_use", condition: "Bespoke, integrated cable management", purchasedDaysAgo: 520, note: "Flagship control-room desk" },
  { name: "Mixing Desk - Studio B", slug: "mixing-desk-studio-b", category: "furniture", purchaseCents: 420_000, currentValueCents: 360_000, roomIndex: 1, status: "in_use", condition: "Excellent", purchasedDaysAgo: 430 },
  { name: "Herman Miller Embody Chairs", slug: "herman-miller-embody-chairs", category: "furniture", purchaseCents: 175_000, currentValueCents: 120_000, quantity: 4, roomIndex: 0, status: "in_use", condition: "Engineer + producer seating", purchasedDaysAgo: 400 },
  { name: "Leather Chesterfield Sofa", slug: "chesterfield-sofa", category: "furniture", purchaseCents: 420_000, currentValueCents: 350_000, condition: "Lounge - full-grain leather", purchasedDaysAgo: 610, note: "Client lounge centerpiece" },
  { name: "Modular Sectional Sofa", slug: "modular-sectional-sofa", category: "furniture", purchaseCents: 380_000, currentValueCents: 300_000, roomIndex: 1, condition: "Mix-room couch for clients", purchasedDaysAgo: 360 },
  { name: "Velvet Accent Chairs", slug: "velvet-accent-chairs", category: "furniture", purchaseCents: 95_000, currentValueCents: 70_000, quantity: 2, condition: "Lounge accent seating", purchasedDaysAgo: 300 },
  { name: "Live-Edge Walnut Coffee Table", slug: "live-edge-coffee-table", category: "furniture", purchaseCents: 180_000, currentValueCents: 190_000, condition: "Lounge, appreciating", purchasedDaysAgo: 480 },
  { name: "Leather Bar Stools", slug: "leather-bar-stools", category: "furniture", purchaseCents: 45_000, currentValueCents: 35_000, quantity: 3, condition: "Kitchenette counter", purchasedDaysAgo: 290 },
  { name: "Steel Gear Storage Cabinets", slug: "gear-storage-cabinets", category: "furniture", purchaseCents: 120_000, currentValueCents: 90_000, quantity: 2, condition: "Locking, in storage room", purchasedDaysAgo: 540 },
  { name: "Reception Desk", slug: "reception-desk", category: "furniture", purchaseCents: 280_000, currentValueCents: 220_000, condition: "Front-of-house, branded", purchasedDaysAgo: 600 },

  // ── Amenities / appliances ────────────────────────────
  { name: "Dual-Zone Beverage Cooler", slug: "beverage-cooler", category: "other", purchaseCents: 90_000, currentValueCents: 60_000, condition: "Client lounge - drinks fridge", purchasedDaysAgo: 250, note: "Mini fridge / drink cooler" },
  { name: "Commercial Espresso Machine", slug: "espresso-machine", category: "other", purchaseCents: 350_000, currentValueCents: 280_000, condition: "Kitchenette, serviced annually", purchasedDaysAgo: 330 },
  { name: "75\" OLED Lounge TV", slug: "oled-lounge-tv", category: "other", purchaseCents: 320_000, currentValueCents: 180_000, condition: "Lounge, wall-mounted", purchasedDaysAgo: 280 },
  { name: "PlayStation 5 Console", slug: "ps5-console", category: "other", purchaseCents: 50_000, currentValueCents: 35_000, condition: "Lounge entertainment", purchasedDaysAgo: 240 },
  { name: "Brass Bar Cart", slug: "brass-bar-cart", category: "other", purchaseCents: 65_000, currentValueCents: 55_000, condition: "Lounge refreshments", purchasedDaysAgo: 300 },
  { name: "HEPA Air Purifier", slug: "air-purifier", category: "other", purchaseCents: 60_000, currentValueCents: 40_000, quantity: 2, condition: "Live + mix rooms", purchasedDaysAgo: 200 },
  { name: "Mini Fridge - Control Room", slug: "mini-fridge", category: "other", purchaseCents: 35_000, currentValueCents: 22_000, roomIndex: 0, condition: "Engineer's fridge", purchasedDaysAgo: 220 },

  // ── Decor / ambiance ──────────────────────────────────
  { name: "Custom Neon Logo Sign", slug: "neon-logo-sign", category: "decor", purchaseCents: 120_000, currentValueCents: 110_000, condition: "Lounge feature wall", purchasedDaysAgo: 450, note: "Brand neon" },
  { name: "Framed Gold Records Set", slug: "gold-records-wall", category: "decor", purchaseCents: 150_000, currentValueCents: 160_000, quantity: 6, condition: "Hallway display, appreciating", purchasedDaysAgo: 700 },
  { name: "Designer Floor Lamps", slug: "designer-floor-lamps", category: "decor", purchaseCents: 55_000, currentValueCents: 40_000, quantity: 3, condition: "Lounge + writing room", purchasedDaysAgo: 320 },
  { name: "Indoor Plant Collection", slug: "studio-plants", category: "decor", purchaseCents: 80_000, currentValueCents: 60_000, condition: "Live plants throughout", purchasedDaysAgo: 180 },
  { name: "Persian Area Rug", slug: "persian-area-rug", category: "decor", purchaseCents: 240_000, currentValueCents: 260_000, condition: "Live room, hand-knotted", purchasedDaysAgo: 560 },

  // ── Acoustic treatment ────────────────────────────────
  { name: "Custom Fabric Acoustic Panels", slug: "acoustic-panels", category: "acoustic", purchaseCents: 450_000, currentValueCents: 380_000, roomIndex: 0, status: "in_use", condition: "Tuned for the live room", purchasedDaysAgo: 500 },
  { name: "Corner Bass Traps", slug: "corner-bass-traps", category: "acoustic", purchaseCents: 35_000, currentValueCents: 30_000, quantity: 4, roomIndex: 1, status: "in_use", condition: "Mix-room corners", purchasedDaysAgo: 470 },
  { name: "Ceiling Cloud Diffusers", slug: "ceiling-cloud-diffusers", category: "acoustic", purchaseCents: 180_000, currentValueCents: 150_000, roomIndex: 0, status: "in_use", condition: "First-reflection clouds", purchasedDaysAgo: 500 },
];

export const fillFurniture = internalMutation({
  args: {
    orgId: v.string(),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = args.orgId;
    const now = args.nowMs ?? Date.now();

    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    // ── Wipe prior demo furniture (idempotent re-fill) ──
    const old = await ctx.db
      .query("equipment")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    let removed = 0;
    for (const row of old) {
      if (row.notes && row.notes.includes(TAG)) {
        await ctx.db.delete(row._id);
        removed++;
      }
    }

    let added = 0;
    for (const item of ITEMS) {
      const room: Id<"rooms"> | undefined =
        item.roomIndex != null && rooms[item.roomIndex] ? rooms[item.roomIndex]._id : undefined;
      const note = item.note ? `${item.note} ${TAG}` : TAG;
      await ctx.db.insert("equipment", {
        orgId,
        name: item.name,
        category: item.category,
        installedInRoomId: room,
        status: item.status ?? "available",
        quantity: item.quantity,
        purchaseCents: item.purchaseCents,
        currentValueCents: item.currentValueCents,
        purchaseDate: item.purchasedDaysAgo != null ? now - item.purchasedDaysAgo * DAY : undefined,
        condition: item.condition,
        notes: note,
        photoUrl: `/gear/items/${item.slug}.png`,
      });
      added++;
    }

    return { orgId, removed, added, total: ITEMS.length };
  },
});
