/* ============================================================
   Booking message templates (docs/plans/hardcover-booking.md).
   Pure functions: callers pass plain facts, get back an email subject,
   an email body and an SMS body. Sending stays with notify() /
   notifyTeam() so delivery, simulation and logging are unchanged.

   Copy rules: plain and friendly, American spelling, no em dashes,
   never "CRM". SMS bodies stay short (one or two segments).
   ============================================================ */

export type BookingFacts = {
  studioName: string;
  clientName: string;
  roomName?: string;
  engineerName?: string;
  startTime: number;
  endTime: number;
  timeZone?: string; // IANA, defaults to America/Los_Angeles
  address?: string;
  studioPhone?: string;
  notes?: string; // e.g. parking, what to bring
};

export type Message = { subject: string; body: string; sms: string };

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

export function whenText(f: Pick<BookingFacts, "startTime" | "endTime" | "timeZone">): {
  date: string;
  time: string;
} {
  const tz = f.timeZone || "America/Los_Angeles";
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: tz,
  }).format(f.startTime);
  const t = (ms: number) =>
    new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(ms);
  return { date, time: `${t(f.startTime)} to ${t(f.endTime)}` };
}

function detailLines(f: BookingFacts): string[] {
  const { date, time } = whenText(f);
  const lines = [`Date: ${date}`, `Time: ${time}`];
  if (f.roomName) lines.push(`Room: ${f.roomName}`);
  if (f.engineerName) lines.push(`Engineer: ${f.engineerName}`);
  if (f.address) lines.push(`Address: ${f.address}`);
  if (f.studioPhone) lines.push(`Studio phone: ${f.studioPhone}`);
  if (f.notes) lines.push(`Notes: ${f.notes}`);
  return lines;
}

/** To the booker, right after they submit a request. */
export function requestReceived(f: BookingFacts): Message {
  const { date, time } = whenText(f);
  return {
    subject: `Request received: ${f.studioName}, ${date}`,
    body: [
      `Hi ${first(f.clientName)},`,
      "",
      `Thanks for your booking request at ${f.studioName}. It is pending confirmation from the studio, and we'll email and text you as soon as it's reviewed.`,
      "",
      ...detailLines({ ...f, address: undefined, studioPhone: undefined }),
      "",
      "Nothing is charged until the studio confirms.",
    ].join("\n"),
    sms: `${f.studioName}: we got your request for ${date}, ${time}. It's pending confirmation. We'll text you once it's reviewed.`,
  };
}

/** To owners and managers: a new request needs a decision. */
export function newRequestForStaff(f: BookingFacts & { reviewUrl?: string }): Message {
  const { date, time } = whenText(f);
  return {
    subject: `New booking request from ${f.clientName}`,
    body: [
      `${f.clientName} requested a booking. It's holding the slot until you approve or decline it.`,
      "",
      ...detailLines({ ...f, address: undefined, studioPhone: undefined }),
      ...(f.reviewUrl ? ["", `Review it: ${f.reviewUrl}`] : []),
    ].join("\n"),
    sms: `New request: ${f.clientName}, ${date} ${time}${f.roomName ? `, ${f.roomName}` : ""}. Approve or decline in Pulse.`,
  };
}

/** To the booker when an owner or manager approves. */
export function requestApproved(f: BookingFacts): Message {
  const { date, time } = whenText(f);
  return {
    subject: `Confirmed: ${f.studioName}, ${date}`,
    body: [
      `Hi ${first(f.clientName)},`,
      "",
      `You're confirmed at ${f.studioName}. Here are your details:`,
      "",
      ...detailLines(f),
      "",
      "Need to change something? Reply to this email or call the studio.",
    ].join("\n"),
    sms:
      `${f.studioName}: you're confirmed for ${date}, ${time}` +
      (f.roomName ? ` in ${f.roomName}` : "") +
      (f.engineerName ? ` with ${f.engineerName}` : "") +
      (f.address ? `. ${f.address}` : "") +
      ".",
  };
}

/** To the booker when the request is declined. */
export function requestDeclined(f: BookingFacts & { reason?: string }): Message {
  const { date } = whenText(f);
  return {
    subject: `About your request at ${f.studioName}`,
    body: [
      `Hi ${first(f.clientName)},`,
      "",
      `Thanks for thinking of ${f.studioName}. Unfortunately we can't take the booking you requested for ${date}.`,
      ...(f.reason ? ["", f.reason] : []),
      "",
      "We'd love to find another time that works. Reply to this email or send a new request anytime.",
    ].join("\n"),
    sms: `${f.studioName}: sorry, we can't take your request for ${date}. Reply or send a new request and we'll find another time.`,
  };
}

/** To a booking's creator: someone proposed a change. */
export function changeRequested(f: BookingFacts & { requesterName: string; summary: string; reviewUrl?: string }): Message {
  return {
    subject: `${f.requesterName} wants to change ${f.clientName}'s booking`,
    body: [
      `${f.requesterName} proposed a change to a booking you created:`,
      "",
      f.summary,
      "",
      ...detailLines({ ...f, address: undefined, studioPhone: undefined }),
      ...(f.reviewUrl ? ["", `Approve or decline: ${f.reviewUrl}`] : []),
    ].join("\n"),
    sms: `${f.requesterName} wants to change ${f.clientName}'s booking: ${f.summary}. Approve or decline in Pulse.`,
  };
}

/** To the person who proposed a change, once it's decided. */
export function changeDecided(
  f: BookingFacts & { deciderName: string; approved: boolean; summary: string },
): Message {
  const verb = f.approved ? "approved" : "declined";
  return {
    subject: `Change ${verb}: ${f.clientName}'s booking`,
    body: [`${f.deciderName} ${verb} your change:`, "", f.summary].join("\n"),
    sms: `${f.deciderName} ${verb} your change to ${f.clientName}'s booking: ${f.summary}.`,
  };
}
