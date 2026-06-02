"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useQuery, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Clock, Percent, Crown, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { fadeUp, staggerChildren } from "@/lib/motion";
import { money } from "@/lib/format";

type PublicPlan = {
  _id: string;
  name: string;
  description: string | null;
  priceCents: number;
  billingInterval: "month" | "year";
  bundledHoursPerPeriod: number | null;
  memberDiscountPct: number | null;
  priorityBooking: boolean;
};

const intervalLabel: Record<string, string> = { month: "/ month", year: "/ year" };

/** Public membership packages on a studio's booking page. Clients self-subscribe
 *  via a Stripe Checkout subscription on the studio's connected account. */
export function MembershipPlans({ slug, accent }: { slug: string; accent: string }) {
  const plans = useQuery(api.memberships.publicPlans, { slug }) as PublicPlan[] | undefined;
  const [selected, setSelected] = React.useState<PublicPlan | null>(null);

  // Hidden until at least one subscribable package exists.
  if (!plans || plans.length === 0) return null;

  return (
    <section className="space-y-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold tracking-tight text-bone">
          Memberships
        </h2>
        <span className="text-xs text-ash-dim">Recurring &mdash; cancel anytime</span>
      </div>

      <motion.div
        initial="hidden"
        animate="show"
        variants={staggerChildren(0.06)}
        className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
      >
        {plans.map((p) => (
          <motion.div
            key={p._id}
            variants={fadeUp}
            className="glass flex flex-col rounded-lg border border-hairline p-5"
          >
            <div className="flex items-center gap-2">
              <Repeat className="size-4" style={{ color: accent }} />
              <h3 className="font-display text-base font-semibold text-bone">{p.name}</h3>
              {p.priorityBooking && (
                <Crown className="size-3.5" style={{ color: accent }} aria-label="Priority booking" />
              )}
            </div>

            <p className="mt-3 font-display text-2xl font-bold tabular-nums text-bone">
              {money(p.priceCents)}
              <span className="text-sm font-normal text-ash-dim">{intervalLabel[p.billingInterval]}</span>
            </p>

            {p.description && <p className="mt-2 text-xs text-ash">{p.description}</p>}

            <ul className="mt-3 space-y-1.5 text-xs text-ash">
              {p.bundledHoursPerPeriod ? (
                <li className="inline-flex items-center gap-1.5">
                  <Clock className="size-3 text-ash-dim" /> {p.bundledHoursPerPeriod}h studio time included
                </li>
              ) : null}
              {p.memberDiscountPct ? (
                <li className="inline-flex items-center gap-1.5">
                  <Percent className="size-3 text-ash-dim" /> {p.memberDiscountPct}% off every session
                </li>
              ) : null}
              {p.priorityBooking ? (
                <li className="inline-flex items-center gap-1.5">
                  <Crown className="size-3 text-ash-dim" /> Priority booking
                </li>
              ) : null}
            </ul>

            <Button
              className="mt-4 w-full"
              style={{ backgroundColor: accent, color: "var(--color-gold-ink)" }}
              onClick={() => setSelected(p)}
            >
              Subscribe
            </Button>
          </motion.div>
        ))}
      </motion.div>

      <SubscribeDialog
        slug={slug}
        plan={selected}
        onClose={() => setSelected(null)}
      />
    </section>
  );
}

function SubscribeDialog({
  slug,
  plan,
  onClose,
}: {
  slug: string;
  plan: PublicPlan | null;
  onClose: () => void;
}) {
  const subscribe = useAction(api.memberships.subscribePublic);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (plan) { setName(""); setEmail(""); }
  }, [plan]);

  async function submit() {
    if (!plan) return;
    if (!name.trim()) { toast.error("Enter your name."); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { toast.error("Enter a valid email."); return; }
    setBusy(true);
    try {
      const { url } = await subscribe({
        slug,
        planId: plan._id as never,
        clientName: name.trim(),
        clientEmail: email.trim(),
      });
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start checkout.");
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(plan)} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Subscribe to {plan?.name}</DialogTitle>
          <DialogDescription>
            {plan ? `${money(plan.priceCents)} ${intervalLabel[plan.billingInterval]}. You'll finish payment securely on Stripe.` : null}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Field label="Your name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Vega" />
          </Field>
          <Field label="Email">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" inputMode="email" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={submit}>{busy ? "Starting..." : "Continue to payment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
