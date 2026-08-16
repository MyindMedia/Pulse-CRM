"use client";

import * as React from "react";
import { useHydrated } from "./use-hydrated";

/* ============================================================
   Panels the user can fold away, remembered between visits.

   Someone who collapses the inventory list to get room for a
   patch map wants it collapsed the next time they open one.
   Storing that in localStorage rather than a query param or the
   database keeps it a property of this machine's screen, which
   is what it actually is.
   ============================================================ */

const cache = new Map<string, boolean>();
const listeners = new Map<string, Set<() => void>>();

function read(key: string) {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let value = false;
  try {
    value = localStorage.getItem(key) === "1";
  } catch {
    // Private mode, or storage disabled. Not collapsed is the safe default.
  }
  cache.set(key, value);
  return value;
}

function write(key: string, value: boolean) {
  cache.set(key, value);
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // The panel still toggles for this session.
  }
  for (const listener of listeners.get(key) ?? []) listener();
}

/**
 * A remembered open/closed flag for one panel.
 *
 * Reports collapsed=false through the hydration render whatever the stored
 * value is, so the server's HTML and the client's first paint agree; the
 * saved state applies on the commit straight after.
 */
export function useCollapsiblePanel(key: string) {
  const hydrated = useHydrated();

  const subscribe = React.useCallback(
    (listener: () => void) => {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    [key],
  );

  const getSnapshot = React.useCallback(() => read(key), [key]);
  const getServerSnapshot = React.useCallback(() => false, []);

  const stored = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const collapsed = hydrated && stored;

  const setCollapsed = React.useCallback(
    (next: boolean) => write(key, next),
    [key],
  );
  const toggle = React.useCallback(() => write(key, !read(key)), [key]);

  return { collapsed, setCollapsed, toggle };
}
