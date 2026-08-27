"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Plus, Send } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { Section } from "@/components/ui/page";
import { EmptyState } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/toggle";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { errorMessage } from "@/lib/errors";
import { useCapabilities } from "@/lib/use-capabilities";
import { shortDate } from "@/lib/format";
import { PromoDialog } from "@/components/social/promo-dialog";

/** Promo codes: time-boxed discounts a studio posts about and checkout
 *  resolves at redemption (convex/promos.ts). "New promo" and clicking a
 *  code (edit) both open the same dialog; the active toggle only ever turns
 *  a promo off (`deactivate`) - there is no un-deactivate on the backend, so
 *  once off the switch is shown off and disabled rather than offered as a
 *  live control that would silently do nothing. */
export default function PromosPage() {
  const promos = useQuery(api.promos.list, {});
  const rooms = useQuery(api.rooms.list, {});
  const org = useQuery(api.orgs.current, {});
  const deactivate = useMutation(api.promos.deactivate);
  // Backend gate for promos.create/update/deactivate is marketing.approve,
  // not marketing.edit as an earlier plan assumed (verified against
  // convex/promos.ts:58,75,89 and the role fixtures in
  // convex/lib/accessPolicies.test.ts, which show the engineer role holding
  // marketing.edit but not marketing.approve). Gating on marketing.edit here
  // would let an engineer open this dialog and submit only to hit a
  // server-side denial, so this mirrors the actual required capability
  // instead, the same way accounts/page.tsx mirrors the real
  // marketing.approve gate on connect/remove.
  const { can, loaded } = useCapabilities();
  const canManage = can("marketing.approve");

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Doc<"promos"> | null>(null);

  const timezone = org?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const roomName = (id?: Id<"rooms">) => (id ? (rooms?.find((r) => r._id === id)?.name ?? "Unknown room") : null);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(p: Doc<"promos">) {
    if (!canManage) return;
    setEditing(p);
    setDialogOpen(true);
  }

  async function handleDeactivate(id: Id<"promos">) {
    try {
      await deactivate({ id });
      toast.success("Promo deactivated.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not deactivate that promo. Try again."));
    }
  }

  return (
    <div className="space-y-6">
      <Section
        title="Promo codes"
        trailing={
          canManage ? (
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-3.5" />
              New promo
            </Button>
          ) : undefined
        }
      >
        {!canManage && loaded && (
          <p className="text-sm text-steel">
            You can view promo codes here. Ask a studio owner or manager to create, edit, or deactivate one.
          </p>
        )}

        {promos === undefined ? null : promos.length === 0 ? (
          <EmptyState
            title="No promo codes yet"
            description={
              canManage
                ? "Create a code with a window and an optional room, then post it to your accounts."
                : "A studio owner or manager has not created a promo code yet."
            }
            action={
              canManage ? (
                <Button variant="outline" size="sm" onClick={openCreate}>
                  <Plus className="size-3.5" />
                  New promo
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Code</TH>
                <TH>Discount</TH>
                <TH>Window</TH>
                <TH>Room</TH>
                <TH>Redemptions</TH>
                <TH>Source</TH>
                <TH>Active</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {promos.map((p) => (
                <TR key={p._id}>
                  <TD>
                    <button
                      type="button"
                      onClick={() => openEdit(p)}
                      disabled={!canManage}
                      className={
                        canManage
                          ? "font-meta font-semibold text-bone underline-offset-2 hover:text-gold hover:underline"
                          : "font-meta font-semibold text-bone"
                      }
                    >
                      {p.code}
                    </button>
                  </TD>
                  <TD>{p.pct}%</TD>
                  <TD className="whitespace-nowrap text-xs text-steel">
                    {shortDate(p.startsAt)} - {shortDate(p.endsAt)}
                  </TD>
                  <TD>{roomName(p.roomId) ?? "All rooms"}</TD>
                  <TD>{p.maxRedemptions ? `${p.redemptions} / ${p.maxRedemptions}` : p.redemptions}</TD>
                  <TD>
                    <Badge tone={p.source === "rate_cut" ? "gold" : "neutral"}>
                      {p.source === "rate_cut" ? "AI" : "Owner"}
                    </Badge>
                  </TD>
                  <TD>
                    <Switch
                      checked={p.active}
                      disabled={!canManage || !p.active}
                      onCheckedChange={(checked) => {
                        if (!checked) void handleDeactivate(p._id);
                      }}
                      aria-label={p.active ? `Deactivate ${p.code}` : `${p.code} is inactive`}
                    />
                  </TD>
                  <TD>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/marketing/compose?template=rate_promo&promo=${p._id}`}>
                        <Send className="size-3.5" />
                        Post this
                      </Link>
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      {canManage && (
        <PromoDialog open={dialogOpen} onOpenChange={setDialogOpen} promo={editing} timezone={timezone} />
      )}
    </div>
  );
}
