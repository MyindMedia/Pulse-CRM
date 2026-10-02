/* Pure Outreach rules: no database, no network. Kept separate so the state
   vocabulary, readiness checklist and redaction can be unit tested directly. */

export type CommStatus =
  | "draft" | "approved" | "submitting" | "accepted" | "delivered"
  | "bounced" | "rejected" | "suppressed" | "unknown";

/* "Sent", "accepted", "delivered", "bounced" and "unknown" are different
   claims. The UI shows these plain-language meanings next to every status. */
export const STATUS_MEANING: Record<CommStatus, string> = {
  draft: "Not approved. Nothing has been submitted.",
  approved: "Approved for this exact content and recipient. Not yet submitted.",
  submitting: "Being handed to the email provider right now.",
  accepted: "The provider accepted the message. This is not inbox delivery.",
  delivered: "The provider reports delivery to the recipient's mail server.",
  bounced: "The recipient's mail server rejected the message.",
  rejected: "The provider refused the message before sending.",
  suppressed: "Blocked by an opt-out or suppression rule. Nothing was sent.",
  unknown: "The outcome is ambiguous. Check provider records before any retry.",
};

export const FAILED_STATUSES: ReadonlyArray<CommStatus> = ["bounced", "rejected", "unknown"];

export type ReadinessState = "ready" | "missing" | "disabled";
export type ReadinessItem = { key: string; label: string; state: ReadinessState; detail: string };

export type ReadinessInput = {
  settings: {
    paused: boolean;
    ghlLocationId?: string;
    ghlCalendarId?: string;
    bookingUrl?: string;
    postalAddress?: string;
    testConfirmedAt?: number;
    senders: Array<{ address: string; verified: boolean }>;
  } | null;
  approvedTemplates: number;
  walkthroughEnabled: boolean;
  walkthroughSchemaAudited: boolean;
  emailProviderConfigured?: boolean;
  mode?: "test_only" | "live";
};

export function readiness(i: ReadinessInput): ReadinessItem[] {
  const s = i.settings;
  const verifiedSender = s?.senders.find((x) => x.verified);
  return [
    {
      key: "provider_mapping",
      label: "Provider mapping",
      state: s?.ghlLocationId && s.ghlCalendarId ? "ready" : "missing",
      detail: s?.ghlLocationId && s.ghlCalendarId
        ? "Calendar and location are mapped to this agency by an operator."
        : "No verified calendar or location is mapped to this agency yet.",
    },
    {
      key: "sender",
      label: "Verified sender",
      state: verifiedSender ? "ready" : "missing",
      detail: verifiedSender
        ? `Sending identity ${verifiedSender.address} is marked verified.`
        : "No sending identity has been verified for this agency.",
    },
    {
      key: "template",
      label: "Approved template",
      state: i.approvedTemplates > 0 ? "ready" : "missing",
      detail: i.approvedTemplates > 0
        ? `${i.approvedTemplates} approved template(s).`
        : "No template has been approved.",
    },
    {
      key: "booking_link",
      label: "Booking link",
      state: s?.bookingUrl ? "ready" : "missing",
      detail: s?.bookingUrl ? s.bookingUrl : "No verified booking link is configured.",
    },
    {
      key: "postal_address",
      label: "Postal address (CAN-SPAM)",
      state: s?.postalAddress ? "ready" : "missing",
      detail: s?.postalAddress ? "A business mailing address is set for the email footer." : "No business mailing address is set. Required in every email footer before any approval.",
    },
    {
      key: "owner_test",
      label: "Owner test confirmed",
      state: s?.testConfirmedAt ? "ready" : "missing",
      detail: s?.testConfirmedAt ? "You confirmed a test email landed and looked right." : "No owner test has been confirmed. Prospect emails cannot be approved until one is.",
    },
    {
      key: "email_provider",
      label: "Email provider (Resend)",
      state: i.emailProviderConfigured ? "ready" : "missing",
      detail: i.emailProviderConfigured ? "A sending key is configured on the server. The value is never shown." : "No Resend key is configured on the server, so nothing can send.",
    },
    {
      key: "live_sending",
      label: "Live sending",
      state: i.mode === "live" ? "ready" : "disabled",
      detail: i.mode === "live" ? "On. Every email still needs your approval and a Send click." : "Off. Approved emails cannot be sent until an owner turns live sending on.",
    },
    {
      key: "calling",
      label: "Automatic calling",
      state: i.walkthroughEnabled && i.walkthroughSchemaAudited ? "ready" : "disabled",
      detail: i.walkthroughEnabled && i.walkthroughSchemaAudited
        ? "The walkthrough integration reports itself enabled."
        : "Off. The walkthrough integration is disabled and its provider schema is not audited.",
    },
    {
      key: "pause",
      label: "Outreach pause",
      state: s?.paused === false ? "ready" : "disabled",
      detail: s?.paused === false ? "Not paused." : "Paused. No outbound action will run.",
    },
  ];
}

/* Free-text that reaches the browser or an audit row must not carry
   credentials. Strips bearer tokens, Resend-style keys and long hex/base64 runs. */
export function redact(text: string | undefined, max = 300): string | undefined {
  if (text === undefined) return undefined;
  return text
    .replace(/Bearer\s+[A-Za-z0-9._\-~+/]+=*/gi, "Bearer [redacted]")
    .replace(/\bre_[A-Za-z0-9_]{8,}\b/g, "[redacted]")
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, "[redacted]")
    .slice(0, max);
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length < 4 ? "unknown" : `••• ${digits.slice(-2)}`;
}

/* Why an automatic call is, or is not, possible. Never turns unknown
   consent into a yes. */
export function callEligibility(a: {
  consent: boolean;
  dnd: boolean;
  suppressed: boolean;
  callId?: string;
  status: string;
}, walkthroughEnabled: boolean): { state: "disabled" | "ineligible" | "eligible" | "called"; reason: string } {
  if (a.callId) return { state: "called", reason: "A call was registered for this appointment." };
  if (!walkthroughEnabled) return { state: "disabled", reason: "Automatic calling is off." };
  if (a.status === "cancelled") return { state: "ineligible", reason: "Appointment is cancelled." };
  if (!a.consent) return { state: "ineligible", reason: "No explicit phone consent. The booking still stands." };
  if (a.dnd) return { state: "ineligible", reason: "Do-not-disturb is set." };
  if (a.suppressed) return { state: "ineligible", reason: "Suppressed pending review." };
  return { state: "eligible", reason: "Consent is Yes and no block is set." };
}

const TERMINAL: ReadonlyArray<CommStatus> = ["delivered", "bounced", "rejected", "suppressed"];

/* Forward-only lifecycle. A terminal status never changes, and "unknown" can
   only be resolved by a deliberate reconciliation to a different status. */
export function canTransition(from: CommStatus, to: CommStatus): boolean {
  if (from === to) return false;
  if (TERMINAL.includes(from)) return false;
  if (to === "draft") return false;
  return true;
}

/** What must be true before an owner may switch live sending on. */
export function liveBlockers(i: {
  postalAddress?: string; testConfirmedAt?: number; senders: Array<{ verified: boolean }>; approvedTemplates: number; emailProviderConfigured: boolean;
}): string[] {
  const out: string[] = [];
  if (!i.postalAddress) out.push("Set the business mailing address");
  if (!i.testConfirmedAt) out.push("Confirm an owner test email");
  if (!i.senders.some((s) => s.verified)) out.push("Verify a sending identity");
  if (i.approvedTemplates < 1) out.push("Approve a template");
  if (!i.emailProviderConfigured) out.push("Configure the Resend key on the server");
  return out;
}
