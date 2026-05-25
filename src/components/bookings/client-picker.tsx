"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Check, UserPlus } from "lucide-react";
import { Field, Input } from "@/components/ui/field";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";

export type ClientValue = {
  artistId?: string; // set when an EXISTING artist is chosen
  name: string;
  email?: string;
  phone?: string;
};

/**
 * Client / booker selector. Either pick an existing contact from the roster
 * (optional dropdown) - which fills the booking and lets you continue - or add
 * a new client with full contact details. The two are mutually exclusive.
 */
export function ClientPicker({
  value,
  onChange,
  autoFocus,
}: {
  value: ClientValue;
  onChange: (v: ClientValue) => void;
  autoFocus?: boolean;
}) {
  const roster = useQuery(api.artists.roster) as
    | { _id: string; name: string }[]
    | undefined;
  const selected = !!value.artistId;

  return (
    <div className="space-y-4">
      {/* Existing contact - optional, pick from the roster. */}
      <Field label="Existing contact" hint="Pick someone from your roster, or add a new client below.">
        <Select
          value={value.artistId ?? ""}
          onValueChange={(id) => {
            const a = roster?.find((r) => r._id === id);
            if (a) onChange({ artistId: a._id, name: a.name });
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder={roster && roster.length === 0 ? "No contacts yet" : "Select from roster (optional)"} />
          </SelectTrigger>
          <SelectContent>
            {(roster ?? []).map((a) => (
              <SelectItem key={a._id} value={a._id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {selected ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-hairline-2 bg-ink-2 px-3 py-2.5 text-sm">
          <span className="inline-flex items-center gap-2 text-bone">
            <Check className="size-4 text-positive" /> Booking for <b className="font-semibold">{value.name}</b>
          </span>
          <button type="button" className="text-xs text-ash transition-colors hover:text-bone" onClick={() => onChange({ name: "" })}>
            Add a new client instead
          </button>
        </div>
      ) : (
        <div className="space-y-4 rounded-md border border-hairline bg-coal/40 p-3">
          <p className="inline-flex items-center gap-1.5 text-xs text-ash-dim">
            <UserPlus className="size-3.5 text-gold" /> New client - added to your roster on booking.
          </p>
          <Field label="Full name" htmlFor="client-name">
            <Input
              id="client-name"
              autoFocus={autoFocus}
              autoComplete="off"
              placeholder="e.g. Jordan Vega"
              value={value.name}
              onChange={(e) => onChange({ ...value, artistId: undefined, name: e.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" htmlFor="client-email">
              <Input
                id="client-email"
                type="email"
                autoComplete="off"
                placeholder="client@email.com"
                value={value.email ?? ""}
                onChange={(e) => onChange({ ...value, email: e.target.value })}
              />
            </Field>
            <Field label="Phone" htmlFor="client-phone" hint="For session reminders.">
              <Input
                id="client-phone"
                type="tel"
                autoComplete="off"
                placeholder="(555) 010-0100"
                value={value.phone ?? ""}
                onChange={(e) => onChange({ ...value, phone: e.target.value })}
              />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}
