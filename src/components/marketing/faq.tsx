import { Plus } from "lucide-react";
import { Reveal } from "./reveal";

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
    a: "An AI studio operations manager that drafts client replies, chases leads and keeps your pipeline moving. It is coming soon and will be included on the Studio plan.",
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
    <section id="faq" className="relative px-4 py-24 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <Reveal className="text-center">
          <p className="overline">Questions</p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-bone sm:text-4xl">
            Everything you{" "}
            <span className="font-serif text-[1.15em] font-normal italic text-gold">need</span> to
            know
          </h2>
        </Reveal>

        <div className="mt-12 space-y-3">
          {FAQS.map((item, i) => (
            <Reveal key={item.q} delay={i * 60}>
              <details className="group rounded-xl border border-hairline bg-coal/40 transition-colors open:border-gold-dim hover:border-hairline-2">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 text-left font-display text-base font-semibold text-bone [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <Plus className="size-4 shrink-0 text-gold transition-transform duration-300 group-open:rotate-45" />
                </summary>
                <p className="px-5 pb-5 text-sm leading-relaxed text-ash">{item.a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
