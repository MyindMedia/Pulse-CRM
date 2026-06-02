/* ============================================================
   Inventory import - shared, pure helpers.

   One source of truth for: the asset columns we capture, how we
   auto-discover a studio's own header row (any column order / naming),
   and how raw cell values coerce into our equipment shape. Used by both
   the import panel (auto-map + parse) and the .xlsx template generator,
   and unit-tested without a DOM or database.
   ============================================================ */

/** The fields a row can map to. Mirrors the Add-equipment screen + schema. */
export type AssetField =
  | "name"
  | "category"
  | "purchaseValue"
  | "currentValue"
  | "serialNumber"
  | "condition"
  | "room"
  | "status"
  | "purchaseDate"
  | "notes";

export type ColumnSpec = {
  field: AssetField;
  /** Header written into the downloadable template. */
  header: string;
  /** Header variants we auto-match against (normalized). */
  synonyms: string[];
  required: boolean;
  example: string;
  hint: string;
};

/** Every component of the assets screen, in template order. */
export const ASSET_COLUMNS: ColumnSpec[] = [
  {
    field: "name",
    header: "Name",
    synonyms: ["name", "item", "itemname", "equipment", "equipmentname", "asset", "assetname", "gear", "model", "product", "title"],
    required: true,
    example: "Neumann U87",
    hint: "Required. The item's name or model.",
  },
  {
    field: "category",
    header: "Category",
    synonyms: ["category", "type", "kind", "class", "group"],
    required: false,
    example: "mic",
    hint: "One of: console, mic, outboard, instrument, monitor, rig, other.",
  },
  {
    field: "purchaseValue",
    header: "Purchase Value (USD)",
    synonyms: ["purchasevalue", "purchase", "purchaseprice", "cost", "paid", "pricepaid", "originalcost", "msrp", "price"],
    required: false,
    example: "3200",
    hint: "What it cost. Numbers only (3200 or $3,200).",
  },
  {
    field: "currentValue",
    header: "Current Value (USD)",
    synonyms: ["currentvalue", "value", "worth", "marketvalue", "currentworth", "estvalue", "resale", "estimatedvalue"],
    required: false,
    example: "2400",
    hint: "What it is worth now. Numbers only.",
  },
  {
    field: "serialNumber",
    header: "Serial Number",
    synonyms: ["serialnumber", "serial", "sn", "sno", "serialno"],
    required: false,
    example: "U87-00231",
    hint: "Optional. Used to skip duplicates on re-import.",
  },
  {
    field: "condition",
    header: "Condition",
    synonyms: ["condition", "state", "grade", "quality"],
    required: false,
    example: "Excellent",
    hint: "Free text, e.g. Excellent, Serviced, Worn.",
  },
  {
    field: "room",
    header: "Location / Room",
    synonyms: ["location", "room", "installedin", "installed", "where", "place", "studio", "roomname"],
    required: false,
    example: "Studio A",
    hint: "Matches an existing room by name, else goes to storage.",
  },
  {
    field: "status",
    header: "Status",
    synonyms: ["status", "availability", "avail"],
    required: false,
    example: "available",
    hint: "available, in_use, maintenance or retired.",
  },
  {
    field: "purchaseDate",
    header: "Purchase Date",
    synonyms: ["purchasedate", "datepurchased", "bought", "acquired", "dateacquired", "purchasedon", "date"],
    required: false,
    example: "2023-05-14",
    hint: "Optional. Any common date format.",
  },
  {
    field: "notes",
    header: "Notes",
    synonyms: ["notes", "note", "comments", "remarks", "details", "description", "desc"],
    required: false,
    example: "Includes shock mount and case.",
    hint: "Anything worth recording.",
  },
];

export const ASSET_FIELD_LABEL: Record<AssetField, string> = Object.fromEntries(
  ASSET_COLUMNS.map((c) => [c.field, c.header]),
) as Record<AssetField, string>;

/** Normalize a header/label for fuzzy matching: lowercase, alphanumeric only. */
export function normalizeHeader(raw: string): string {
  return String(raw ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Auto-map a sheet's header row to asset fields. Returns one entry per source
 * header (in order), with its best-guess field or null ("ignore"). Exact
 * normalized matches win; otherwise a contains-match. Each field maps once -
 * the first/closest header claims it.
 */
export function autoMapHeaders(headers: string[]): (AssetField | null)[] {
  const claimed = new Set<AssetField>();
  const norm = headers.map(normalizeHeader);

  // Pass 1: exact synonym match.
  const result: (AssetField | null)[] = headers.map(() => null);
  for (let i = 0; i < headers.length; i++) {
    const h = norm[i];
    if (!h) continue;
    const exact = ASSET_COLUMNS.find(
      (c) => !claimed.has(c.field) && c.synonyms.includes(h),
    );
    if (exact) {
      result[i] = exact.field;
      claimed.add(exact.field);
    }
  }
  // Pass 2: contains match for still-unmapped headers.
  for (let i = 0; i < headers.length; i++) {
    if (result[i] || !norm[i]) continue;
    const h = norm[i];
    const partial = ASSET_COLUMNS.find(
      (c) =>
        !claimed.has(c.field) &&
        c.synonyms.some((s) => s.length >= 3 && (h.includes(s) || s.includes(h))),
    );
    if (partial) {
      result[i] = partial.field;
      claimed.add(partial.field);
    }
  }
  return result;
}

/* ── Value coercion ─────────────────────────────────────────── */

const CATEGORY_ALIASES: Record<string, string> = {
  console: "console", desk: "console", board: "console", mixer: "console", mixingconsole: "console",
  mic: "mic", microphone: "mic", microphones: "mic", mics: "mic",
  outboard: "outboard", preamp: "outboard", compressor: "outboard", eq: "outboard", processor: "outboard", rack: "outboard", "500series": "outboard",
  instrument: "instrument", guitar: "instrument", bass: "instrument", keys: "instrument", keyboard: "instrument", synth: "instrument", synthesizer: "instrument", drums: "instrument", piano: "instrument",
  monitor: "monitor", monitors: "monitor", speaker: "monitor", speakers: "monitor", studiomonitor: "monitor",
  rig: "rig", system: "rig", setup: "rig",
  other: "other", misc: "other", accessory: "other", cable: "other",
};

const VALID_CATEGORIES = ["console", "mic", "outboard", "instrument", "monitor", "rig", "other"] as const;

/** Map free text to a valid category, defaulting to "other". */
export function coerceCategory(raw: unknown): string {
  const n = normalizeHeader(String(raw ?? ""));
  if (!n) return "other";
  if ((VALID_CATEGORIES as readonly string[]).includes(n)) return n;
  return CATEGORY_ALIASES[n] ?? "other";
}

const STATUS_ALIASES: Record<string, string> = {
  available: "available", active: "available", instorage: "available", storage: "available", ready: "available",
  inuse: "in_use", used: "in_use", booked: "in_use", installed: "in_use",
  maintenance: "maintenance", repair: "maintenance", servicing: "maintenance", service: "maintenance", broken: "maintenance",
  retired: "retired", sold: "retired", disposed: "retired", inactive: "retired", lost: "retired",
};

const VALID_STATUSES = ["available", "in_use", "maintenance", "retired"] as const;

/** Map free text to a valid status, defaulting to "available". */
export function coerceStatus(raw: unknown): string {
  const n = normalizeHeader(String(raw ?? ""));
  if (!n) return "available";
  if ((VALID_STATUSES as readonly string[]).includes(n)) return n;
  return STATUS_ALIASES[n] ?? "available";
}

/** Parse a money cell ("$3,200.50", 3200, "3200") into integer cents, or 0. */
export function coerceMoneyCents(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return 0;
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw * 100) : 0;
  const cleaned = String(raw).replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

/** Parse a date cell (Date, Excel serial, or string) into epoch ms, or undefined. */
export function coerceDateMs(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw.getTime() : undefined;
  if (typeof raw === "number") {
    // Excel serial date (days since 1899-12-30). Heuristic: plausible serial range.
    if (raw > 0 && raw < 90000) {
      const ms = Math.round((raw - 25569) * 86400 * 1000);
      return Number.isFinite(ms) ? ms : undefined;
    }
    return undefined;
  }
  const t = Date.parse(String(raw));
  return Number.isNaN(t) ? undefined : t;
}

export type ParsedAsset = {
  name: string;
  category: string;
  purchaseCents: number;
  currentValueCents: number;
  serialNumber?: string;
  condition?: string;
  roomName?: string;
  status: string;
  purchaseDate?: number;
  notes?: string;
};

/** Build one clean asset from a raw row keyed by AssetField. Returns null when
 *  there is no usable name (the only required field). */
export function rowToAsset(row: Partial<Record<AssetField, unknown>>): ParsedAsset | null {
  const name = String(row.name ?? "").trim();
  if (!name) return null;
  const str = (v: unknown) => {
    const s = String(v ?? "").trim();
    return s || undefined;
  };
  return {
    name,
    category: coerceCategory(row.category),
    purchaseCents: coerceMoneyCents(row.purchaseValue),
    currentValueCents: coerceMoneyCents(row.currentValue),
    serialNumber: str(row.serialNumber),
    condition: str(row.condition),
    roomName: str(row.room),
    status: coerceStatus(row.status),
    purchaseDate: coerceDateMs(row.purchaseDate),
    notes: str(row.notes),
  };
}
