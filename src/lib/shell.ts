/* The native shell.
 *
 * Pulse also ships as a macOS and iOS app (repo MyindMedia/Pulse-Desktop,
 * Tauri v2). That app does not bundle this code; it opens the hosted site in
 * a WKWebView and exposes three plugins to it on `window.__TAURI__`:
 * notification, deepLink and opener. Everything in this file is a no-op in a
 * normal browser, so callers never need to branch on where they are running.
 *
 * Why the web-push path is not enough there: WKWebView has no service
 * worker, so `pushSupported()` is false inside the shell and the device
 * alerts chip hides itself. The shell gets its notifications from the same
 * live activity feed that drives the in-app toasts, mirrored to the OS. */

type TauriNotification = {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<"granted" | "denied" | "default">;
  sendNotification: (options: { title: string; body?: string }) => void;
};

type TauriDeepLink = {
  /** URLs the app was launched with, if any. */
  getCurrent: () => Promise<string[] | null>;
  /** Fires when the running app is asked to open a URL. Resolves to an unlisten. */
  onOpenUrl: (handler: (urls: string[]) => void) => Promise<() => void>;
};

type TauriGlobal = {
  notification?: TauriNotification;
  deepLink?: TauriDeepLink;
  opener?: { openUrl: (url: string) => Promise<void> };
};

declare global {
  interface Window {
    __TAURI__?: TauriGlobal;
  }
}

export function inNativeShell(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI__);
}

/** Show an OS notification through the shell. Resolves false in a browser,
 *  when the user has said no, or if the shell refused; callers treat it as
 *  best-effort because the in-app toast already carries the event. */
export async function shellNotify(title: string, body?: string): Promise<boolean> {
  const n = window.__TAURI__?.notification;
  if (!n) return false;
  try {
    let granted = await n.isPermissionGranted();
    if (!granted) granted = (await n.requestPermission()) === "granted";
    if (!granted) return false;
    n.sendNotification({ title, body });
    return true;
  } catch {
    return false;
  }
}

/** `pulse://bookings` -> `/bookings`, `pulse://portal/abc?x=1` -> `/portal/abc?x=1`.
 *  The first path segment rides in the URL's host, which is how a custom
 *  scheme parses. A bare `pulse://` opens the dashboard. */
export function routeFromDeepLink(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "pulse:") return null;
    const path = `/${url.host}${url.pathname}`.replace(/\/+$/, "") || "/dashboard";
    // Only ever route inside the app. A deep link cannot carry a foreign origin.
    if (!path.startsWith("/") || path.startsWith("//")) return null;
    return `${path}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
