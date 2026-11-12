"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

/* What every CRM screen needs to know about this deployment, from two Convex
   queries: whether a Zuops key is set, whether writes are allowed here, whether a
   Full access key is set, and the newest webhook pulse per kind (the refetch
   signal). Plus two small contexts the page provides: which panel is on screen,
   and how to jump to the Inbox or Calendar with a lead. */

export type CrmStatus = {
  keyConfigured: boolean;
  writesOn: boolean;
  adminKey: boolean;
  webhookConfigured: boolean;
  /** Every request goes to the local Zuops mock (ZUOPS_CRM_MOCK); nothing is real. */
  mock?: boolean;
};

/** The CRM page's tabs, in order; the id is the URL hash. Prospects (the
 *  prospecting workspace) and Email (the shared studiopulse.tech inboxes) are
 *  Convex only and work without a Zuops key; every other tab reads Zuops. */
export const CRM_TABS = [
  ["dashboard", "Dashboard"],
  ["leads", "Leads"],
  ["prospects", "Prospects"],
  ["pipeline", "Pipeline"],
  ["inbox", "Inbox"],
  ["email", "Email"],
  ["calendar", "Calendar"],
  ["social", "Social"],
  ["campaigns", "Campaigns"],
  ["automations", "Automations"],
  ["forms", "Forms"],
  ["calls", "Calls"],
  ["more", "More"],
  ["settings", "Settings"],
  ["functions", "Functions"],
] as const;

export type CrmTabId = (typeof CRM_TABS)[number][0];

/** Tabs that do not need Zuops. */
export const NO_ZUOPS_TABS: readonly CrmTabId[] = ["prospects", "email"];

export type CrmSignalKind = "lead" | "booking" | "message" | "call" | "deal";
export type CrmSignal = { at: number } & Record<CrmSignalKind, number>;

export type CrmContextValue = {
  /** undefined while loading; null when the caller may not use the CRM. */
  status: CrmStatus | null | undefined;
  signal: CrmSignal | null | undefined;
  /** A key is set and ZUOPS_CRM_WRITES is on for this deployment. */
  canWrite: boolean;
  /** ZUOPS_CRM_ADMIN_KEY (a Full access key) is set. */
  hasAdminKey: boolean;
};

const NONE: CrmContextValue = { status: undefined, signal: undefined, canWrite: false, hasAdminKey: false };
const CrmContext = React.createContext<CrmContextValue>(NONE);

export function crmFlags(status: CrmStatus | null | undefined): { canWrite: boolean; hasAdminKey: boolean } {
  return {
    canWrite: !!status && status.keyConfigured && status.writesOn,
    hasAdminKey: !!status && status.keyConfigured && status.adminKey,
  };
}

export function CrmProvider({ children, enabled = true }: { children: React.ReactNode; enabled?: boolean }) {
  const status: CrmStatus | null | undefined = useQuery(api.crm.status, enabled ? {} : "skip");
  const signal: CrmSignal | null | undefined = useQuery(api.crm.signal, enabled && status ? {} : "skip");
  const value = React.useMemo<CrmContextValue>(
    () => ({ status, signal, ...crmFlags(status) }),
    [status, signal],
  );
  return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>;
}

export function useCrm(): CrmContextValue {
  return React.useContext(CrmContext);
}

/* Panels stay mounted after their first visit so filters and pages survive a tab
   switch. A hidden panel stops polling and refetching on focus or signals; when
   it comes back it refetches only what is older than 30 seconds. */
const PanelActiveContext = React.createContext(true);

export function CrmPanelActive({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <PanelActiveContext.Provider value={active}>{children}</PanelActiveContext.Provider>;
}

export function usePanelActive(): boolean {
  return React.useContext(PanelActiveContext);
}

/* Cross-tab jumps: "Message" opens the Inbox on a lead, "Book" opens the Calendar
   with that lead picked, and the Pipeline can open Leads with a filter. The page
   provides these; without it they do nothing. */
export type LeadsJump = { status?: string };

export type CrmNav = {
  openInbox: (leadId: string) => void;
  openCalendar: (leadId: string) => void;
  openLeads: (filter: LeadsJump) => void;
};

const noop = () => undefined;
const CrmNavContext = React.createContext<CrmNav>({ openInbox: noop, openCalendar: noop, openLeads: noop });

export function CrmNavProvider({ value, children }: { value: CrmNav; children: React.ReactNode }) {
  return <CrmNavContext.Provider value={value}>{children}</CrmNavContext.Provider>;
}

export function useCrmNav(): CrmNav {
  return React.useContext(CrmNavContext);
}
