"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Check, UserPlus, Search } from "lucide-react";
import { Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export type ClientValue = {
  artistId?: string; // set when an EXISTING artist is chosen
  name: string;
  email?: string;
  phone?: string;
};

/**
 * Client / booker selector for booking screens. Type a name freely - first-time
 * bookers don't need to exist yet. As you type, matching existing artists
 * surface in a dropdown; picking one links the booking to that artist. If the
 * name doesn't match, it's treated as a NEW client (with optional contact),
 * created on booking.
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
  const [open, setOpen] = React.useState(false);

  const q = value.name.trim().toLowerCase();
  const matches = (roster ?? [])
    .filter((a) => a.name.toLowerCase().includes(q))
    .slice(0, 6);
  const exact = (roster ?? []).find((a) => a.name.toLowerCase() === q);
  const isNew = !value.artistId && value.name.trim().length > 0 && !exact;

  return (
    <div className="space-y-4">
      <Field
        label="Client"
        htmlFor="client-name"
        hint="Type a name - pick an existing client below, or it'll be added as a new one."
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ash-dim" />
          <Input
            id="client-name"
            className="pl-8"
            autoFocus={autoFocus}
            autoComplete="off"
            placeholder="e.g. Jordan Vega"
            value={value.name}
            onChange={(e) => {
              // Typing detaches from any previously-picked artist (becomes new).
              onChange({ ...value, artistId: undefined, name: e.target.value });
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
          />
          {value.artistId && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-positive">
              <Check className="size-4" />
            </span>
          )}

          {open && value.name.trim().length > 0 && (matches.length > 0 || isNew) && (
            <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-hairline-2 bg-coal shadow-pop">
              {matches.map((a) => (
                <button
                  key={a._id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange({ artistId: a._id, name: a.name });
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-bone hover:bg-ink-2",
                    value.artistId === a._id && "bg-ink-2",
                  )}
                >
                  <span className="grid size-5 place-items-center rounded-full bg-gold/15 text-[0.625rem] font-bold text-gold">
                    {a.name.slice(0, 1).toUpperCase()}
                  </span>
                  {a.name}
                </button>
              ))}
              {isNew && (
                <div className="flex items-center gap-2 border-t border-hairline px-3 py-2 text-xs text-ash">
                  <UserPlus className="size-3.5 text-gold" />
                  New client - “{value.name.trim()}” will be added to your roster.
                </div>
              )}
            </div>
          )}
        </div>
      </Field>

      {/* Optional contact for a brand-new client */}
      {isNew && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email (optional)" htmlFor="client-email">
            <Input
              id="client-email"
              type="email"
              autoComplete="off"
              placeholder="client@email.com"
              value={value.email ?? ""}
              onChange={(e) => onChange({ ...value, email: e.target.value })}
            />
          </Field>
          <Field label="Phone (optional)" htmlFor="client-phone">
            <Input
              id="client-phone"
              autoComplete="off"
              placeholder="(555) 010-0100"
              value={value.phone ?? ""}
              onChange={(e) => onChange({ ...value, phone: e.target.value })}
            />
          </Field>
        </div>
      )}
    </div>
  );
}
