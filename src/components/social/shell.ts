/* Whether Pulse is running inside the desktop shell rather than a browser.
 *
 * The shell's injected script stamps `pulse-shell` on <html> before any page
 * script runs (`pulse-desktop/src-tauri/src/lib.rs`, INIT_SCRIPT). It is the
 * only signal the shell offers and it is a deliberate one, so it is the right
 * thing to read - the user agent is a WKWebView string that says nothing
 * specific to Pulse.
 *
 * It matters for exactly one thing today: the shell replaces `window.open`
 * with a shim that hands the URL to the system browser and ALWAYS returns
 * null. Pulse reads that null as "the browser blocked our popup," which is not
 * what happened and sends the owner off to change a setting that was never the
 * problem.
 *
 * Split in two because this suite runs on edge-runtime with no DOM: the
 * predicate is pure and tested, and the DOM read is the one line around it. */
type ClassHolder = { classList: { contains(token: string): boolean } };

export function isShellDocument(root: ClassHolder | null | undefined): boolean {
  return Boolean(root?.classList?.contains("pulse-shell"));
}

export function inDesktopShell(): boolean {
  if (typeof document === "undefined") return false;
  return isShellDocument(document.documentElement);
}

/* The reason a connect cannot be finished from the shell.
 *
 * OAuth here is a popup handshake: GHL's finish page posts its result back to
 * `window.opener` and closes itself. The shell has no opener to post to - the
 * URL was handed to a separate application - so the finish page renders
 * nothing and sits there, which is exactly what the owner sees. That is not a
 * setting they can change, so the message must not offer them one. */
export const SHELL_CONNECT_MESSAGE =
  "Connecting an account has to be done in a web browser. The desktop app hands " +
  "the sign-in to your browser and never gets the answer back. Open Pulse in your " +
  "browser, connect the account there, and it will appear here.";
