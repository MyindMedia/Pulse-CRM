"use client";

import * as React from "react";
import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ArrowRight, Landmark, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCapabilities } from "@/lib/use-capabilities";
import { errorMessage } from "@/lib/errors";
import { CONNECTION_STATUS } from "./finance-labels";
import { usePlaidLink } from "./use-plaid-link";

/** Start Plaid onboarding from Settings without leaving the integrations tab. */
export function PlaidConnectCard() {
  const { can, loaded } = useCapabilities();
  const org = useQuery(api.orgs.current, {});
  const canRead = loaded && can("insights.read");
  const reportsEnabled = !!org && !org.disabledFeatures?.includes("reports");
  const overview = useQuery(api.banking.overview, canRead && reportsEnabled ? {} : "skip");
  const createLinkToken = useAction(api.banking.createLinkToken);
  const exchange = useAction(api.banking.exchangePublicToken);
  const [connecting, setConnecting] = React.useState(false);
  const openLink = usePlaidLink({
    onSuccess: async (publicToken) => {
      try {
        const result = await exchange({ publicToken });
        toast.success(`${result.institutionName} connected. Importing transactions.`);
      } catch (error) {
        toast.error(errorMessage(error));
      } finally {
        setConnecting(false);
      }
    },
    onExit: (message) => {
      setConnecting(false);
      if (message && message !== "Closed.") toast.error(message);
    },
  });

  async function connect() {
    setConnecting(true);
    try {
      const { linkToken } = await createLinkToken({});
      await openLink(linkToken);
    } catch (error) {
      setConnecting(false);
      toast.error(errorMessage(error));
    }
  }

  const connections = overview?.connections.filter((connection) => connection.status !== "revoked") ?? [];
  const checking = !loaded || org === undefined || (canRead && reportsEnabled && overview === undefined);

  return (
    <div className="rounded-chrome border border-graphite/50 bg-coal/40 p-5">
      <div className="flex items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-gold/10 text-gold">
          <Landmark className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-grotesk text-sm font-semibold text-bone">Connect your bank with Plaid</h3>
            {overview?.configured && overview.environment === "sandbox" && <Badge tone="caution">Sandbox</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-steel" role="status">
            {checking
              ? "Checking bank connections…"
              : !canRead
                ? "Your studio owner can connect a bank and manage access to financial data."
                : !reportsEnabled
                  ? "Plaid banking requires Reports. Enable Reports in your workspace, or upgrade to a plan that includes it."
                  : !overview?.configured
                    ? "Bank connections aren’t enabled yet. Your admin needs to finish Plaid setup."
                    : "Connect your business bank or card to sync balances, import transactions, and match receipts."}
          </p>
        </div>
      </div>

      {connections.length > 0 && (
        <ul className="mt-4 space-y-2" aria-label="Connected banks">
          {connections.map((connection) => {
            const status = CONNECTION_STATUS[connection.status] ?? CONNECTION_STATUS.error;
            return (
              <li key={connection._id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-bone">{connection.institutionName}</span>
                <Badge tone={connection.newAccountsAvailable ? "caution" : status.tone} dot>
                  {connection.newAccountsAvailable ? "Review account access" : status.label}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}

      {overview?.configured && overview.environment === "sandbox" && (
        <p className="mt-3 text-xs text-caution">Test mode uses Plaid sandbox banks. Real bank connections aren’t enabled yet.</p>
      )}
      {overview?.configured && !overview.canManage && (
        <p className="mt-3 text-xs text-steel">Ask your studio owner to connect or reconnect a bank.</p>
      )}
      {overview?.configured && (
        <div className="mt-4 flex flex-wrap gap-2">
          {overview.canManage && (
            <Button size="sm" onClick={connect} disabled={connecting}>
              {connecting ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Landmark className="size-3.5" aria-hidden="true" />}
              {connecting ? "Connecting…" : "Connect with Plaid"}
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link href="/banking">Manage banking <ArrowRight className="size-3.5" aria-hidden="true" /></Link>
          </Button>
        </div>
      )}
    </div>
  );
}
