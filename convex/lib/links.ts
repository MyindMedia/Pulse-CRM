/* Public, shareable links embedded in automated messages (email + SMS). */

export function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

/** Direct pay page for one invoice. Convex ids are unguessable, so the id in
 *  the URL is safe to share. */
export function invoicePayUrl(invoiceId: string): string {
  return `${appUrl()}/pay/invoice/${invoiceId}`;
}
