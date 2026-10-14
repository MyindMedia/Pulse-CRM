/** Where an activity / insight row about an entity opens. Only entities with a
 *  real detail page get `/<route>/<id>`: a session opens its sheet on the
 *  calendar (there is no /calendar/[id] page), a pipeline deal opens the board. */
export function entityHref(entityType: string | undefined, entityId: string | undefined): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case "session":
      return `/calendar?session=${encodeURIComponent(entityId)}`;
    case "artist":
      return `/roster/${entityId}`;
    case "song":
      return `/songs/${entityId}`;
    case "invoice":
      return `/payments/${entityId}`;
    case "opportunity":
      return "/pipeline";
    default:
      return null;
  }
}
