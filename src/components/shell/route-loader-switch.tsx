"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { APP_ROUTE_SEGMENTS } from "@/lib/app-routes";

const APP_SEGMENTS = new Set<string>(APP_ROUTE_SEGMENTS);

/** Picks between two server-rendered loaders by route: `app` on the
 *  authenticated app's routes, `other` everywhere else. Both arrive already
 *  rendered, so this ships almost no code to the public pages. */
export function RouteLoaderSwitch({ app, other }: { app: React.ReactNode; other: React.ReactNode }) {
  const segment = usePathname()?.split("/")[1] ?? "";
  return <>{APP_SEGMENTS.has(segment) ? app : other}</>;
}
