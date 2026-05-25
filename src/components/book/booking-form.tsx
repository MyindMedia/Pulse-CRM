"use client";

import * as React from "react";
import { Input, Textarea, Field } from "@/components/ui/field";
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
};

export const emptyBookingForm: BookingFormValues = {
  clientName: "",
  clientEmail: "",
  clientPhone: "",
  serviceType: "recording",
  notes: "",
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
      <div className="grid gap-4 sm:grid-cols-2">
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Phone"
          htmlFor="bk-phone"
          hint="Optional — we'll text session reminders & updates. Msg/data rates may apply; reply STOP to opt out."
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
        <Field label="What are you booking for?">
          <Select
            value={values.serviceType}
            onValueChange={(v) => set("serviceType", v as ServiceType)}
          >
            <SelectTrigger>
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
      </div>

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
