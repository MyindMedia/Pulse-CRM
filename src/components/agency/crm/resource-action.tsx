"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { useIdemFor, useZuWrite } from "./use-zu";
import { ConfirmDialog, TOUCH, WriteButton, confirmCopy, type ConfirmGrant, type ConfirmKind } from "./crm-ui";
import type { ActionDef } from "./resource-config";
import { FieldList } from "./resource-fields";
import { focusOnClose, useReturnFocus } from "./resource-focus";
import {
  audienceText, buildArgs, fillTemplate, findDeep, fingerprint, getPath, prefill, rowName, splitList,
  type BuiltArgs, type FormValues, type Obj,
} from "./resource-utils";
import { CopyButton, ResultView } from "./resource-values";

/* One action button and everything behind it:
     fields?   a Dialog that collects them first,
     confirm   then a ConfirmDialog that names what it acts on and states the
               consequence; the request runs ONLY from its onConfirm (the server
               refuses those operations without the grant it hands over),
     result    shown in the dialog for links and reads, a secret shown once.

   Whether to confirm is the SERVER's decision: the kind comes from
   convex/crm/policy.ts for the exact body about to be sent (so a webhook create
   or an `apply` flag asks first and a harmless variant does not). That module
   carries the operations registry, so it is loaded with import() when an action
   starts, never in the first paint. A config confirm block only words the
   dialog, and can add a confirm, never remove one.

   Idempotency-Key: one per distinct set of values (useIdemFor). An identical
   retry after a failure reuses it; any change gets another; a success moves on. */

type Stage = "idle" | "fields" | "confirm" | "result";

/** undefined = the kind could not be looked up (fails closed as a confirm). */
type KindLookup = ConfirmKind | null | undefined;

const loadPolicy = () => import("./crm-op-form-kind");

async function lookupKind(op: string, body: Obj): Promise<KindLookup> {
  try {
    const m = await loadPolicy();
    return m.kindFor(op, body);
  } catch {
    return undefined;
  }
}

export type ActionContext = {
  /** The row the action is on (row actions) or the settings object (single). */
  source?: Obj | null;
  /** The value for the action's path parameter (the row's id). */
  pathValue?: string | null;
  /** Read ops to refresh after it runs. */
  invalidate: string[];
  /** A GET op (a read shown in the dialog): no WriteButton, no gate. */
  isRead?: boolean;
  /** Prefill the fields from `source` and send only what changed. */
  prefillFrom?: Obj | null;
};

/** How an action runs: a read runs; a write runs directly only when the server
 *  says it needs no confirm AND the config does not ask for one; otherwise it
 *  goes through ConfirmDialog. A kind that could not be looked up confirms. */
export function actionPlan(action: Pick<ActionDef, "confirm">, kind: KindLookup, isRead?: boolean): "read" | "run" | "confirm" {
  if (isRead) return "read";
  if (kind === undefined || kind !== null || action.confirm) return "confirm";
  return "run";
}

/** The count a confirm states. Only the length of a list the person typed in
 *  this dialog: Zuops does not count recipients before it sends, so no number
 *  is ever taken from a row. */
export function confirmCount(action: ActionDef, values: FormValues): number | null {
  const c = action.confirm?.count;
  return c ? splitList(values[`body:${c.field}`] ?? "").length : null;
}

/** Title, what it acts on, and the consequence line for this kind. */
export function confirmText(action: ActionDef, values: FormValues, source?: Obj | null, kind?: KindLookup): { title: string; body: string; consequence: string } {
  const name = rowName(source, "this");
  const vars = { count: confirmCount(action, values), name, email_audience: audienceText(values, source), values: plainValues(values) };
  const consequence = kind ? confirmCopy(kind) : kind === undefined ? confirmCopy("reaches") : "";
  if (action.confirm) {
    return { title: fillTemplate(action.confirm.title, vars), body: fillTemplate(action.confirm.body, vars), consequence };
  }
  return {
    title: `${action.label}?`,
    body: source ? `This acts on ${name}.` : "This applies to this sub-account.",
    consequence,
  };
}

function plainValues(values: FormValues): Record<string, string> {
  const out: Record<string, string> = {};
  // Choice values like past_customers read as words; anything else (a link, an email) stays as typed.
  for (const [k, v] of Object.entries(values)) out[k.split(":")[1] ?? k] = /^[a-z0-9_]+$/.test(v) ? v.replace(/_/g, " ") : v;
  return out;
}

/** Path, query and body for this action from its form values. */
export function actionArgs(action: ActionDef, values: FormValues, ctx: Pick<ActionContext, "source" | "pathValue" | "prefillFrom">): BuiltArgs | { error: string } {
  const fixed: Obj = { ...(action.body ?? {}) };
  for (const rb of action.rowBody ?? []) {
    const v = getPath(ctx.source ?? {}, rb.from);
    if (v === undefined || v === null || v === "") return { error: "This row is missing what Zuops needs for that." };
    fixed[rb.field] = rb.array ? [v] : v;
  }
  const path: Record<string, string> = {};
  if (action.pathParam) {
    if (!ctx.pathValue) return { error: "This row has no id Zuops can use." };
    path[action.pathParam] = ctx.pathValue;
  }
  const initial = ctx.prefillFrom && !action.sendAll ? prefill(action.fields ?? [], ctx.prefillFrom) : undefined;
  return buildArgs(action.fields ?? [], values, { fixed, path, initial });
}

export function ResourceAction({ action, ctx, size = "sm" }: { action: ActionDef; ctx: ActionContext; size?: "sm" | "md" }) {
  const { run, pending } = useZuWrite();
  const fields = action.fields ?? [];
  const [stage, setStage] = React.useState<Stage>("idle");
  const [values, setValues] = React.useState<FormValues>({});
  const [error, setError] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [kind, setKind] = React.useState<KindLookup>(null);
  const [result, setResult] = React.useState<{ data?: unknown; secret?: string } | null>(null);
  const built = React.useRef<BuiltArgs | null>(null);
  // One Idempotency-Key per distinct set of values: an identical retry after a
  // failure reuses it, any change gets another, and `round` moves on after a success.
  const [round, setRound] = React.useState(0);
  const idemKey = useIdemFor(`${round}|${fingerprint({ values, path: ctx.pathValue ?? null })}`);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const secretRef = React.useRef<HTMLInputElement | null>(null);
  const idPrefix = React.useId();
  useReturnFocus(stage !== "idle", triggerRef);

  const reset = () => {
    setStage("idle");
    setError(null);
    setResult(null); // a revealed secret is dropped here, never kept
    setKind(null);
    built.current = null;
  };

  const execute = async (args: BuiltArgs, grant?: ConfirmGrant): Promise<void> => {
    const body = ctx.isRead || Object.keys(args.body).length === 0 ? undefined : args.body;
    const res = await run(
      action.op,
      {
        path: Object.keys(args.path).length ? args.path : undefined,
        query: Object.keys(args.query).length ? args.query : undefined,
        body,
        idem: ctx.isRead ? undefined : idemKey,
        ...grant,
      },
      { invalidate: [...ctx.invalidate, ...(action.invalidate ?? [])] },
    );
    if (!res.ok) {
      const reason = res.reason ?? "Zuops refused.";
      if (fields.length > 0) {
        setError(reason);
        setStage("fields");
      } else {
        toast.error(reason);
        setStage("idle");
      }
      return;
    }
    setRound((n) => n + 1); // the next run is a new request
    if (action.reveal) {
      const secret = findDeep(res.data, action.reveal.keys);
      setResult({ secret: secret ?? undefined });
      setStage("result");
      toast.success("Created in Zuops.");
      return;
    }
    if (action.showResult) {
      setResult({ data: res.data });
      setStage("result");
      if (!ctx.isRead) toast.success(action.done ?? "Done in Zuops.");
      return;
    }
    toast.success(action.done ?? "Saved in Zuops.");
    reset();
  };

  /** Ask the server's policy about this exact body, then run or confirm. */
  const proceed = async (args: BuiltArgs) => {
    if (ctx.isRead) {
      await execute(args);
      return;
    }
    setChecking(true);
    const k = await lookupKind(action.op, args.body);
    setChecking(false);
    if (actionPlan(action, k, ctx.isRead) === "confirm") {
      built.current = args;
      setKind(k);
      setStage("confirm");
      return;
    }
    await execute(args);
  };

  const start = () => {
    setError(null);
    if (!ctx.isRead) void loadPolicy().catch(() => undefined); // warm it while the form is filled in
    if (fields.length > 0) {
      setValues(prefill(fields, ctx.prefillFrom ?? null));
      setStage("fields");
      return;
    }
    const args = actionArgs(action, {}, ctx);
    if ("error" in args) { toast.error(args.error); return; }
    void proceed(args);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const args = actionArgs(action, values, ctx);
    if ("error" in args) { setError(args.error); return; }
    setError(null);
    await proceed(args);
  };

  // Mounted (closed) for every write, so nothing about a write depends on the
  // confirm being created on the fly; it opens only at the confirm stage.
  const text = ctx.isRead ? null : confirmText(action, values, ctx.source, kind);
  const Trigger = ctx.isRead ? Button : WriteButton;
  const destructive = !!action.confirm?.destructive || kind === "delete";
  const busy = pending || checking;
  const returnFocus = (e: Event) => focusOnClose(e, triggerRef);

  return (
    <>
      <Trigger
        ref={triggerRef}
        type="button" size={size} variant={destructive ? "danger" : "secondary"} className={TOUCH}
        onClick={start} disabled={busy && stage !== "result"} {...(ctx.isRead ? {} : { admin: action.admin })}
      >
        {action.admin && <KeyRound className="size-3.5" aria-hidden />}
        {action.label}
      </Trigger>

      {fields.length > 0 && (
        <Dialog open={stage === "fields"} onOpenChange={(v) => { if (!v) reset(); }}>
          <DialogContent size="lg" className="max-h-[90dvh] overflow-y-auto" onCloseAutoFocus={stage === "idle" ? returnFocus : undefined}>
            <form onSubmit={submit} noValidate>
              <DialogHeader>
                <DialogTitle>{action.label}</DialogTitle>
                <DialogDescription>
                  {ctx.source ? `${rowName(ctx.source, "This item")}. ` : ""}
                  {ctx.isRead ? "Read from Zuops when you press the button." : ctx.prefillFrom ? "Only what you change is sent to Zuops." : "Sent to Zuops when you press the button."}
                  {!ctx.isRead && " Anything that reaches people, changes automatic sending, uses credits, shares data or deletes asks you first."}
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="space-y-4">
                <FieldList fields={fields} values={values} idPrefix={idPrefix} onChange={(k, v) => { setValues((s) => ({ ...s, [k]: v })); setError(null); }} />
                {error && <p role="alert" className="flex items-start gap-2 text-sm text-critical"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{error}</p>}
              </DialogBody>
              <DialogFooter className="flex-wrap">
                <Button type="button" variant="ghost" className={TOUCH} onClick={reset}>Cancel</Button>
                {ctx.isRead
                  ? <Button type="submit" className={TOUCH} disabled={busy}>{pending ? "Reading" : action.label}</Button>
                  : <WriteButton type="submit" admin={action.admin} disabled={busy}>{busy ? "Working" : action.label}</WriteButton>}
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {text && (
        <ConfirmDialog
          open={stage === "confirm"}
          onOpenChange={(v) => { if (!v) setStage((s) => (s === "confirm" ? (fields.length ? "fields" : "idle") : s)); }}
          title={text.title}
          body={
            <span className="block space-y-2">
              <span className="block">{text.body}</span>
              {text.consequence && (
                <span className="flex items-start gap-2 text-caution">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{text.consequence}</span>
                </span>
              )}
            </span>
          }
          confirmLabel={action.confirm?.label ?? action.label}
          destructive={destructive}
          onConfirm={async (grant) => {
            if (built.current) await execute(built.current, grant);
          }}
        />
      )}

      <Dialog open={stage === "result"} onOpenChange={(v) => { if (!v) reset(); }}>
        <DialogContent size="lg" className="max-h-[90dvh] overflow-y-auto" onCloseAutoFocus={returnFocus}>
          <DialogHeader>
            <DialogTitle>{action.reveal ? action.reveal.title : action.label}</DialogTitle>
            <DialogDescription>{action.reveal ? action.reveal.note : "What Zuops answered."}</DialogDescription>
          </DialogHeader>
          <DialogBody className="min-w-0 space-y-3">
            {action.reveal ? (
              result?.secret ? (
                <div className="space-y-2">
                  <label htmlFor={`${idPrefix}-secret`} className="text-xs font-medium text-steel">Signing secret</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input id={`${idPrefix}-secret`} ref={secretRef} readOnly value={result.secret} className={`${TOUCH} min-w-0 flex-1 font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
                    <CopyButton text={result.secret} targetRef={secretRef} />
                  </div>
                </div>
              ) : (
                <p role="status" className="text-sm text-caution">Zuops did not send a signing secret back. Open the webhook in the Zuops app to get one.</p>
              )
            ) : (
              <ResultView data={result?.data} />
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" className={TOUCH} onClick={reset}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
