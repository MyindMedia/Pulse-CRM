/* Outbound SMS. Provider-agnostic: SMS_PROVIDER picks the driver ("twilio" by
   default, "telnyx" supported). Returns a status string so callers can record
   it. No-ops to "simulated" when unconfigured — so the whole SMS layer ships
   and runs before any provider account / A2P registration exists (mirrors the
   Resend email + Stripe rollout). */
export type SmsStatus = "sent" | "failed" | "simulated";

export async function sendSms(args: { to: string; body: string }): Promise<SmsStatus> {
  const provider = (process.env.SMS_PROVIDER ?? "twilio").toLowerCase();
  return provider === "telnyx" ? sendTelnyx(args) : sendTwilio(args);
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
