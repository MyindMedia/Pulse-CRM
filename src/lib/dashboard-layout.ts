/* Pure state math for the customizable dashboard. A layout is an ordered list
   of widget keys plus a hidden set, persisted per user; normalization
   reconciles whatever was saved with the CURRENT widget registry so renamed,
   removed, or newly-shipped widgets never corrupt a stored layout. */

export type DashboardLayout = {
  /** Every known widget key, in display order (hidden ones included). */
  order: string[];
  /** Widgets not currently shown. */
  hidden: string[];
};

/**
 * Reconcile a saved layout (possibly null/stale) against the registry.
 * - unknown keys are dropped,
 * - keys missing from the save (newly shipped widgets) are appended in
 *   registry order and default to visible unless the registry hides them,
 * - with no save at all, registry order + registry default-hidden apply.
 */
export function normalizeLayout(
  saved: Partial<DashboardLayout> | null,
  registryKeys: string[],
  defaultHidden: string[],
): DashboardLayout {
  const known = new Set(registryKeys);
  if (!saved || !Array.isArray(saved.order)) {
    return { order: [...registryKeys], hidden: defaultHidden.filter((k) => known.has(k)) };
  }
  const order = saved.order.filter((k) => known.has(k));
  const seen = new Set(order);
  const appended: string[] = [];
  for (const k of registryKeys) {
    if (!seen.has(k)) {
      order.push(k);
      appended.push(k);
    }
  }
  const savedHidden = Array.isArray(saved.hidden) ? saved.hidden : [];
  const hidden = [
    ...savedHidden.filter((k) => known.has(k)),
    // Newly-shipped widgets respect their registry default.
    ...appended.filter((k) => defaultHidden.includes(k)),
  ];
  return { order, hidden: [...new Set(hidden)] };
}

/** Visible keys, in order. */
export function visibleKeys(layout: DashboardLayout): string[] {
  const hidden = new Set(layout.hidden);
  return layout.order.filter((k) => !hidden.has(k));
}

/** Hide a widget (idempotent). */
export function hideKey(layout: DashboardLayout, key: string): DashboardLayout {
  if (layout.hidden.includes(key)) return layout;
  return { ...layout, hidden: [...layout.hidden, key] };
}

/** Show a widget again (appends to the end of the visible flow by moving it
 *  to the end of `order`, which is where a freshly-added tile is expected). */
export function showKey(layout: DashboardLayout, key: string): DashboardLayout {
  return {
    order: [...layout.order.filter((k) => k !== key), key],
    hidden: layout.hidden.filter((k) => k !== key),
  };
}

/** Reorder the VISIBLE sequence (drag & drop result) while keeping hidden
 *  widgets parked at the end of `order`. */
export function reorderVisible(layout: DashboardLayout, nextVisible: string[]): DashboardLayout {
  const hidden = new Set(layout.hidden);
  const parked = layout.order.filter((k) => hidden.has(k));
  return { ...layout, order: [...nextVisible, ...parked] };
}
