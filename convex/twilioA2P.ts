"use node";

import { internalAction } from "./_generated/server";

/* ============================================================
   Cloud-side A2P 10DLC finisher. Runs on a Convex cron so the
   registration completes without a local terminal: it polls the
   Standard A2P profile, registers the brand once approved, then
   creates the Account-Notification campaign once the brand clears.
   Idempotent - safe to run repeatedly; no-ops once the campaign
   exists. Uses the Twilio creds already in Convex env.
   ============================================================ */

const STD_A2P_BUNDLE = "BUacefea86af751359c4bb468a98fbc483"; // Standard A2P profile
const CUSTOMER_PROFILE = "BUef5b85a82ce15f958c8780d33b2f1b1b"; // approved business profile
const MESSAGING_SERVICE = "MG527a5e03f64f39e27179412b6039ea39"; // holds +12138232720

function auth(): string | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return null;
  return "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64");
}

async function tw(method: "GET" | "POST", url: string, form?: Record<string, string>) {
  const a = auth();
  if (!a) throw new Error("Twilio creds not configured");
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: a,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/** Advance the A2P registration by one step. Returns a status string (logged). */
export const advance = internalAction({
  args: {},
  handler: async (): Promise<string> => {
    if (!auth()) return "no-twilio-creds";

    // 1. Standard A2P profile must be twilio-approved.
    const profile = await tw("GET", `https://trusthub.twilio.com/v1/TrustProducts/${STD_A2P_BUNDLE}`);
    if (profile.status !== "twilio-approved") {
      const s = `profile:${profile.status}`;
      console.log("[a2p]", s);
      return s;
    }

    // 2. Find or register the Standard brand backed by our profile.
    const brands = (await tw("GET", "https://messaging.twilio.com/v1/a2p/BrandRegistrations")) as {
      data?: Array<{ sid: string; status: string; a2p_profile_bundle_sid: string; failure_reason?: string }>;
    };
    let brand = brands.data?.find((b) => b.a2p_profile_bundle_sid === STD_A2P_BUNDLE);
    if (!brand) {
      const created = await tw("POST", "https://messaging.twilio.com/v1/a2p/BrandRegistrations", {
        CustomerProfileBundleSid: CUSTOMER_PROFILE,
        A2PProfileBundleSid: STD_A2P_BUNDLE,
        BrandType: "STANDARD",
        SkipAutomaticSecVet: "true",
      });
      const s = `brand-registered:${created.status}`;
      console.log("[a2p]", s, created.sid);
      return s;
    }
    if (brand.status === "FAILED") {
      const s = `brand-failed:${brand.failure_reason}`;
      console.log("[a2p]", s);
      return s;
    }
    if (brand.status !== "APPROVED" && brand.status !== "REGISTERED") {
      const s = `brand:${brand.status}`;
      console.log("[a2p]", s);
      return s;
    }

    // 3. Brand is good - create the campaign if it doesn't exist yet.
    const camp = await tw(
      "GET",
      `https://messaging.twilio.com/v1/Services/${MESSAGING_SERVICE}/Compliance/Usa2p`,
    );
    if (camp.sid) {
      const s = `done:campaign-${camp.campaign_status ?? "exists"}`;
      console.log("[a2p]", s);
      return s;
    }
    const newCamp = await tw(
      "POST",
      `https://messaging.twilio.com/v1/Services/${MESSAGING_SERVICE}/Compliance/Usa2p`,
      {
        BrandRegistrationSid: brand.sid,
        Description:
          "Outbound appointment and booking reminders, schedule changes, and account updates from Myind Media LLC (Pulse studio software) to studio clients and team members who provided their mobile number.",
        MessageFlow:
          "Studio clients provide their mobile number when booking a session on the studio's Pulse booking page and agree to appointment texts; team members provide their number during staff onboarding. Consent is per studio. Every message identifies the sender and includes STOP to opt out and HELP.",
        MessageSamples:
          "Pulse: Reminder - your session at Slang City is Fri Jun 20 at 2:00 PM. Reply STOP to opt out.",
        UsAppToPersonUsecase: "ACCOUNT_NOTIFICATION",
        HasEmbeddedLinks: "true",
        HasEmbeddedPhone: "true",
      },
    );
    const s = `campaign-created:${newCamp.campaign_status ?? newCamp.code ?? "ok"}`;
    console.log("[a2p]", s, newCamp.message ?? "");
    return s;
  },
});
