/* ============================================================
   Jev (TypeSafe System One) questions for Pulse. Pure: no SDK, no I/O, so
   the exact questions and thresholds are unit-testable and the same objects
   go to Jev from every caller. Docs: https://docs.typesafe.ai/primitives/noul.md

   Receptionist intent: the two yes/no judgments the SMS receptionist gates
   on (convex/receptionist.ts). The definitions mirror the Claude classifier's
   prompt so a shadow comparison measures the model, not a changed question.
   ============================================================ */
import type { NoulQuestion } from "@typesafe-ai/sdk";

export const RECEPTIONIST_QUESTIONS = {
  bookingInquiry: {
    type: "noul",
    instructions:
      "Is the person asking about booking the recording studio: availability, rates or prices, studio time, or scheduling a session (recording, mixing, mastering, production)?",
    criteria: {
      true: "They ask about availability, rates, prices, booking, or studio time, in any language.",
      false: "Small talk, thanks, logistics for a session already booked, wrong numbers, or a complaint without a booking question.",
    },
  },
  wantsHuman: {
    type: "noul",
    instructions:
      "Does the person explicitly want a human to call or reply, or is this a complaint, refund request, or urgent matter?",
    criteria: {
      true: "Asks for a call back, a real person, the owner or a manager; or complains, asks for a refund, or says it is urgent or an emergency.",
      false: "A routine question or message that an automatic reply with the booking link could answer.",
    },
  },
} satisfies Record<string, NoulQuestion>;

/** The state Jev evaluates: the inbound text as data, never as instructions. */
export function receptionistState(body: string, studioName?: string | null) {
  return {
    channel: "SMS text from a client to a recording studio",
    ...(studioName ? { studio: studioName } : {}),
    message: body,
  };
}

/** Threshold Jev's probabilities into the receptionist's two booleans. 0.5 is
 *  the neutral starting point; the shadow log is what tunes it. */
export function jevIntent(
  answers: { bookingInquiry: { noul: number }; wantsHuman: { noul: number } },
  threshold = 0.5,
): { isBookingInquiry: boolean; wantsHuman: boolean } {
  const wantsHuman = answers.wantsHuman.noul >= threshold;
  // Same precedence as the heuristic: a human request outranks a booking one.
  const isBookingInquiry = !wantsHuman && answers.bookingInquiry.noul >= threshold;
  return { isBookingInquiry, wantsHuman };
}
