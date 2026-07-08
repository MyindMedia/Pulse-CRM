/* Classify Clerk Backend API create-user failures so the invite flow can act
   on WHICH identifier collided. Clerk returns form_identifier_exists for both
   a taken email and a taken phone; conflating them told invitees "you already
   have an account" when it was really their phone number sitting on someone
   else's account (e.g. an owner pre-filling their own cell on a staff invite).
   Never surface the raw body - it can echo the identifier back to an
   unauthenticated caller. */

export type ClerkCreateUserError = {
  kind: "email_exists" | "phone_exists" | "other";
  /** Clerk's own actionable message (safe to show), or a generic fallback. */
  message: string;
};

type ClerkErrorBody = {
  errors?: { code?: string; message?: string; long_message?: string; meta?: { param_name?: string } }[];
};

export function classifyClerkCreateUserError(body: string): ClerkCreateUserError {
  let first: NonNullable<ClerkErrorBody["errors"]>[number] | undefined;
  try {
    first = (JSON.parse(body) as ClerkErrorBody).errors?.[0];
  } catch {
    // non-JSON body
  }
  const message = first?.long_message ?? first?.message ?? "Account creation failed.";
  const exists =
    first?.code === "form_identifier_exists" || /already exists|taken|duplicate/i.test(body);
  if (!exists) return { kind: "other", message };
  const param = first?.meta?.param_name ?? "";
  if (param === "phone_number" || (!param && /phone/i.test(message))) {
    return { kind: "phone_exists", message };
  }
  return { kind: "email_exists", message };
}
