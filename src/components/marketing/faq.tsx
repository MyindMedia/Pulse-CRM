import { Plus } from "lucide-react";
import { Reveal } from "./reveal";
import { GhostWord } from "./ghost-word";

/* Native <details> accordion - no client JS, fully accessible. The chevron
   rotates via the open: variant on each details element. */
const FAQS = [
  {
    q: "Do I need a separate payment processor?",
    a: "No. Pulse connects your own Stripe account, so client deposits, invoices and payments land directly in your bank. Pulse takes no cut of your client payments.",
  },
  {
    q: "Do my clients need an account to book or pay?",
    a: "No. Your booking pages, deposit links and invoices are public and token-secured. Clients book and pay without signing up for anything.",
  },
  {
    q: "Can I cancel or change plans anytime?",
    a: "Yes. Plans are billed monthly with no contract. Upgrade, downgrade or cancel anytime from your billing portal; changes are prorated.",
  },
  {
    q: "What is the AI Agent?",
    a: "An AI studio manager that drafts client replies, follows up on leads and keeps sessions and payments moving. Coming soon, included on the Studio plan.",
  },
  {
    q: "Can I bring my whole team?",
    a: "Yes. Studio and Label plans include staff scheduling and team access, so engineers and managers all work from the same studio workspace.",
  },
  {
    q: "Is the booking page branded as my studio?",
    a: "Studio and Label plans include white-label branding on client-facing pages, so your booking and payment pages carry your studio's name and look.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="relative overflow-hidden px-4 py-24 lg:px-8">
      <GhostWord word="ANSWERS" />
      <div className="relative z-10 mx-auto max-w-3xl">
        <Reveal className="text-center">
          <p className="chrome-meta text-steel">Recording studio software FAQ</p>
          <h2 className="chrome-display mt-4 text-4xl text-bone sm:text-5xl">
            Studio software, <span className="text-gold">answered</span>
          </h2>
        </Reveal>

        <div className="mt-12 space-y-3">
          {FAQS.map((item, i) => (
            <Reveal key={item.q} delay={i * 60}>
              <details className="group rounded-chrome border border-graphite/50 bg-obsidian/50 transition-colors open:border-gold/50 hover:border-bone/40">
                <summary className="font-grotesk flex cursor-pointer list-none items-center justify-between gap-4 p-5 text-left text-base font-semibold tracking-[-0.01em] text-bone [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <Plus className="size-4 shrink-0 text-gold transition-transform duration-300 group-open:rotate-45" />
                </summary>
                <p className="font-grotesk px-5 pb-5 text-sm leading-relaxed text-mist/75">{item.a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
