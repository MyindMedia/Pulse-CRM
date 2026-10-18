/* The three questions on /booked and what each answer turns into. Kept apart
   from the component so the mapping is testable and every promise in it can be
   checked against what Pulse actually ships (the One Session film shows each). */

/** The Pulse OS Zuops number the demo confirmation and reminder texts come from. */
export const BOOKED_TEXT_NUMBER = "+12132676846";

export const QUESTIONS = [
  {
    id: "rooms",
    title: "How many rooms?",
    options: [
      { id: "1", label: "1 room" },
      { id: "2-3", label: "2 to 3" },
      { id: "4+", label: "4 or more" },
      { id: "mobile", label: "Home or mobile" },
    ],
  },
  {
    id: "today",
    title: "What runs your bookings today?",
    options: [
      { id: "dms", label: "Texts and DMs" },
      { id: "gcal", label: "Google Calendar" },
      { id: "app", label: "A booking app" },
      { id: "sheets", label: "Spreadsheets" },
      { id: "paper", label: "Pen and paper" },
    ],
  },
  {
    id: "pains",
    title: "What costs you the most?",
    options: [
      { id: "noshows", label: "No-shows" },
      { id: "chasing", label: "Chasing payments" },
      { id: "double", label: "Double bookings" },
      { id: "payroll", label: "Payroll and hours" },
      { id: "files", label: "Files before payment" },
      { id: "splits", label: "Split sheets" },
    ],
  },
] as const;

export type Answers = { rooms: string | null; today: string | null; pains: string[] };

const FOCUS: Record<string, { title: string; show: string }> = {
  noshows: { title: "No more no-shows", show: "Deposits at booking and reminder texts that go out on their own." },
  chasing: { title: "Paid without chasing", show: "Pay links and balances that settle before the session ends." },
  double: { title: "One calendar, every room", show: "Live room availability with your Google Calendar synced both ways." },
  payroll: { title: "Payroll that adds itself up", show: "A time clock for staff and payroll built from the hours." },
  files: { title: "Files held until paid", show: "Session files stay locked until the balance clears." },
  splits: { title: "Splits on record", show: "Split sheets drafted from the session and signed online." },
};

export function focusLines(a: Answers) {
  return a.pains.map((p) => FOCUS[p]).filter((f): f is { title: string; show: string } => Boolean(f));
}

function label(q: (typeof QUESTIONS)[number]["id"], id: string | null) {
  return QUESTIONS.find((x) => x.id === q)?.options.find((o) => o.id === id)?.label ?? "";
}

/** The text a studio sends back to the booking thread. No names, no contact details. */
export function briefText(a: Answers) {
  const pains = a.pains.map((p) => label("pains", p)).filter(Boolean).join(", ");
  return `My Pulse demo focus. Rooms: ${label("rooms", a.rooms)}. Bookings today: ${label("today", a.today)}. Biggest cost: ${pains}.`;
}
