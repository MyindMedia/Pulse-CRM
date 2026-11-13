/* Browser facts the delivery page needs, kept pure so they can be tested. */

/** iPhone, iPad and iPod, in any browser (every iOS browser is WebKit). An
 *  iPad on iPadOS 13 or later asks for the desktop site and reports itself as
 *  a Mac; a touch screen gives it away, since no Mac has one. These devices
 *  do not start several downloads from one tap, so the page offers one file
 *  per tap there. */
export function isTouchApple(nav: { userAgent?: string; maxTouchPoints?: number }): boolean {
  const ua = nav.userAgent ?? "";
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return true;
  return /\bMacintosh\b/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

/** How long a download frame stays in the page. A signed link lives ten
 *  minutes, but the browser has the response (and the download has started)
 *  long before two. */
export const DOWNLOAD_FRAME_MS = 2 * 60_000;

/** Starts one download without navigating the page: the signed URL loads in
 *  its own hidden frame, and the server's attachment header turns the response
 *  into a download. One frame per file, so several downloads never cancel each
 *  other the way chained page navigations do. Takes a URL that has already
 *  passed safeHttpUrl. */
export function downloadInFrame(url: string): void {
  const frame = document.createElement("iframe");
  frame.title = "Download";
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  frame.referrerPolicy = "no-referrer";
  // Off screen rather than display:none, so no engine skips loading it.
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";
  frame.src = url;
  document.body.appendChild(frame);
  window.setTimeout(() => frame.remove(), DOWNLOAD_FRAME_MS);
}
