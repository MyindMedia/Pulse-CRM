"use client";
import * as React from "react";

export type UiStyle = "hardware" | "glass";

/**
 * Mirrors a studio's surface style onto <html data-ui-style> so glass.css
 * (and Radix portals, which render outside any wrapper) can key on it.
 * Hardware, the default, writes nothing: the attribute is removed, so the
 * stylesheet stays inert and the look is untouched. Returns whether glass is on.
 * The attribute is removed on unmount, so leaving a glass studio's page never
 * leaks the skin onto the next route.
 */
export function useUiStyleRoot(style: UiStyle | null | undefined): boolean {
  const glass = style === "glass";
  React.useEffect(() => {
    if (!glass) return;
    const root = document.documentElement;
    root.dataset.uiStyle = "glass";
    return () => {
      delete root.dataset.uiStyle;
    };
  }, [glass]);
  return glass;
}
