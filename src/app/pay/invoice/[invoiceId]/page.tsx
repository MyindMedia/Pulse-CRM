"use client";

import * as React from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Loader2, CheckCircle2, CreditCard, ShieldCheck } from "lucide-react";

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function InvoicePayPage() {
  const params = useParams<{ invoiceId: string }>();
  const search = useSearchParams();
  const invoiceId = (params?.invoiceId ?? "") as Id<"invoices">;
  const justPaid = search?.get("paid") === "1";

  const inv = useQuery(api.invoicePay.get, invoiceId ? { invoiceId } : "skip");
  const pay = useAction(api.invoicePay.payViaStripe);
  const [busy, setBusy] = React.useState(false);

  async function handlePay() {
    setBusy(true);
    try {
      const { url } = await pay({ invoiceId });
      if (url) window.location.href = url;
      else toast.error("Online payment isn't set up for this studio yet. Please reply to your invoice email.");
    } catch {
      toast.error("Could not start checkout. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const accent = inv?.accentColor ?? "#fdb913";
  const paid = inv?.status === "paid" || justPaid;

  return (
    <div className="grid min-h-dvh place-items-center bg-ink p-6">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-[380px]"
        style={{ background: `radial-gradient(ellipse 60% 100% at 50% 0%, ${accent}1a, transparent 70%)` }}
      />
      <div className="relative w-full max-w-md rounded-chrome border border-graphite/50 bg-coal/60 p-6 shadow-elev-2">
        {inv === undefined ? (
          <div className="grid place-items-center py-16"><Loader2 className="size-6 animate-spin text-gold" /></div>
        ) : inv === null ? (
          <div className="py-12 text-center">
            <p className="font-grotesk text-lg font-semibold text-bone">Invoice not found</p>
            <p className="mt-1 text-sm text-steel">This payment link is no longer valid. Check with the studio.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              {inv.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={inv.logoUrl} alt={inv.studioName} className="size-10 rounded-md object-cover" />
              ) : (
                <span className="grid size-10 place-items-center rounded-md font-grotesk font-bold" style={{ backgroundColor: `${accent}22`, color: accent }}>
                  {inv.studioName.slice(0, 1)}
                </span>
              )}
              <div>
                <p className="font-grotesk text-sm font-semibold text-bone">{inv.studioName}</p>
                <p className="text-xs text-steel/70">Invoice {inv.number}</p>
              </div>
            </div>

            {paid ? (
              <div className="mt-6 rounded-chrome border border-positive/30 bg-positive/[0.06] px-4 py-6 text-center">
                <CheckCircle2 className="mx-auto size-8 text-positive" />
                <p className="mt-2 font-grotesk text-lg font-semibold text-bone">Paid in full</p>
                <p className="mt-1 text-sm text-steel">Thank you{inv.clientName ? `, ${inv.clientName.split(" ")[0]}` : ""}. {usd(inv.amountCents)} received.</p>
              </div>
            ) : (
              <>
                <div className="mt-6 flex items-baseline justify-between">
                  <span className="text-sm text-steel">Amount due</span>
                  <span className="font-grotesk text-3xl font-bold text-bone">{usd(inv.amountCents)}</span>
                </div>
                <p className="mt-1 text-right text-xs text-steel/70">
                  Due {new Date(inv.dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  {inv.status === "overdue" && <span className="ml-1 text-critical">· past due</span>}
                </p>

                {inv.lineItems.length > 0 && (
                  <div className="mt-4 space-y-1.5 rounded-lg border border-graphite/50 bg-obsidian/60 p-3">
                    {inv.lineItems.map((li, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-steel">{li.label}</span>
                        <span className="font-meta text-bone">{usd(li.amountCents)}</span>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={handlePay}
                  disabled={busy || !inv.payable}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-chrome py-3.5 text-sm font-extrabold text-gold-ink disabled:opacity-60"
                  style={{ backgroundColor: accent }}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                  {inv.payable ? `Pay ${usd(inv.amountCents)}` : "Online payment unavailable"}
                </button>
                {!inv.payable && (
                  <p className="mt-2 text-center text-xs text-steel/70">This studio has not enabled card payments yet. Reply to your invoice to arrange payment.</p>
                )}
                <p className="mt-3 flex items-center justify-center gap-1.5 text-[0.625rem] text-steel/70">
                  <ShieldCheck className="size-3" /> Secure checkout by Stripe
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
