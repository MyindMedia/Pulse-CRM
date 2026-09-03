"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { inNativeShell, routeFromDeepLink } from "@/lib/shell";

/**
 * Mounted once in the root layout. Does nothing in a browser.
 *
 * Inside the native shell it turns `pulse://` links into in-app navigation:
 * the URL the app was launched with, and any URL handed to the already
 * running app. Notifications need no wiring here; LiveToasts mirrors its
 * events to the OS through `shellNotify` when it sees the shell.
 */
export function NativeShellBridge() {
  const router = useRouter();

  React.useEffect(() => {
    if (!inNativeShell()) return;
    const deepLink = window.__TAURI__?.deepLink;
    if (!deepLink) return;

    const follow = (urls: string[] | null) => {
      for (const raw of urls ?? []) {
        const route = routeFromDeepLink(raw);
        if (route) {
          router.push(route);
          return;
        }
      }
    };

    deepLink.getCurrent().then(follow).catch(() => {});
    let unlisten: (() => void) | undefined;
    deepLink
      .onOpenUrl(follow)
      .then((off) => {
        unlisten = off;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [router]);

  return null;
}
