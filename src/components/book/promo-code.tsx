"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { BadgePercent, Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

/** What the parent needs to know about the promo code: nothing applied,
 *  still checking, valid (with the server-confirmed percent), or invalid.
 *  Display-only - the server re-validates and recomputes on createBooking. */
export type PromoState =
  | { status: "none" }
  | { status: "checking"; code: string }
  | { status: "valid"; code: string; pct: number; label: string | null }
  | { status: "invalid"; code: string };

export const emptyPromo: PromoState = { status: "none" };

export function PromoCode({
  roomId,
  initialCode,
  onChange,
}: {
  roomId: Id<"rooms">;
  /** Prefill from a ?code= booking link (the AI's promo emails send these). */
  initialCode?: string;
  onChange: (state: PromoState) => void;
}) {
  const normalizedInitial = initialCode?.trim().toUpperCase() ?? "";
  const [draft, setDraft] = React.useState(normalizedInitial);
  const [applied, setApplied] = React.useState(normalizedInitial);
  const check = useQuery(
    api.booking.validateCode,
    applied ? { roomId, code: applied } : "skip",
  );

  // Derive the state the parent gates totals + submit on.
  const state: PromoState = !applied
    ? { status: "none" }
    : check === undefined
      ? { status: "checking", code: applied }
      : check.valid
        ? { status: "valid", code: check.code, pct: check.pct, label: check.label }
        : { status: "invalid", code: applied };

  // Report every state change up (including the initial ?code= prefill). Keep a
  // latest-value ref so the report effect doesn't refire on parent re-renders.
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const stateKey = `${state.status}:${"code" in state ? state.code : ""}`;
  React.useEffect(() => {
    onChangeRef.current(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey]);

  function apply() {
    setApplied(draft.trim().toUpperCase());
  }
  function clear() {
    setDraft("");
    setApplied("");
  }

  // Applied + valid: a green confirmation chip with a remove button.
  if (state.status === "valid") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-positive/30 bg-positive/10 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-sm text-bone">
          <BadgePercent className="size-4 shrink-0 text-positive" />
          <span className="truncate">
            <span className="font-meta font-medium">{state.code}</span>
            <span className="text-steel"> - {state.pct}% off</span>
            {state.label && <span className="text-steel/70"> ({state.label})</span>}
          </span>
        </div>
        <button
          type="button"
          onClick={clear}
          aria-label="Remove discount code"
          className="text-steel/70 transition-colors hover:text-bone"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
          placeholder="Discount code"
          aria-label="Discount code"
          className="h-9 flex-1 font-meta uppercase"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          disabled={!draft.trim() || state.status === "checking"}
          onClick={apply}
        >
          {state.status === "checking" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            "Apply"
          )}
        </Button>
      </div>
      {/* Invalid: say so and keep the code visibly NOT applied - the client
          clears it (or fixes it) before booking at full price. */}
      {state.status === "invalid" && (
        <p className="flex items-center justify-between gap-2 text-xs text-caution">
          <span>
            Code {state.code} isn&apos;t valid or has expired. Clear it to book at
            the standard rate.
          </span>
          <button
            type="button"
            onClick={clear}
            className="shrink-0 underline underline-offset-2 hover:text-bone"
          >
            Clear code
          </button>
        </p>
      )}
    </div>
  );
}
