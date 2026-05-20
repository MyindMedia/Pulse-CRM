"use client";

import * as React from "react";
import { CreditCard, Lock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/field";
import { money } from "@/lib/format";

/**
 * Simulated card form. No card is charged - the backend `payments.record`
 * mutation clears the payment instantly. The form exists for realism.
 */
export function PaymentForm({
  amountCents,
  actionLabel,
  defaultName,
  busy,
  onSubmit,
}: {
  amountCents: number;
  actionLabel: string;
  defaultName: string;
  busy: boolean;
  onSubmit: (payerName: string) => void;
}) {
  const [name, setName] = React.useState(defaultName);
  const [card, setCard] = React.useState("");
  const [expiry, setExpiry] = React.useState("");
  const [cvc, setCvc] = React.useState("");

  const ready =
    name.trim().length > 1 &&
    card.replace(/\s/g, "").length >= 12 &&
    expiry.trim().length >= 4 &&
    cvc.trim().length >= 3;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    onSubmit(name.trim());
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-2 rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
        <Lock className="size-3.5 shrink-0" />
        Simulated payment - no card is charged. Enter any values to continue.
      </div>

      <Field label="Name on card" htmlFor="pay-name">
        <Input
          id="pay-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jordan Rivers"
          autoComplete="cc-name"
        />
      </Field>

      <Field label="Card number" htmlFor="pay-card">
        <Input
          id="pay-card"
          value={card}
          inputMode="numeric"
          onChange={(e) => setCard(formatCard(e.target.value))}
          placeholder="4242 4242 4242 4242"
          maxLength={19}
          autoComplete="cc-number"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Expiry" htmlFor="pay-exp">
          <Input
            id="pay-exp"
            value={expiry}
            inputMode="numeric"
            onChange={(e) => setExpiry(formatExpiry(e.target.value))}
            placeholder="MM / YY"
            maxLength={7}
            autoComplete="cc-exp"
          />
        </Field>
        <Field label="CVC" htmlFor="pay-cvc">
          <Input
            id="pay-cvc"
            value={cvc}
            inputMode="numeric"
            onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="123"
            maxLength={4}
            autoComplete="cc-csc"
          />
        </Field>
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={!ready || busy}>
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Processing…
          </>
        ) : (
          <>
            <CreditCard className="size-4" />
            {actionLabel} - {money(amountCents)}
          </>
        )}
      </Button>
    </form>
  );
}

/** Group card digits into 4s. */
function formatCard(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 16);
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

/** Format expiry as MM / YY. */
function formatExpiry(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)} / ${digits.slice(2)}`;
}
