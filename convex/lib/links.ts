/* Public, shareable links embedded in automated messages (email + SMS). */

export function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

/** Direct pay page for one invoice. Convex ids are unguessable, so the id in
 *  the URL is safe to share. */
export function invoicePayUrl(invoiceId: string): string {
  return `${appUrl()}/pay/invoice/${invoiceId}`;
}

/** A link in a team text to the screen it is about (/brief/<id>, /clock).
 *  Opens in the Pulse app on a phone that has it. Null off a real https host,
 *  so a dev or test deployment never texts anyone a localhost address. */
export function teamLink(path: string): string | null {
  const base = appUrl();
  return base.startsWith("https://") ? `${base}${path}` : null;
}
