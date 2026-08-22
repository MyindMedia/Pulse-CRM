/* ============================================================
   Clerk allowlist.

   The production Clerk instance runs with restrictions.allowlist ENABLED,
   which means an identifier that is not on the list cannot create an
   account at all - the sign-up form answers "<email> is not allowed to
   access this application" and there is nothing the person can do about it.

   That gate is worth keeping while the product is invite-only, but the app
   has to hold up its end: anyone we invite, convert or take money from must
   be added to the list at the moment we invite them, not by hand afterwards.
   The first beta owner to hit this was locked out with a signed agreement
   and a welcome email in his inbox.

   Failure is deliberately soft. An invite that was created and emailed is
   not undone by a Clerk hiccup, and the identifier can be added by hand; a
   thrown error here would roll back the useful work and lose the code.
   ============================================================ */

export type AllowResult = "added" | "already" | "skipped" | "failed";

/** Put one email address or phone number on the Clerk allowlist. Safe to
 *  call repeatedly - a duplicate is success, not an error. */
export async function allowClerkIdentifier(identifier: string): Promise<AllowResult> {
  const secret = process.env.CLERK_SECRET_KEY;
  const id = identifier?.trim();
  if (!secret || !id) return "skipped";

  try {
    const res = await fetch("https://api.clerk.com/v1/allowlist_identifiers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      // notify:false - they already have our invite; Clerk's own mail would
      // be a second, confusing one.
      body: JSON.stringify({ identifier: id, notify: false }),
    });
    if (res.ok) return "added";

    const body = await res.text();
    // Already on the list. Clerk answers 400 duplicate_record; the caller
    // wanted the identifier allowed, and it is.
    if (body.includes("duplicate_record")) return "already";

    console.error(`clerk allowlist ${res.status} for ${id}: ${body.slice(0, 200)}`);
    return "failed";
  } catch (err) {
    console.error(`clerk allowlist threw for ${id}: ${String(err)}`);
    return "failed";
  }
}
