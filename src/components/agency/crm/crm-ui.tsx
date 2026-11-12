"use client";

import * as React from "react";
import {
  AlertTriangle, CalendarCheck, Circle, CircleDot, KeyRound, Lock, MessageCircle, RefreshCw, ShieldAlert, Trophy,
  WifiOff, XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/feedback";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useCrm } from "./crm-context";
import type { Stage } from "./zu-types";
import type { ZuError } from "./zu-store";

/* Shared pieces for every CRM panel. ConfirmDialog is the ONLY place in the CRM
   where `confirm: true` is created (crm-guard.test.ts enforces it): the server
   refuses any operation that reaches people, and every DELETE, without it. */

/** Phone touch target: 44 px under 640 px, the normal compact size above. */
export const TOUCH = "max-sm:min-h-11";

/** "1 lead", "2 leads", "0 leads". */
export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/* ---------- focus return (U-10) ----------
   Every Sheet, Dialog and ConfirmDialog in the CRM sends focus back to the
   control that opened it when it closes, by Escape, Cancel, overlay or success.
   Safari does not focus a button on click, so the opener is the last control
   the person pressed or focused, recorded here. If that control is gone when the
   overlay closes (a row re-rendered, a card moved column), the control with the
   same `data-focus-key` is found again; failing that, the nearest stable place:
   the dialog or tab panel it sat in. */

export type Opener = { el: HTMLElement | null; key: string | null; anchor: HTMLElement | null };

const FOCUSABLE = "button, a[href], input, select, textarea, [tabindex], [role=button]";
let lastPressed: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", (e) => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>(FOCUSABLE) : null;
    if (t) lastPressed = t;
  }, true);
  document.addEventListener("focusin", (e) => {
    if (e.target instanceof HTMLElement && e.target !== document.body) lastPressed = e.target;
  }, true);
}

/** The control that is opening something right now. */
export function rememberOpener(from?: HTMLElement | null): Opener {
  if (typeof document === "undefined") return { el: null, key: null, anchor: null };
  const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  const el = from ?? (lastPressed?.isConnected ? lastPressed : null) ?? active;
  return {
    el,
    key: el?.closest<HTMLElement>("[data-focus-key]")?.dataset.focusKey ?? null,
    anchor: el?.parentElement?.closest<HTMLElement>("[role=dialog], [role=tabpanel]") ?? null,
  };
}

function usable(el: HTMLElement | null | undefined): el is HTMLElement {
  return !!el && el.isConnected && el.getClientRects().length > 0 && !el.closest("[inert]") && !(el as HTMLButtonElement).disabled;
}

/** Focus the element with this `data-focus-key` (or a focusable child of it). */
export function focusByKey(key: string): boolean {
  if (typeof document === "undefined") return false;
  const host = document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`);
  const target = host && (host.matches(FOCUSABLE) ? host : host.querySelector<HTMLElement>(FOCUSABLE));
  if (!usable(target)) return false;
  target.focus();
  return true;
}

/** Put focus back on the opener, its re-rendered twin, or the nearest stable place. */
export function restoreFocus(opener: Opener | null, fallback?: () => HTMLElement | null): boolean {
  if (!opener) return false;
  if (usable(opener.el)) { opener.el.focus(); return true; }
  if (opener.key && focusByKey(opener.key)) return true;
  const fb = fallback?.();
  if (usable(fb)) { fb.focus(); return true; }
  if (opener.anchor?.isConnected) { opener.anchor.focus(); return true; }
  return false;
}

/** For a controlled Sheet or Dialog: remembers the opener when `open` turns on,
 *  and returns the `onCloseAutoFocus` handler that sends focus back to it.
 *  `returnTo` overrides the opener (for a sheet opened by code, not a click). */
export function useReturnFocus(
  open: boolean,
  opts: { returnTo?: HTMLElement | null; fallback?: () => HTMLElement | null } = {},
): (e: Event) => void {
  const [state, setState] = React.useState<{ open: boolean; opener: Opener | null }>({ open, opener: null });
  if (state.open !== open) setState({ open, opener: open ? rememberOpener() : state.opener });
  const { returnTo, fallback } = opts;
  const opener = state.opener;
  return React.useCallback((e: Event) => {
    const target = returnTo ? rememberOpener(returnTo) : opener;
    if (restoreFocus(target, fallback)) e.preventDefault();
  }, [returnTo, opener, fallback]);
}

/* ---------- formatters ---------- */

export function money(cents: number | null | undefined, currency: string | null = "USD"): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "–";
  const whole = cents % 100 === 0;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "USD").toUpperCase(),
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(whole ? 0 : 2)}`;
  }
}

function toMs(iso: string | number | null | undefined): number | null {
  if (iso === null || iso === undefined || iso === "") return null;
  const ms = typeof iso === "number" ? iso : Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** "just now", "5 min ago", "3 h ago", "Yesterday", "Nov 6", "Nov 6, 2025". */
export function relTime(iso: string | number | null | undefined, now: number = Date.now()): string {
  const ms = toMs(iso);
  if (ms === null) return "";
  const diff = Math.round((now - ms) / 1000);
  const d = new Date(ms);
  if (diff >= 0) {
    if (diff < 45) return "just now";
    if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} min ago`;
    if (diff < 86_400) return `${Math.round(diff / 3600)} h ago`;
    if (diff < 172_800) return "Yesterday";
  }
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** +12135550142 -> (213) 555-0142. Anything else is returned as given. */
export function phone(e164: string | null | undefined): string {
  if (!e164) return "";
  const digits = e164.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits.length === 10 ? digits : null;
  if (!ten || (e164.trim().startsWith("+") && !e164.trim().startsWith("+1"))) return e164;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/** "Thu, Nov 12, 2:00 PM" (plus the zone name when a time zone is given). */
export function dateTime(iso: string | number | null | undefined, tz?: string | null): string {
  const ms = toMs(iso);
  if (ms === null) return "";
  const base: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  try {
    return new Date(ms).toLocaleString("en-US", tz ? { ...base, timeZone: tz, timeZoneName: "short" } : base);
  } catch {
    return new Date(ms).toLocaleString("en-US", base);
  }
}

/** "Synced 12 s ago". */
export function syncedAgo(fetchedAt: number | null, now: number): string {
  if (fetchedAt === null) return "Not synced yet";
  const s = Math.max(0, Math.round((now - fetchedAt) / 1000));
  if (s < 3) return "Synced just now";
  if (s < 60) return `Synced ${s} s ago`;
  if (s < 3600) return `Synced ${Math.round(s / 60)} min ago`;
  return `Synced at ${new Date(fetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export const REFRESH_GAP_MS = 30_000;

/** Refresh is allowed once per 30 seconds (eval U-08). */
export function refreshGate(lastAt: number | null, now: number): { ok: boolean; waitS: number } {
  if (lastAt === null || now - lastAt >= REFRESH_GAP_MS) return { ok: true, waitS: 0 };
  return { ok: false, waitS: Math.ceil((REFRESH_GAP_MS - (now - lastAt)) / 1000) };
}

/* ---------- sync bar ---------- */

export function SyncBar({
  fetchedAt,
  onRefresh,
  refreshing,
  className,
}: {
  fetchedAt: number | null;
  onRefresh: () => void;
  refreshing?: boolean;
  className?: string;
}) {
  const [now, setNow] = React.useState(() => Date.now());
  const [lastClick, setLastClick] = React.useState<number | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const shownNow = fetchedAt !== null ? Math.max(now, fetchedAt) : now;

  const click = () => {
    const t = Date.now();
    const gate = refreshGate(lastClick, t);
    setNow(t);
    if (!gate.ok) {
      setNote(`Refreshed a moment ago. Try again in ${gate.waitS} s.`);
      return;
    }
    setLastClick(t);
    setNote(null);
    onRefresh();
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-xs text-steel", className)}>
      <span className="tabular-nums">{refreshing ? "Refreshing from Zuops" : syncedAgo(fetchedAt, shownNow)}</span>
      <Button type="button" variant="secondary" size="sm" className={TOUCH} onClick={click} aria-describedby={note ? "crm-refresh-note" : undefined}>
        <RefreshCw className={cn("size-3.5", refreshing && "motion-safe:animate-spin")} aria-hidden />
        Refresh
      </Button>
      <span id="crm-refresh-note" role="status" aria-live="polite" className="text-caution">{note}</span>
    </div>
  );
}

/* ---------- states ---------- */

function errorTitle(error: ZuError): string {
  switch (error.code) {
    case "forbidden": return "Owner and admins only";
    case "read_only": return "Read only here";
    case "needs_admin_key": return "Needs a Full access key";
    case "not_connected": return "Zuops not connected";
    case "scope_denied": return "This key may not do that";
    case "feature_off": return "Off in Zuops";
    case "unreachable":
    case "no_caller": return "Could not reach Zuops";
  }
  if (error.status === 0) return "Could not reach Zuops";
  if (error.status === 429) return "Zuops asked us to slow down";
  return "Zuops refused";
}

export function ZuErrorState({
  error,
  onRetry,
  title,
  className,
}: {
  error: ZuError;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  const Icon = error.status === 0 ? WifiOff : AlertTriangle;
  return (
    <div role="alert" className={className}>
      <EmptyState
        icon={Icon}
        title={title ?? errorTitle(error)}
        description={error.reason}
        action={onRetry ? (
          <Button type="button" variant="secondary" size="sm" className={TOUCH} onClick={onRetry}>
            <RefreshCw className="size-3.5" aria-hidden />
            Retry
          </Button>
        ) : undefined}
      />
    </div>
  );
}

export const READ_ONLY_REASON = "Read only here. This deployment cannot change Zuops.";
export const NEEDS_ADMIN_REASON = "Needs a Full access key";

export function ReadOnlyBanner() {
  const { status } = useCrm();
  if (!status || !status.keyConfigured || status.writesOn) return null;
  return (
    <div role="status" className="flex items-start gap-3 rounded-lg border border-caution/30 bg-caution/10 px-4 py-3 text-sm text-bone">
      <Lock className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden />
      <p>
        <strong className="font-semibold">{READ_ONLY_REASON}</strong> It shares the one real Zuops account, so
        buttons that write are off here. Everything still reads live.
      </p>
    </div>
  );
}

export function NeedsFullAccess({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-[0.6875rem] font-medium text-caution", className)}>
      <KeyRound className="size-3" aria-hidden />
      {NEEDS_ADMIN_REASON}
    </span>
  );
}

export function UnauthorizedState({ reason }: { reason?: "signed_out" | "forbidden" | "not_setup" | string }) {
  const description =
    reason === "signed_out"
      ? "Sign in with a Pulse agency owner or admin account to open the CRM."
      : reason === "not_setup"
        ? "The CRM is not set up on this deployment yet."
        : "The CRM is limited to Pulse agency owners and admins.";
  return <EmptyState icon={ShieldAlert} title="Owner and admins only" description={description} />;
}

/* ---------- confirm ---------- */

/** The kinds of consequence the server asks a person to confirm. */
export type ConfirmKind = "reaches" | "changes_sending" | "spends" | "exposes" | "delete";

const CONFIRM_COPY: Record<ConfirmKind, string> = {
  reaches: "This reaches real people.",
  changes_sending: "This changes what is sent automatically to real people.",
  spends: "This uses credits or starts paid work.",
  exposes: "This sends lead data outside the account or changes who can access it.",
  delete: "This deletes something.",
};

/** The one-line consequence to put in a ConfirmDialog body for each kind. */
export function confirmCopy(kind: ConfirmKind): string {
  return CONFIRM_COPY[kind];
}

/** Proof that a person pressed the confirm button of a ConfirmDialog. Spread it
 *  into a write: `run(op, { path, ...grant })`. */
export type ConfirmGrant = { readonly confirm: true };

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  destructive,
  trigger,
  open,
  onOpenChange,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Runs only from the confirm button. The dialog closes when it settles. */
  onConfirm: (grant: ConfirmGrant) => unknown | Promise<unknown>;
  destructive?: boolean;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [inner, setInner] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const isOpen = open ?? inner;
  // Focus goes back to whatever opened the dialog, on Cancel, Escape, the
  // overlay and after the confirm button's work finishes.
  const onCloseAutoFocus = useReturnFocus(isOpen);
  const setOpen = (v: boolean) => {
    if (open === undefined) setInner(v);
    onOpenChange?.(v);
  };

  const confirmClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      // The one place a confirm grant is made: inside this click handler.
      const grant: ConfirmGrant = Object.freeze({ confirm: true });
      await onConfirm(grant);
    } finally {
      setPending(false);
      setOpen(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(v) => { if (!pending) setOpen(v); }}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent size="sm" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm text-steel">{body}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-wrap">
          <Button type="button" variant="ghost" className={TOUCH} onClick={() => setOpen(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={destructive ? "danger" : "primary"} className={TOUCH} onClick={confirmClick} disabled={pending}>
            {pending ? "Working" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- stages ---------- */

export type Tone = "neutral" | "positive" | "caution" | "critical" | "info" | "gold";

export const STAGE_COLORS = [
  "blue", "amber", "violet", "cyan", "emerald", "rose", "teal", "orange", "pink", "indigo", "lime", "slate",
] as const;

export function stageTone(color: string | null | undefined): Tone {
  switch (color) {
    case "blue": case "cyan": case "teal": case "indigo": return "info";
    case "amber": case "orange": return "caution";
    case "emerald": case "lime": return "positive";
    case "rose": case "pink": return "critical";
    case "violet": return "gold";
    default: return "neutral";
  }
}

const BEHAVIOR_ICON: Record<string, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  new: CircleDot,
  contacted: MessageCircle,
  booked: CalendarCheck,
  won: Trophy,
  lost: XCircle,
};

function titleWord(key: string): string {
  const s = key.replace(/[_-]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "Unknown";
}

export function resolveStage(stage: Stage | string | null | undefined, stages?: Stage[] | null): Stage | null {
  if (!stage) return null;
  if (typeof stage !== "string") return stage;
  const found = stages?.find((s) => s.key === stage);
  return found ?? { id: stage, key: stage, label: titleWord(stage), behavior: stage };
}

/** A stage as a word plus an icon; the color only backs them up. */
export function StageBadge({ stage, stages, className }: { stage: Stage | string | null | undefined; stages?: Stage[] | null; className?: string }) {
  const s = resolveStage(stage, stages);
  if (!s) return <Badge className={className}><Circle className="size-3" aria-hidden />No stage</Badge>;
  const Icon = BEHAVIOR_ICON[s.behavior ?? s.key] ?? Circle;
  const tone = stageTone(s.color ?? null);
  return (
    <Badge tone={tone === "gold" ? "gold" : tone} className={className}>
      <Icon className="size-3" aria-hidden />
      {s.label}
    </Badge>
  );
}

/* ---------- write button ---------- */

export function writeBlock(flags: { canWrite: boolean; hasAdminKey: boolean }, admin?: boolean): string | null {
  if (!flags.canWrite) return READ_ONLY_REASON;
  if (admin && !flags.hasAdminKey) return NEEDS_ADMIN_REASON;
  return null;
}

export type WriteButtonProps = ButtonProps & {
  /** Needs the Full access key (an `:admin` scope). */
  admin?: boolean;
  /** An extra reason to hold the button, shown the same way. */
  blockedReason?: string | null;
};

/** A Button that writes to Zuops. Off, with the reason in a tooltip and for
 *  screen readers, when this deployment is read only, or for an admin action
 *  when no Full access key is set (eval X-08). */
export const WriteButton = React.forwardRef<HTMLButtonElement, WriteButtonProps>(
  ({ admin, blockedReason, children, disabled, className, ...rest }, ref) => {
    const crm = useCrm();
    const reason = blockedReason || writeBlock(crm, admin);
    if (!reason) {
      return <Button ref={ref} className={cn(TOUCH, className)} disabled={disabled} {...rest}>{children}</Button>;
    }
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip label={reason}>
          <span tabIndex={0} className="inline-flex rounded-chrome outline-none focus-visible:ring-2 focus-visible:ring-gold/30" data-blocked={reason}>
            <Button ref={ref} className={cn(TOUCH, className)} {...rest} disabled aria-disabled>
              {children}
              <span className="sr-only"> ({reason})</span>
            </Button>
          </span>
        </Tooltip>
      </TooltipProvider>
    );
  },
);
WriteButton.displayName = "WriteButton";
