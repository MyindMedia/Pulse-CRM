/* The selling half of /mypulse.
 *
 * Built on NEPQ (Neuro-Emotional Persuasion Questioning). The method is NOT
 * named anywhere a reader sees, on purpose: reps do not need the label and it
 * is not ours to teach. These comments are for whoever maintains the file.
 * The rep asks
 * questions, the buyer talks themselves into it, and nobody argues. Nothing
 * in OBJECTIONS below is a rebuttal. Each one gets three questions instead:
 * clarify what they actually mean, discuss what it is costing them in their
 * own numbers, then diffuse by asking whether the worry would remain if it
 * went away. Every diffuse leaves a real, dignified way to say no.
 *
 * Same plain-language rules as features.ts. A rep says these out loud, so
 * every line is short, ordinary words, one idea at a time. American spelling.
 *
 * NOTE for whoever edits this next: this is written from the NEPQ framework,
 * not transcribed from the Black Book. If the book is added to the reference
 * library, check the question banks against it. Two things here are general
 * communication advice rather than NEPQ doctrine and are marked as such. */

/* ---- How the call runs ------------------------------------------------- */

export type Stage = {
  n: number;
  title: string;
  /** What this stage is for, in one sentence. */
  goal: string;
  /** Something the rep can say word for word. */
  say: string;
};

export const STAGES: Stage[] = [
  {
    n: 1,
    title: "Take the pressure off",
    goal: "The first ten seconds decide the call. Say who you are, admit you interrupted them, and ask permission. Say it slower than feels natural.",
    say: "Hey, this is [name]. I will be honest, you were not expecting my call. I work with recording studios on the booking and deposit side. I do not know yet whether there is anything here for you. Can I ask you two quick things, and then we will both know?",
  },
  {
    n: 2,
    title: "Find out how it works today",
    goal: "Get the plain facts before you get anywhere near an opinion. You are collecting facts. Do not start selling yet.",
    say: "Walk me through what happens from someone messaging you to them being in the room.",
  },
  {
    n: 3,
    title: "Let them say what is broken",
    goal: "Most of the call happens here. Do not name their problem for them. Ask, then stay on the same problem and ask again. People believe what they say.",
    say: "What do you do about deposits?",
  },
  {
    n: 4,
    title: "Let them describe the fix",
    goal: "Once they have said what hurts, get them to describe how they want it to work instead. Their answer tells you exactly what to show them later.",
    say: "If you could change one thing about how the place runs, what would it be?",
  },
  {
    n: 5,
    title: "Ask what happens if nothing changes",
    goal: "People buy when they can see it getting worse. Get them to say the cost out loud, in their own numbers. Ask this one with concern in your voice, then stop talking.",
    say: "If this carries on the same way for another year, where does that leave you?",
  },
  {
    n: 6,
    title: "Find out how they decide",
    goal: "Ask this before you show anything. Money, who else is involved, and when. Skipping it is what produces I need to think about it and I need to talk to my partner later on.",
    say: "Walk me through how a decision like this usually gets made there.",
  },
  {
    n: 7,
    title: "Ask permission to show them",
    goal: "Do not start demoing because you ran out of questions. Ask first. This is the only thing this step does.",
    say: "Would you be opposed to seeing what that would look like on your own numbers?",
  },
  {
    n: 8,
    title: "Show them what they asked for, then ask for the step",
    goal: "Show the two or three things they told you were broken. Anything else you demo gives them one more thing to argue with. Then ask how they feel about it before you ask for anything.",
    say: "How do you feel this could help your situation? ... And what do you feel your next step should be?",
  },
];

/* ---- The way you say it ------------------------------------------------ */

export const TONE: { rule: string; why: string }[] = [
  {
    rule: "Sound curious, not confident.",
    why: "A confident voice sounds like a salesperson and people push back on salespeople. A curious voice sounds like someone trying to work something out, and people help.",
  },
  {
    rule: "Sound puzzled when you clarify.",
    why: "How do you mean, said flat, is an interrogation. Said with a bit of confusion in it, the same words are disarming and they explain themselves.",
  },
  {
    rule: "Sound concerned when you ask what it is costing them.",
    why: "Curiosity is the wrong tone for how is that affecting you. Curious sounds nosy. Concerned sounds like you care what they answer.",
  },
  {
    rule: "Let your voice drop at the end of a question.",
    why: "Going up at the end sounds like you want something. Going down sounds like you are thinking.",
  },
  {
    rule: "Slow down, most of all in the first fifteen seconds.",
    why: "Speed sounds like a script. People decide whether you are a salesperson before they have heard what you sell.",
  },
  {
    rule: "Say their last few words back to them.",
    why: "Repeat their final phrase with a little question in it and they carry on explaining. It costs you nothing and it saves a question.",
  },
  {
    rule: "Never say but.",
    why: "The word but tells them you were waiting for your turn to speak. Say I am curious instead.",
  },
  {
    rule: "When they stop talking, wait.",
    why: "Count two seconds. Most people carry on, and the second half of the answer is usually the honest one.",
  },
  {
    rule: "Never defend the product.",
    why: "Defending turns the call into an argument, and arguments lose sales.",
  },
  {
    rule: "Do not need the sale.",
    why: "Pressure makes people resist. They hear need in your voice before they hear what you are selling, so the calls you are willing to lose are the ones that close.",
  },
];

/* ---- The story you tell instead of a claim ----------------------------- */

export const STORY = {
  why: "Nobody argues with a story about somebody else. A claim from you is a sales claim. The same fact inside another studio's story is just a fact. Say the situation, what they were doing, what changed, and one number. Then hand it straight back and stop talking.",
  script:
    "There is a studio in [city], two rooms, same setup you have got, a calendar and a group chat. They were losing three or four Saturday hours a month to people who just did not show. They started taking a card at booking. Last month they lost none, and the two that did cancel got refilled off the waiting list before they had noticed. I am not sure that is even your situation, which is why I asked.",
};

/* ---- The one rule about price ------------------------------------------ */

export const PRICE_RULE = {
  rule: "Never answer a price question with a number too early, and never answer a discount request with a number at all.",
  onACall:
    "If they ask what it costs before you know anything: It depends on how many rooms you have got and whether you want the deposits side. Can I ask you two things first, so I give you a real number instead of a made-up one?",
  onADiscount:
    "If they ask you to come down: What did you have in mind? ... How did you land on that? ... If the price stayed where it is and it still paid for itself out of the sessions people miss, would the number still be the thing?",
};

/* ---- Question bank ----------------------------------------------------- */

export type QuestionSet = { stage: string; blurb: string; questions: string[] };

export const QUESTIONS: QuestionSet[] = [
  {
    stage: "How it works today",
    blurb: "Ask for facts before you ask for opinions. One question, then silence.",
    questions: [
      "How are you taking bookings at the moment?",
      "Walk me through what happens from someone messaging you to them being in the room.",
      "How many rooms are you running?",
      "And who else works there?",
      "What do you do about deposits?",
      "Who picks up the phone when you are in a session?",
      "How long have you been doing it that way?",
    ],
  },
  {
    stage: "What is broken",
    blurb: "Keep asking until they say it out loud. Do not say it for them. When they name something, stay on it and ask the follow-ups before you move on.",
    questions: [
      "When you look at how bookings run now, what would you change, if anything?",
      "What happens when somebody does not turn up?",
      "Roughly how often is that in a month?",
      "What are you using to see how each room is doing?",
      "And how is that working for you?",
      "When someone owes you money, who chases it?",
      "And how long does that usually take?",
      "What part of running the place do you dread?",
      "How much of your week ends up on the admin side?",
      "And what is that time coming out of?",
      "Follow-up on anything they name: how long has that been going on?",
      "Follow-up: has it got better or worse?",
      "Follow-up: what have you done about it so far?",
    ],
  },
  {
    stage: "What better looks like",
    blurb: "Now they describe the product for you. Write down the words they use.",
    questions: [
      "If you could change one thing about how the place runs, what would it be?",
      "What would have to happen for you to feel like it was under control?",
      "What have you tried so far to fix it?",
      "And how did that work out?",
      "What would that free you up to do instead?",
      "What have you already ruled out, and why?",
    ],
  },
  {
    stage: "What it costs to do nothing",
    blurb: "Ask these gently, then stop talking. Only ask back a goal they actually gave you.",
    questions: [
      "If this carries on the same way for another year, where does that leave you?",
      "How is that affecting you, and not just the business?",
      "You mentioned wanting [the thing they said]. What does this do to that?",
      "If you added it up over a year, what do you think the missed sessions come to?",
      "How much longer are you willing to run it this way?",
    ],
  },
  {
    stage: "How they decide",
    blurb: "Ask this before you show anything. It is what stops I need to think about it turning up at the end.",
    questions: [
      "Walk me through how a decision like this usually gets made there.",
      "Who else would want a look at it before anything happened?",
      "What have you spent on fixing this so far?",
      "If you did decide to change something, when would you want it running by?",
      "What would have to be true for this to be worth doing at all?",
    ],
  },
  {
    stage: "Asking to show them, and asking for the step",
    blurb: "Steps 7 and 8. The first two come before the demo, the rest after it.",
    questions: [
      "Would you be opposed to seeing what that looks like on your own numbers?",
      "Before I show you anything, what would you most want to see?",
      "After the demo: how do you feel this could help your situation?",
      "After the demo: what do you feel your next step should be?",
      "If it did everything you just described, is there anything that would hold you back?",
    ],
  },
];

/* ---- Objections -------------------------------------------------------- */

export type Objection = {
  says: string;
  /** Step 1. Find out what they actually mean before you answer anything. */
  clarify: string;
  /** Step 2. Let them put their own number on it. */
  discuss: string;
  /** Step 3. Ask whether it would still be a problem if it went away. */
  diffuse: string;
  /** Only if they ask a straight question. Never lead with it, never use it to argue. */
  fact?: string;
};

export const OBJECTIONS: Objection[] = [
  {
    says: "Not interested.",
    clarify: "That is fair, and most people say that before they know what it is. What are you picturing when you say not interested?",
    discuss: "How are you handling the booking side at the moment?",
    diffuse: "If there were a way to stop losing the hours people do not show up for, without changing how you work, would you want to hear it, or is that genuinely not a problem for you?",
  },
  {
    says: "We already use a calendar and a spreadsheet.",
    clarify: "How do you mean? Walk me through what happens on there when somebody books.",
    discuss: "What happens to that hour when someone cancels last minute? ... And how often is that in a month?",
    diffuse: "So if that hour charged them and refilled itself without you touching it, would that be worth a look, or is that not really the issue for you?",
    fact: "Pulse holds the card at booking, keeps the deposit by the studio's own rules, and offers the freed hour to the waiting list.",
  },
  {
    says: "It is another thing to pay for every month.",
    clarify: "When you say another thing to pay for, what are you weighing it against?",
    discuss: "What did the last three people who did not turn up cost you?",
    diffuse: "So if it paid for itself out of the ones you are currently writing off, would the monthly cost still be the issue, or would it be something else?",
  },
  {
    says: "Switching sounds like months of work.",
    clarify: "What makes you say that?",
    discuss: "What happened last time you moved something? ... And what did that cost you while it was going on?",
    diffuse: "If we did the moving for you and you were taking bookings the same day, would that change anything, or is there something else in the way?",
    fact: "Pulse moves their data across for free. The client list and the gear list come in from spreadsheets, and setup can be finished later. They can take a booking before setup is done.",
  },
  {
    says: "I need to think about it.",
    clarify: "That is fair. When you say think about it, what is the part you are not sure about?",
    discuss: "If it stalls there, offer the fork and then wait: is it the money, or is it that you are not sure it would fix the thing you told me about?",
    diffuse: "If that part were sorted, would there be anything else stopping you?",
  },
  {
    says: "I need to talk to my partner.",
    clarify: "Of course. What do you think they are going to say?",
    discuss: "What would they need to hear from you for it to be a yes?",
    diffuse: "Would it help if I was on that call so they can ask me directly, or would you rather take it yourself?",
  },
  {
    says: "Send me some information.",
    clarify: "Happy to. What do you want to see in it?",
    discuss: "And once you have read it, what happens next on your end?",
    diffuse: "Would you be opposed to going through it together for ten minutes instead, so you are not reading it cold?",
  },
  {
    says: "We are one room. This looks like too much.",
    clarify: "What makes it feel like too much?",
    discuss: "Of everything you have seen, what is the one part you would actually use week to week? ... And what is that part costing you the way it runs now?",
    diffuse: "If you only ever saw the booking page and the charge for a missed session, and everything else stayed switched off, would it still feel like too much?",
    fact: "The staff schedule, the cable map and the song paperwork are already there for the day they open a second room. They do not have to move again.",
  },
  {
    says: "What does it cost?",
    clarify: "Depends on how many rooms you have got and whether you want the deposits side. Can I ask you two things first, so I give you a real number instead of a made-up one?",
    discuss: "How many rooms are you running, and are you taking any money up front today?",
    diffuse: "Once I know that I can give you a straight number. Would you rather I gave you a range now, or a real one in two minutes?",
  },
  {
    says: "Does Pulse hold our money?",
    clarify: "What is making you ask?",
    discuss: "How long are you waiting for money to reach your account today?",
    diffuse: "If it went into your own account the moment the client paid, would that settle it, or is there something else on the money side you would want to know?",
    fact: "No. The studio connects its own account with Stripe, the company that moves card payments. The money lands in that account and Stripe pays it out to their bank. Pulse runs the checkout and keeps the record.",
  },
  {
    says: "Is the AI going to email my clients on its own?",
    clarify: "What would worry you about that?",
    discuss: "If something did go out in your name that you would not have sent, what would that do to that relationship?",
    diffuse: "If nothing could reach a client until you had read it and tapped approve, would that put it to bed, or would you still want it off entirely?",
    fact: "Anything that reaches a client or touches money waits for a person. The owner can switch on plain reminders to send themselves. Everything else waits for approval.",
  },
  {
    says: "We are too busy to set something up right now.",
    clarify: "What is taking up most of the week right now?",
    discuss: "How many hours a week is the admin side taking you?",
    diffuse: "So would it be worth an hour now if it gave you most of that back every week, or is now genuinely the wrong month?",
  },
];

/* ---- What Pulse is ----------------------------------------------------- */

export const PITCH_WARNING =
  "This block is for you, not for them. Never say any of it on a call. It comes out later, as answers to their questions, in the words they gave you.";

export const PITCH: { h: string; p: string }[] = [
  {
    h: "In one line",
    p: "Pulse is one app that runs a recording studio. It handles booking, money, staff, gear and songs in one place. It also comes with an assistant that reads the studio's records and suggests what to do next.",
  },
  {
    h: "Where to start on a call",
    p: "The booking page. A client picks a room at one in the morning, pays a deposit, and the money is in the studio's own payment account before the owner wakes up.",
  },
  {
    h: "The line from the ad",
    p: "Studios on Pulse do not work more hours. They book more of them. This is a seller's claim, so it belongs in the ad and not in your mouth on a call.",
  },
  {
    h: "Who buys it",
    p: "Studio owners with 20 to 200 clients a year. Groups of producers and engineers passing work between them. Small record companies. Anyone running more than one room.",
  },
];
