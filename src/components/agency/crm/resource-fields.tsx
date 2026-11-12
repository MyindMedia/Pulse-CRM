"use client";

import * as React from "react";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { TOUCH } from "./crm-ui";
import type { FieldDef } from "./resource-config";
import { fieldKey, UNSET, type FormValues } from "./resource-utils";

/* One labeled control per FieldDef, shared by the resource dialogs and the
   Functions form. Every value is text in the form (booleans are "yes", "no" or
   not set); resource-utils.ts `buildArgs` turns them into the request. */

const NOT_SET = "__unset";

function label(f: FieldDef): string {
  return f.required ? `${f.label} (required)` : f.label;
}

export function FieldInput({
  field, value, onChange, idPrefix,
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
  idPrefix: string;
}) {
  const id = `${idPrefix}-${(field.in ?? "body")}-${field.name}`;
  const hint = field.help ?? (field.list ? "Separate with commas or new lines." : field.type === "json" ? "JSON. Checked before it is sent." : undefined);

  if (field.type === "boolean" || field.type === "select") {
    const requiredChoice = !!field.required && field.type === "select";
    const options = field.type === "boolean" ? [["yes", "Yes"], ["no", "No"]] : (field.options ?? []).map((o) => [o, o.replace(/_/g, " ")]);
    return (
      <Field label={label(field)} htmlFor={id} hint={hint}>
        {/* A required choice has no "Not set" item and starts on the "Choose…"
            placeholder, so nothing is silently left blank (R3-R5); submit names it. */}
        <Select value={value === UNSET ? (requiredChoice ? "" : NOT_SET) : value} onValueChange={(v) => onChange(v === NOT_SET ? UNSET : v)}>
          <SelectTrigger id={id} className={TOUCH} aria-required={field.required || undefined}><SelectValue placeholder="Choose…" /></SelectTrigger>
          <SelectContent>
            {!requiredChoice && <SelectItem value={NOT_SET}>{field.type === "boolean" ? "Leave as is" : "Not set"}</SelectItem>}
            {options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
    );
  }

  if (field.type === "textarea" || field.type === "json") {
    return (
      <Field label={label(field)} htmlFor={id} hint={hint}>
        <Textarea
          id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-required={field.required || undefined}
          spellCheck={field.type !== "json"} className={cn(field.type === "json" && "font-mono text-xs", "min-h-20")}
        />
      </Field>
    );
  }

  const type = field.type === "number" ? "text" : field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : "text";
  return (
    <Field label={label(field)} htmlFor={id} hint={hint}>
      <Input
        id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} className={TOUCH} autoComplete="off"
        inputMode={field.type === "number" ? "decimal" : undefined} aria-required={field.required || undefined}
      />
    </Field>
  );
}

export function FieldList({
  fields, values, onChange, idPrefix,
}: {
  fields: readonly FieldDef[];
  values: FormValues;
  onChange: (key: string, v: string) => void;
  idPrefix: string;
}) {
  return (
    <div className="space-y-4">
      {fields.map((f) => {
        const k = fieldKey(f);
        return <FieldInput key={k} field={f} value={values[k] ?? UNSET} onChange={(v) => onChange(k, v)} idPrefix={idPrefix} />;
      })}
    </div>
  );
}
