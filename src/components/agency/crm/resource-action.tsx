"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { newIdem, useZuWrite } from "./use-zu";
import { ConfirmDialog, TOUCH, WriteButton, type ConfirmGrant } from "./crm-ui";
import type { ActionDef } from "./resource-config";
import { FieldList } from "./resource-fields";
import {
  buildArgs, fillTemplate, findDeep, getPath, prefill, rowName, splitList, type BuiltArgs, type FormValues, type Obj,
} from "./resource-utils";
import { CopyButton, ResultView } from "./resource-values";

/* One action button and everything behind it:
     fields?   a Dialog that collects them first,
     confirm?  then a ConfirmDialog that states the count or the name; the
               request runs ONLY from its onConfirm (the server refuses
               operations that reach people, change automatic sending, or
               delete, without the grant it hands over),
     result    shown in the dialog for links and reads, a secret shown once.
   An Idempotency-Key is made when the action starts and reused on a retry. */

type Stage = "idle" | "fields" | "confirm" | "result";

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

/** The count a confirm states: a list field's length, or a row value. */
export function confirmCount(action: ActionDef, values: FormValues, source?: Obj | null): number | null {
  const c = action.confirm?.count;
  if (!c) return null;
  if ("field" in c) return splitList(values[`body:${c.field}`] ?? "").length;
  const v = getPath(source ?? {}, c.row);
  return typeof v === "number" ? v : Array.isArray(v) ? v.length : null;
}

export function confirmText(action: ActionDef, values: FormValues, source?: Obj | null): { title: string; body: string } {
  const vars = { count: confirmCount(action, values, source), name: rowName(source, "this"), values: plainValues(values) };
  return { title: fillTemplate(action.confirm!.title, vars), body: fillTemplate(action.confirm!.body, vars) };
}

function plainValues(values: FormValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) out[k.split(":")[1] ?? k] = v.replace(/_/g, " ");
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
  const [idem, setIdem] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ data?: unknown; secret?: string } | null>(null);
  const built = React.useRef<BuiltArgs | null>(null);
  const secretRef = React.useRef<HTMLInputElement | null>(null);
  const idPrefix = React.useId();

  const reset = () => {
    setStage("idle");
    setError(null);
    setResult(null); // a revealed secret is dropped here, never kept
    setIdem(null);
    built.current = null;
  };

  const execute = async (args: BuiltArgs, grant?: ConfirmGrant): Promise<void> => {
    const key = idem ?? newIdem();
    if (!idem) setIdem(key);
    const res = await run(
      action.op,
      {
        path: Object.keys(args.path).length ? args.path : undefined,
        query: Object.keys(args.query).length ? args.query : undefined,
        body: ctx.isRead || Object.keys(args.body).length === 0 ? undefined : args.body,
        idem: ctx.isRead ? undefined : key,
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
    setIdem(null);
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

  const start = () => {
    setError(null);
    setIdem(newIdem());
    if (fields.length > 0) {
      setValues(prefill(fields, ctx.prefillFrom ?? null));
      setStage("fields");
      return;
    }
    const args = actionArgs(action, {}, ctx);
    if ("error" in args) { toast.error(args.error); return; }
    if (action.confirm) {
      built.current = args;
      setStage("confirm");
      return;
    }
    void execute(args);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const args = actionArgs(action, values, ctx);
    if ("error" in args) { setError(args.error); return; }
    setError(null);
    if (action.confirm) {
      built.current = args;
      setStage("confirm");
      return;
    }
    await execute(args);
  };

  const text = action.confirm ? confirmText(action, values, ctx.source) : null;
  const Trigger = ctx.isRead ? Button : WriteButton;
  const destructive = !!action.confirm?.destructive;

  return (
    <>
      <Trigger
        type="button" size={size} variant={destructive ? "danger" : "secondary"} className={TOUCH}
        onClick={start} disabled={pending && stage !== "idle"} {...(ctx.isRead ? {} : { admin: action.admin })}
      >
        {action.admin && <KeyRound className="size-3.5" aria-hidden />}
        {action.label}
      </Trigger>

      {fields.length > 0 && (
        <Dialog open={stage === "fields"} onOpenChange={(v) => { if (!v) reset(); }}>
          <DialogContent size="lg" className="max-h-[90dvh] overflow-y-auto">
            <form onSubmit={submit} noValidate>
              <DialogHeader>
                <DialogTitle>{action.label}</DialogTitle>
                <DialogDescription>
                  {ctx.source ? `${rowName(ctx.source, "This item")}. ` : ""}
                  {action.confirm ? "You confirm on the next step before anything runs." : ctx.prefillFrom ? "Only what you change is sent to Zuops." : "Sent to Zuops when you press the button."}
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="space-y-4">
                <FieldList fields={fields} values={values} idPrefix={idPrefix} onChange={(k, v) => { setValues((s) => ({ ...s, [k]: v })); setError(null); }} />
                {error && <p role="alert" className="flex items-start gap-2 text-sm text-critical"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{error}</p>}
              </DialogBody>
              <DialogFooter className="flex-wrap">
                <Button type="button" variant="ghost" className={TOUCH} onClick={reset}>Cancel</Button>
                {ctx.isRead
                  ? <Button type="submit" className={TOUCH} disabled={pending}>{pending ? "Reading" : action.label}</Button>
                  : <WriteButton type="submit" admin={action.admin} disabled={pending}>{pending ? "Working" : action.confirm ? "Continue" : action.label}</WriteButton>}
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {action.confirm && text && (
        <ConfirmDialog
          open={stage === "confirm"}
          onOpenChange={(v) => { if (!v) setStage((s) => (s === "confirm" ? (fields.length ? "fields" : "idle") : s)); }}
          title={text.title}
          body={text.body}
          confirmLabel={action.confirm.label}
          destructive={destructive}
          onConfirm={async (grant) => {
            if (built.current) await execute(built.current, grant);
          }}
        />
      )}

      <Dialog open={stage === "result"} onOpenChange={(v) => { if (!v) reset(); }}>
        <DialogContent size="lg" className="max-h-[90dvh] overflow-y-auto">
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
