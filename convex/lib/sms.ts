/* Outbound SMS. Provider-agnostic: SMS_PROVIDER picks the driver ("twilio" by
   default, "telnyx" supported). Returns a status string so callers can record
   it. No-ops to "simulated" when unconfigured - so the whole SMS layer ships
   and runs before any provider account / A2P registration exists (mirrors the
   Resend email + Stripe rollout). */
import { stripEmDashes } from "./text";

export type SmsStatus = "sent" | "failed" | "simulated";

export async function sendSms(args: { to: string; body: string }): Promise<SmsStatus> {
  const provider = (process.env.SMS_PROVIDER ?? "twilio").toLowerCase();
  // Egress guard: no em dashes in any outbound message, whatever the source.
  const payload = { to: args.to, body: stripEmDashes(args.body) };
  if (provider === "loopmessage") return sendLoopMessage(payload);
  if (provider === "telnyx") return sendTelnyx(payload);
  if (provider === "ghl") return sendGhl(payload);
  return sendTwilio(payload);
}

/** GHL (LeadConnector): rides the Myind Sound location's number + existing A2P
 *  registration. GHL can only message a contact, so each send upserts the
 *  recipient into the location first (tagged pulse-sms to keep the CRM
 *  filterable). GHL_FROM_NUMBER optional - defaults to the location's default
 *  number. */
async function sendGhl({ to, body }: { to: string; body: string }): Promise<SmsStatus> {
  const key = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  const fromNumber = process.env.GHL_FROM_NUMBER;
  if (!key || !locationId) return "simulated";
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    // GHL's Cloudflare rejects non-browser default user agents (error 1010).
    "User-Agent": "Pulse/1.0 (+https://studiopulse.tech)",
  };
  try {
    const upsert = await fetch("https://services.leadconnectorhq.com/contacts/upsert", {
      method: "POST",
      headers: { ...headers, Version: "2021-07-28" },
      body: JSON.stringify({ locationId, phone: to, tags: ["pulse-sms"] }),
    });
    if (!upsert.ok) return "failed";
    const contactId = ((await upsert.json()) as { contact?: { id?: string } }).contact?.id;
    if (!contactId) return "failed";
    const res = await fetch("https://services.leadconnectorhq.com/conversations/messages", {
      method: "POST",
      headers: { ...headers, Version: "2021-04-15" },
      body: JSON.stringify({
        type: "SMS",
        contactId,
        message: body,
        ...(fromNumber ? { fromNumber } : {}),
      }),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

/** LoopMessage: blue-bubble iMessage with automatic SMS fallback (no A2P 10DLC
 *  for the iMessage path). We omit `channel` so Loop picks iMessage when the
 *  contact supports it and falls back to SMS otherwise. Set LOOPMESSAGE_SANDBOX
 *  to send test messages (simulated webhooks, no charge). */
async function sendLoopMessage({ to, body }: { to: string; body: string }): Promise<SmsStatus> {
  const key = process.env.LOOPMESSAGE_API_KEY;
  const secret = process.env.LOOPMESSAGE_SECRET_KEY; // some accounts require a 2nd key
  const sender = process.env.LOOPMESSAGE_SENDER; // sender-name id, or the sandbox sender
  if (!key) return "simulated";
  // A sandbox-only account (no production sender ordered yet) routes through
  // sandbox automatically - no flag needed. Endpoint override lets us point at
  // a dedicated sandbox URL if the account requires one.
  const endpoint = process.env.LOOPMESSAGE_ENDPOINT ?? "https://a.loopmessage.com/api/v1/message/send/";
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: key,
        ...(secret ? { "Loop-Secret-Key": secret } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contact: to,
        text: body,
        ...(sender ? { sender } : {}),
      }),
    });
    if (!res.ok) return "failed";
    const json = (await res.json().catch(() => ({}))) as { success?: boolean };
    return json.success === false ? "failed" : "sent";
  } catch {
    return "failed";
  }
}

async function sendTwilio({ to, body }: { to: string; body: string }): Promise<SmsStatus> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const messagingService = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || (!messagingService && !from)) return "simulated";

  const params = new URLSearchParams();
  params.set("To", to);
  if (messagingService) params.set("MessagingServiceSid", messagingService);
  else params.set("From", from!);
  params.set("Body", body);

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

async function sendTelnyx({ to, body }: { to: string; body: string }): Promise<SmsStatus> {
  const key = process.env.TELNYX_API_KEY;
  const from = process.env.TELNYX_FROM_NUMBER; // or a messaging profile's number
  if (!key || !from) return "simulated";
  try {
    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, text: body }),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
