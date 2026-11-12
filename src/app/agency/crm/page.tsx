"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { CheckCircle2, Clock, FlaskConical, KeyRound, Lock, Radio, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, LoadingPanel } from "@/components/ui/feedback";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CRM_TABS, CrmNavProvider, CrmPanelActive, CrmProvider, NO_ZUOPS_TABS, useCrm, type CrmNav, type CrmTabId, type LeadsJump,
} from "@/components/agency/crm/crm-context";
import { ReadOnlyBanner, TOUCH, UnauthorizedState } from "@/components/agency/crm/crm-ui";
import { clearZuCache, setZuOwner } from "@/components/agency/crm/use-zu";
import { useOptionalUser } from "@/lib/use-optional-clerk";

/* /agency/crm: the agency CRM on Zuops. Pulse agency owner and admin only (design
   D1); anyone else gets the Unauthorized state and nothing below it renders or
   fetches (eval A-09). Each tab is its own lazily loaded chunk that mounts the
   first time it is opened and then stays mounted (paused while hidden). The tab
   lives in the URL hash so a reload stays put. */

const panelLoading = () => <LoadingPanel label="Loading this section" />;

const CrmDashboard = dynamic(() => import("@/components/agency/crm/crm-dashboard").then((m) => m.CrmDashboard), { ssr: false, loading: panelLoading });
const CrmLeads = dynamic(() => import("@/components/agency/crm/crm-leads").then((m) => m.CrmLeads), { ssr: false, loading: panelLoading });
const CrmPipeline = dynamic(() => import("@/components/agency/crm/crm-pipeline").then((m) => m.CrmPipeline), { ssr: false, loading: panelLoading });
const CrmInbox = dynamic(() => import("@/components/agency/crm/crm-inbox").then((m) => m.CrmInbox), { ssr: false, loading: panelLoading });
const CrmCalendar = dynamic(() => import("@/components/agency/crm/crm-calendar").then((m) => m.CrmCalendar), { ssr: false, loading: panelLoading });
const CrmSocial = dynamic(() => import("@/components/agency/crm/crm-social").then((m) => m.CrmSocial), { ssr: false, loading: panelLoading });
const CrmResources = dynamic(() => import("@/components/agency/crm/crm-resources").then((m) => m.CrmResources), { ssr: false, loading: panelLoading });
const OutreachWorkspace = dynamic(() => import("@/components/agency/outreach-workspace").then((m) => m.OutreachWorkspace), { ssr: false, loading: panelLoading });
const CrmFunctions = dynamic(() => import("@/components/agency/crm/crm-functions").then((m) => m.CrmFunctions), { ssr: false, loading: panelLoading });

const TABS = CRM_TABS;
type TabId = CrmTabId;
const TAB_IDS: readonly string[] = TABS.map(([id]) => id);

function subscribeHash(fn: () => void) {
  window.addEventListener("hashchange", fn);
  return () => window.removeEventListener("hashchange", fn);
}

function useHashTab(fallback: TabId): [TabId, (t: TabId) => void] {
  const hash = React.useSyncExternalStore(subscribeHash, () => window.location.hash.slice(1), () => "");
  const tab = (TAB_IDS.includes(hash) ? hash : fallback) as TabId;
  const go = React.useCallback((t: TabId) => {
    if (window.location.hash.slice(1) === t) return;
    // replaceState keeps tab switches out of the Back history; the event lets
    // the hash store above re-read it.
    window.history.replaceState(window.history.state, "", `#${t}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, []);
  return [tab, go];
}

/** Holds the Zuops cache for one signed-in person. When it unmounts (leaving the
 *  CRM, losing access, signing out, or a different user: it is keyed by user id)
 *  every cached answer is dropped, and answers still in flight are thrown away
 *  (F-U8). React runs this cleanup before the next tree's effects, so the new
 *  tree's first reads are not wiped. */
function ZuCacheScope({ children }: { children: React.ReactNode }) {
  React.useEffect(() => () => clearZuCache(), []);
  return <>{children}</>;
}

export default function CrmPage() {
  const access = useQuery(api.crm.access, {});
  const { user } = useOptionalUser();
  // Clerk's user is undefined while it loads (wait, so the first reads are not
  // made twice), null when signed out, and always null in demo mode (no Clerk).
  if (access === undefined || user === undefined) return <LoadingPanel label="Checking CRM access" />;
  const userKey = user?.id ?? "no-user";
  // Before any panel reads: a different user's first render starts from an
  // empty cache, not one frame of the previous user's answers (R3-U4).
  setZuOwner(userKey);
  if (!access.allowed) return <LostAccess reason={access.reason} />;
  return (
    <ZuCacheScope key={userKey}>
      <CrmProvider>
        <CrmConsole />
      </CrmProvider>
    </ZuCacheScope>
  );
}

function LostAccess({ reason }: { reason?: string }) {
  React.useEffect(() => {
    clearZuCache();
  }, []);
  return <UnauthorizedState reason={reason} />;
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 space-y-1">
        <h1 className="chrome-display text-2xl leading-[0.95] text-bone">CRM</h1>
        <p className="text-sm text-steel">Prospects, leads, pipeline, inbox and bookings. Everything but Prospects is read live from Zuops.</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

const PROSPECTS_NOTE =
  "Studios you are prospecting, before they become leads in Zuops. Emails go out from Lawrence or MaxB with their own signatures, and each one still needs your approval.";

function ZuopsMissing() {
  return (
    <EmptyState
      icon={KeyRound}
      title="Zuops key missing"
      description="Set ZUOPS_CRM_API_KEY in this deployment's Convex environment. Until then this section has nothing to read. Prospects works without it."
    />
  );
}

function CrmConsole() {
  const { status } = useCrm();
  // Without a Zuops key the page opens on Prospects, the one tab that works.
  const [tab, go] = useHashTab(status && !status.keyConfigured ? "prospects" : "dashboard");
  const [visited, setVisited] = React.useState<TabId[]>([]);
  if (!visited.includes(tab)) setVisited([...visited, tab]);
  // Each jump bumps a nonce, so opening the same lead twice still reacts (F-U15).
  const [inbox, setInbox] = React.useState<{ id: string | null; nonce: number }>({ id: null, nonce: 0 });
  const [book, setBook] = React.useState<{ id: string | null; nonce: number }>({ id: null, nonce: 0 });
  const [leadsJump, setLeadsJump] = React.useState<{ filter: LeadsJump; nonce: number }>({ filter: {}, nonce: 0 });

  const nav = React.useMemo<CrmNav>(() => ({
    openInbox: (id) => { setInbox((s) => ({ id, nonce: s.nonce + 1 })); go("inbox"); },
    openCalendar: (id) => { setBook((s) => ({ id, nonce: s.nonce + 1 })); go("calendar"); },
    openLeads: (filter) => { setLeadsJump((s) => ({ filter, nonce: s.nonce + 1 })); go("leads"); },
  }), [go]);

  if (status === undefined) return <LoadingPanel label="Checking the Zuops connection" />;
  if (status === null) return <UnauthorizedState />;
  const connected = status.keyConfigured;
  const zuopsTab = !NO_ZUOPS_TABS.includes(tab);

  const panel = (id: TabId): React.ReactNode => {
    // Prospects is Convex only and works with or without Zuops (owner request
    // 2026-11-11); every other tab needs the Zuops key.
    if (id === "prospects") {
      return (
        <div className="space-y-4">
          <p className="text-sm text-steel">{PROSPECTS_NOTE}</p>
          <OutreachWorkspace />
        </div>
      );
    }
    if (!connected) return <ZuopsMissing />;
    switch (id) {
      case "dashboard": return <CrmDashboard />;
      case "leads": return <CrmLeads jump={leadsJump.filter} jumpNonce={leadsJump.nonce} />;
      case "pipeline": return <CrmPipeline />;
      case "inbox": return <CrmInbox openLeadId={inbox.id} openNonce={inbox.nonce} />;
      case "calendar": return <CrmCalendar bookLeadId={book.id} bookNonce={book.nonce} />;
      case "social": return <CrmSocial />;
      case "functions": return <CrmFunctions />;
      default: return <CrmResources group={id} />;
    }
  };

  return (
    <CrmNavProvider value={nav}>
      <div className="space-y-6">
        <Header>
          {!connected
            ? <Badge tone="critical"><XCircle className="size-3" aria-hidden />Zuops not connected</Badge>
            : status.mock
              ? <Badge tone="caution"><FlaskConical className="size-3" aria-hidden />Mock data</Badge>
              : <Badge tone="positive"><CheckCircle2 className="size-3" aria-hidden />Zuops connected</Badge>}
          {connected && (status.webhookConfigured
            ? <Badge tone="positive"><Radio className="size-3" aria-hidden />Live updates</Badge>
            : <Badge tone="caution"><Clock className="size-3" aria-hidden />Checks every minute</Badge>)}
          {connected && !status.writesOn && <Badge tone="caution"><Lock className="size-3" aria-hidden />Read only</Badge>}
        </Header>
        {/* Read only is about Zuops writes; Prospects has its own approvals. */}
        {connected && zuopsTab && <ReadOnlyBanner />}
        <Tabs value={tab} onValueChange={(v) => go(v as TabId)} className="space-y-4">
          <TabsList aria-label="CRM sections" className="w-full justify-start">
            {TABS.map(([id, label]) => <TabsTrigger key={id} value={id} className={TOUCH}>{label}</TabsTrigger>)}
          </TabsList>
          {TABS.map(([id]) => (visited.includes(id) || id === tab) && (
            <TabsContent key={id} value={id} forceMount className="data-[state=inactive]:hidden">
              <CrmPanelActive active={id === tab}>{panel(id)}</CrmPanelActive>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </CrmNavProvider>
  );
}
