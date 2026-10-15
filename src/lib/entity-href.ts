/** The single map from "an entity the app shows" to "where clicking it lands".
 *  Only entities with a real detail page get `/<route>/<id>`:
 *  - a session (booking) opens its sheet in place on any page through the
 *    `?session=<id>` param (the shell mounts one global sheet). With no page
 *    to open it on, it falls back to the calendar, which reads the same param.
 *  - a pipeline deal opens its sheet on the board (`/pipeline?deal=<id>`).
 *  - a team member has no detail page, so it lands on Settings > Team. */

export type EntityType =
  | "session"
  | "booking"
  | "artist"
  | "client"
  | "song"
  | "invoice"
  | "payment"
  | "project"
  | "room"
  | "opportunity"
  | "deal"
  | "member";

export const SESSION_PARAM = "session";

/** The query string (with a leading "?", or "" when empty) after setting or
 *  clearing the session param. Every other param is kept, in order. */
export function withSessionParam(search: string, sessionId: string | null): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (sessionId) params.set(SESSION_PARAM, sessionId);
  else params.delete(SESSION_PARAM);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Where a session opens. With the current location it opens in place
 *  (same page, the global sheet reads the param); without one it opens on the
 *  calendar, which handles the same param on first load. */
export function sessionHref(
  sessionId: string,
  here?: { pathname: string; search?: string },
): string {
  if (!here) return `/calendar${withSessionParam("", sessionId)}`;
  return `${here.pathname}${withSessionParam(here.search ?? "", sessionId)}`;
}

export function entityHref(
  entityType: string | undefined,
  entityId: string | undefined | null,
  here?: { pathname: string; search?: string },
): string | null {
  if (!entityType || !entityId) return null;
  const id = encodeURIComponent(entityId);
  switch (entityType) {
    case "session":
    case "booking":
      return sessionHref(entityId, here);
    case "artist":
    case "client":
      return `/roster/${id}`;
    case "song":
      return `/songs/${id}`;
    case "invoice":
    case "payment":
      return `/payments/${id}`;
    case "project":
      return `/projects/${id}`;
    case "room":
      return `/studio/${id}`;
    case "opportunity":
    case "deal":
      return `/pipeline?deal=${id}`;
    case "member":
      return "/settings?tab=team";
    default:
      return null;
  }
}
