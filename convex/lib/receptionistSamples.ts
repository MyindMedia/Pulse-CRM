/* Labeled sample texts for the receptionist intent replay (jev.replayReceptionist).
   Written for Pulse, not taken from any client: a staging deployment receives
   no real inbound texts, so these give an immediate, repeatable comparison of
   the live classifier and Jev on the action a client would experience.
   expected: "booking" = send the booking link, "human" = hand to the team,
   "skip" = stay quiet. */
export type ReceptionistSample = { text: string; expected: "booking" | "human" | "skip" };

export const RECEPTIONIST_SAMPLES: ReceptionistSample[] = [
  // Booking questions
  { text: "Hey do you have any studio time this Saturday?", expected: "booking" },
  { text: "How much for a 4 hour session?", expected: "booking" },
  { text: "Can I book mixing for 3 songs next week?", expected: "booking" },
  { text: "what are your rates for mastering an EP", expected: "booking" },
  { text: "Is the vocal booth open tonight around 8?", expected: "booking" },
  { text: "Looking to record a demo, what's availability like this month?", expected: "booking" },
  { text: "Can we lock in Thursday 2 to 6pm?", expected: "booking" },
  { text: "hola, tienen disponibilidad para grabar el viernes?", expected: "booking" },
  { text: "Need a producer session next Tuesday, how do I book", expected: "booking" },
  { text: "Do you do podcast recording? What does it cost?", expected: "booking" },
  // Wants a person, complaints, urgent
  { text: "Can someone call me back about my session?", expected: "human" },
  { text: "I want a refund, the engineer never showed up", expected: "human" },
  { text: "This is urgent, I left my hard drive in Studio B", expected: "human" },
  { text: "I need to talk to the owner", expected: "human" },
  { text: "Please have a manager call me today", expected: "human" },
  { text: "My card got charged twice, call me asap", expected: "human" },
  { text: "Can I speak with a real person instead of a bot?", expected: "human" },
  { text: "I'm really unhappy with how my mix came out", expected: "human" },
  // Small talk, logistics, noise
  { text: "Thanks!", expected: "skip" },
  { text: "ok cool", expected: "skip" },
  { text: "See you tomorrow", expected: "skip" },
  { text: "lol that session was fire", expected: "skip" },
  { text: "Running 10 min late", expected: "skip" },
  { text: "Got the files, thank you", expected: "skip" },
  { text: "Who is this?", expected: "skip" },
  { text: "Wrong number sorry", expected: "skip" },
  { text: "Happy new year!", expected: "skip" },
  { text: "Parking was easy, I'm here", expected: "skip" },
];
