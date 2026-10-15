import { forwardGoogleCallback } from "@/lib/google-callback";

export const dynamic = "force-dynamic";

/** studiopulse.tech/google/callback: the redirect URI Google sees, for both the
 *  studio connect and a team member's personal calendar. */
export async function GET(req: Request) {
  return forwardGoogleCallback(req);
}
