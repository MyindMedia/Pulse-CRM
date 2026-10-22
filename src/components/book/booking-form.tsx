"use client";

import * as React from "react";
import { Input, Textarea, Field } from "@/components/ui/field";
import { DEALS_DISCLOSURE } from "@convex/lib/deals";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

/** Service types accepted by `api.booking.createBooking`. */
export const SERVICE_TYPES = [
  "recording",
  "mixing",
  "mastering",
  "production",
  "consultation",
  "rehearsal",
  "writing",
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

export type BookingFormValues = {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  serviceType: ServiceType;
  notes: string;
  /** "Text me deals": marketing consent, separate from reminder texts and
   *  never pre-ticked (lib/deals.ts). */
  dealsOptIn: boolean;
};

export const emptyBookingForm: BookingFormValues = {
  clientName: "",
  clientEmail: "",
  clientPhone: "",
  serviceType: "recording",
  notes: "",
  dealsOptIn: false,
};

export function BookingForm({
  values,
  onChange,
}: {
  values: BookingFormValues;
  onChange: (next: BookingFormValues) => void;
}) {
  function set<K extends keyof BookingFormValues>(key: K, value: BookingFormValues[K]) {
    onChange({ ...values, [key]: value });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Your name" htmlFor="bk-name">
          <Input
            id="bk-name"
            value={values.clientName}
            onChange={(e) => set("clientName", e.target.value)}
            placeholder="Jordan Rivers"
            autoComplete="name"
          />
        </Field>
        <Field label="Email" htmlFor="bk-email">
          <Input
            id="bk-email"
            type="email"
            value={values.clientEmail}
            onChange={(e) => set("clientEmail", e.target.value)}
            placeholder="you@email.com"
            autoComplete="email"
          />
        </Field>
      </div>

      {/* Phone and the service picker each get a full row - this form lives in
          a narrow sidebar on the room page, and a half-width select truncates
          both its value and its dropdown options. */}
      <Field
        label="Phone"
        htmlFor="bk-phone"
        hint={
          <>
            Optional - by giving your number you agree to receive session
            reminders &amp; booking updates by text. Message frequency varies.
            Msg/data rates may apply. Reply STOP to opt out, HELP for help.
            Consent is not a condition of purchase. See our{" "}
            <a href="/privacy" className="underline hover:text-gold">
              Privacy Policy
            </a>{" "}
            and{" "}
            <a href="/terms" className="underline hover:text-gold">
              Terms
            </a>
            .
          </>
        }
      >
        <Input
          id="bk-phone"
          type="tel"
          value={values.clientPhone}
          onChange={(e) => set("clientPhone", e.target.value)}
          placeholder="(555) 012-3456"
          autoComplete="tel"
        />
      </Field>
      {values.clientPhone.trim() && (
        <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-steel">
          <input
            type="checkbox"
            checked={values.dealsOptIn}
            onChange={(e) => set("dealsOptIn", e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[#fdb913]"
          />
          <span>{DEALS_DISCLOSURE}</span>
        </label>
      )}
      <Field label="What are you booking for?">
        <Select
          value={values.serviceType}
          onValueChange={(v) => set("serviceType", v as ServiceType)}
        >
          <SelectTrigger className="w-full capitalize">
            <SelectValue placeholder="Select a service" />
          </SelectTrigger>
          <SelectContent>
            {SERVICE_TYPES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Notes" htmlFor="bk-notes" hint="Optional - tell the studio anything useful.">
        <Textarea
          id="bk-notes"
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Bringing a 4-piece band, need extra mic stands…"
        />
      </Field>
    </div>
  );
}
