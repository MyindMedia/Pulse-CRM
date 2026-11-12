"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Play, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { ZU_OPS, type ZuField, type ZuOp } from "@convex/crm/ops.generated";
import { BODY_RULES, confirmKind, level, type ConfirmKind } from "@convex/crm/policy";
import { useIdemFor, useZuWrite } from "./use-zu";
import { ConfirmDialog, TOUCH, WriteButton, confirmCopy, type ConfirmGrant } from "./crm-ui";
import type { FieldDef } from "./resource-config";
import { FieldList } from "./resource-fields";
import { useReturnFocus } from "./resource-focus";
import { buildArgs, fingerprint, mergeExtra, redactSecrets, type BuiltArgs, type FormValues } from "./resource-utils";
import { CopyButton } from "./resource-values";
import { KIND_LABEL, LEVEL_LABEL } from "./functions-catalog";
import { KindIcon } from "./functions-kind";

/* A form for any one of the Zuops operations, built from the registry: path
   params (required), query fields, body fields (text, number, yes/no, a select
   for an enum, JSON for arrays and objects), and for operations that take fields
   the spec does not list, the suggested fields plus a free JSON object.

   A read runs on Run. A write runs through WriteButton (Full access when the
   scope is :admin). An operation the server gates behind a confirm (reaches
   people, changes automatic sending, deletes, or create_lead with run_intake)
   has NO direct run path: its button only opens ConfirmDialog, and the request
   is sent from that dialog's onConfirm with the grant it hands over.

   The answer lives in this component's state only. */

const LONG_TEXT = /^(body|message|html|note|notes|intro|terms|description|prompt|instruction|text|greeting|answer|question|brief|css|summary|first_message.*|.*_message|.*_template|extra_instructions|ai_prompt|ai_context_note)$/;

export function toFieldDef(f: ZuField, where: "path" | "query" | "body"): FieldDef {
  const base = { name: f.name, label: f.name, required: !!f.required, help: f.desc, in: where } as const;
  if (f.enum?.length) return { ...base, type: "select", options: f.enum };
  switch (f.type) {
    case "number":
    case "integer":
      return { ...base, type: "number" };
    case "boolean":
      return { ...base, type: "boolean" };
    case "array":
      return { ...base, type: "json", jsonShape: "array", help: f.desc ? `${f.desc} JSON list.` : "A JSON list, like [\"a\", \"b\"]." };
    case "object":
      return { ...base, type: "json", jsonShape: "object", help: f.desc ? `${f.desc} JSON object.` : "A JSON object." };
    default:
      return { ...base, type: where === "body" && LONG_TEXT.test(f.name) ? "textarea" : "text" };
  }
}

/** Every control the operation's form shows, in order: path, query, body (or
 *  the suggested fields for an open body). */
export function opFields(op: ZuOp): FieldDef[] {
  const body = op.body.length ? op.body : op.openBody ? (op.suggest ?? []) : [];
  return [
    ...op.pathParams.map((p): FieldDef => ({ name: p, label: p, type: "text", required: true, in: "path", help: "From the matching list or record." })),
    ...op.query.map((f) => toFieldDef(f, "query")),
    ...body.map((f) => toFieldDef(f, "body")),
  ];
}

export type RunPlan = "read" | "write" | "confirm";

/** How a request with this body is run: the server's policy decides, for the
 *  exact body (create_lead with run_intake, a Google post with approve, an
 *  optimizer run without dry_run, and so on). */
export function runPlan(op: ZuOp, body?: unknown): RunPlan {
  if (op.method === "GET") return "read";
  return confirmKind(op, body) ? "confirm" : "write";
}

export const STARTS_INTAKE = "This starts the new-lead texts for this person.";

/** The consequence line for this op and body ("" when none is needed). */
export function confirmSentence(op: ZuOp, body?: unknown): string {
  const kind = confirmKind(op, body);
  if (!kind) return "";
  if (op.id === "create_lead" && kind === "reaches") return STARTS_INTAKE;
  return confirmCopy(kind);
}

/** What the request acts on, in words: the ids in its address. */
export function targetText(op: ZuOp, args: Pick<BuiltArgs, "path">): string {
  const ids = Object.entries(args.path).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`);
  return ids.length ? `On ${ids.join(", ")}.` : "On this sub-account.";
}

const dependsOnBody = (op: ZuOp) => Object.prototype.hasOwnProperty.call(BODY_RULES, op.id);

/** Answers keep the one-time webhook signing secret (shown once, stored by the
 *  person); every other secret-looking value is hidden before it is shown. */
const KEEP_SECRET: Record<string, readonly string[]> = { create_outbound_webhook: ["secret", "signing_secret", "webhook_secret"] };

export function answerText(opId: string, data: unknown): string {
  if (data === undefined) return "";
  try {
    return JSON.stringify(redactSecrets(data, KEEP_SECRET[opId] ?? []), null, 2) ?? "";
  } catch {
    return "";
  }
}

/** Build the request from the form; path params must be filled, the rest is
 *  left to Zuops (it names a missing field better than we can). */
export function opArgs(op: ZuOp, values: FormValues, extra: string): BuiltArgs | { error: string } {
  const built = buildArgs(opFields(op), values, { enforceRequired: (f) => f.in === "path" });
  if ("error" in built) return built;
  if (!op.openBody) return built;
  const merged = mergeExtra(built.body, extra);
  if ("error" in merged) return merged;
  return { ...built, body: merged.body };
}

type Result = { opId: string; ok: boolean; status: number; reason?: string; code?: string; text: string };

export type OpFormProps = {
  opId: string;
  initial?: FormValues;
  onDone?: (result: { ok: boolean; status: number; data?: unknown }) => void;
};

export function OpForm({ opId, initial, onDone }: OpFormProps) {
  const op = ZU_OPS[opId];
  const { run, pending } = useZuWrite();
  const fields = React.useMemo(() => (op ? opFields(op) : []), [op]);
  const [values, setValues] = React.useState<FormValues>(() => ({ ...(initial ?? {}) }));
  const [extra, setExtra] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [result, setResult] = React.useState<Result | null>(null);
  const [staged, setStaged] = React.useState<{ args: BuiltArgs; kind: ConfirmKind } | null>(null);
  // One Idempotency-Key per distinct set of values; `round` moves on after a success.
  const [round, setRound] = React.useState(0);
  const idemKey = useIdemFor(`${round}|${fingerprint({ values, extra })}`);
  const preRef = React.useRef<HTMLPreElement | null>(null);
  const submitRef = React.useRef<HTMLButtonElement | null>(null);
  const idPrefix = React.useId();
  useReturnFocus(confirming, submitRef);

  if (!op) return <p role="alert" className="text-sm text-critical">Zuops has no function called {opId}.</p>;

  const lv = level(op);
  const kind = confirmKind(op);
  const varies = dependsOnBody(op);

  const send = async (args: BuiltArgs, grant?: ConfirmGrant) => {
    const isRead = op.method === "GET";
    const body = isRead || Object.keys(args.body).length === 0 ? undefined : args.body;
    const res = await run(op.id, {
      path: Object.keys(args.path).length ? args.path : undefined,
      query: Object.keys(args.query).length ? args.query : undefined,
      body,
      idem: isRead ? undefined : idemKey,
      ...grant,
    });
    setResult({ opId: op.id, ok: res.ok, status: res.status, reason: res.reason, code: res.code, text: answerText(op.id, res.data) });
    if (res.ok) {
      setRound((n) => n + 1); // after a success the next run is a new request
      if (!isRead) toast.success("Done in Zuops.");
    }
    onDone?.({ ok: res.ok, status: res.status, data: res.data });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const args = opArgs(op, values, extra);
    if ("error" in args) { setError(args.error); return; }
    setError(null);
    // The server's policy, for the body about to be sent.
    const k = op.method === "GET" ? null : confirmKind(op, args.body);
    if (k) {
      setStaged({ args, kind: k });
      setConfirming(true);
      return;
    }
    await send(args);
  };

  const plan = runPlan(op);
  const label = plan === "confirm" ? "Review and confirm" : "Run";
  const shown = result && result.opId === op.id ? result : null;

  return (
    <div className="min-w-0 space-y-5">
      <div className="space-y-2">
        <p className="break-all font-mono text-xs text-steel"><span className="font-semibold text-bone">{op.method}</span> {op.path}</p>
        <div className="flex flex-wrap gap-1.5">
          <LevelBadge level={lv} />
          {kind && <Badge tone={kind === "delete" ? "critical" : "caution"}><KindIcon kind={kind} />{KIND_LABEL[kind]}</Badge>}
          <Badge>{op.area}</Badge>
        </div>
      </div>

      <form onSubmit={submit} noValidate className="space-y-4">
        {fields.length === 0 && !op.openBody && <p className="text-sm text-steel">This function takes nothing. Press {label}.</p>}
        <FieldList fields={fields} values={values} idPrefix={idPrefix} onChange={(k, v) => { setValues((s) => ({ ...s, [k]: v })); setError(null); }} />
        {op.openBody && (
          <Field label="More fields (JSON object)" htmlFor={`${idPrefix}-extra`} hint="Any other fields Zuops documents for this function, merged into the body.">
            <Textarea id={`${idPrefix}-extra`} value={extra} onChange={(e) => { setExtra(e.target.value); setError(null); }} spellCheck={false} className="min-h-20 font-mono text-xs" />
          </Field>
        )}
        {error && <p role="alert" className="flex items-start gap-2 text-sm text-critical"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {plan === "read" ? (
            <Button ref={submitRef} type="submit" className={TOUCH} disabled={pending}><Play className="size-4" aria-hidden />{pending ? "Running" : label}</Button>
          ) : (
            <WriteButton ref={submitRef} type="submit" admin={lv === "admin"} disabled={pending}><Play className="size-4" aria-hidden />{pending ? "Running" : label}</WriteButton>
          )}
          {kind ? (
            <span className="text-xs text-caution">{confirmCopy(kind)} You confirm before it runs.</span>
          ) : varies ? (
            <span className="text-xs text-caution">Some values make this reach people, change automatic sending or use credits. You confirm before those run.</span>
          ) : null}
        </div>
      </form>

      {op.method !== "GET" && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={`Run ${op.summary}?`}
          body={
            <span className="block space-y-2">
              <span className="block"><span className="font-mono text-xs text-bone">{op.id}</span>. {staged ? targetText(op, staged.args) : ""}</span>
              {(staged?.kind ?? kind) && (
                <span className="flex items-start gap-2 text-caution">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{staged ? confirmSentence(op, staged.args.body) : confirmCopy(kind!)}</span>
                </span>
              )}
            </span>
          }
          confirmLabel="Run it"
          destructive={(staged?.kind ?? kind) === "delete"}
          onConfirm={async (grant) => {
            if (staged) await send(staged.args, grant);
          }}
        />
      )}

      {shown && <ResultBlock result={shown} preRef={preRef} />}
    </div>
  );
}

export function LevelBadge({ level: lv }: { level: "read" | "write" | "admin" }) {
  return (
    <Badge tone={lv === "read" ? "info" : lv === "write" ? "positive" : "gold"}>
      {lv === "read" ? <CheckCircle2 className="size-3" aria-hidden /> : lv === "write" ? <Play className="size-3" aria-hidden /> : <AlertTriangle className="size-3" aria-hidden />}
      {LEVEL_LABEL[lv]}
    </Badge>
  );
}

function ResultBlock({ result, preRef }: { result: Result; preRef: React.RefObject<HTMLPreElement | null> }) {
  return (
    <section aria-label="Answer from Zuops" className="space-y-2 rounded-xl border border-graphite/50 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        {result.ok
          ? <Badge tone="positive"><CheckCircle2 className="size-3" aria-hidden />OK {result.status || ""}</Badge>
          : <Badge tone="critical"><XCircle className="size-3" aria-hidden />Refused{result.status ? ` ${result.status}` : ""}</Badge>}
        {result.code && <span className="font-mono text-xs text-steel">{result.code}</span>}
        {result.text && <span className="ml-auto"><CopyButton text={result.text} targetRef={preRef} label="Copy JSON" /></span>}
      </div>
      {!result.ok && result.reason && <p role="alert" className="text-sm text-bone">{result.reason}</p>}
      {result.text ? (
        <pre ref={preRef} tabIndex={0} aria-label="Answer JSON" className="max-h-96 select-text overflow-auto whitespace-pre rounded-md bg-obsidian p-3 font-mono text-xs text-ash outline-none focus-visible:ring-2 focus-visible:ring-gold/30">
          {result.text}
        </pre>
      ) : (
        result.ok && <p className="text-sm text-steel">Zuops sent nothing back to show.</p>
      )}
    </section>
  );
}
