"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Org } from "@/components/settings/types";

type Look = "hardware" | "glass";

const LOOKS: { id: Look; label: string; blurb: string }[] = [
  { id: "hardware", label: "Pulse Hardware", blurb: "Machined studio gear: solid panels, physical keys. The default." },
  { id: "glass", label: "iOS Glass", blurb: "Frosted, see-through panels over the moving light, with pill controls." },
];

/**
 * The studio's surface style, two tiles with a live mini preview in the
 * studio's own colors. Saves the moment you pick one (branding.setUiStyle),
 * so the whole app, the booking page and the kiosk switch together.
 * `tokens` are the brand tokens of the colors being previewed above.
 */
export function UiStylePicker({ org, tokens }: { org: Org; tokens: Record<string, string> }) {
  const setUiStyle = useMutation(api.branding.setUiStyle);
  const saved: Look = org.uiStyle === "glass" ? "glass" : "hardware";
  const [pending, setPending] = React.useState<Look | null>(null);
  const active = pending ?? saved;

  async function pick(next: Look) {
    if (next === active || pending) return;
    setPending(next);
    try {
      await setUiStyle({ uiStyle: next });
      toast.success(next === "glass" ? "iOS Glass is on." : "Pulse Hardware is on.");
    } catch (err) {
      toast.error(err instanceof ConvexError ? String(err.data) : "Could not save the look.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-2">
      <p className="overline">Look</p>
      <div role="radiogroup" aria-label="Look" className="grid gap-3 sm:grid-cols-2">
        {LOOKS.map((look) => {
          const on = active === look.id;
          return (
            <button
              key={look.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={pending !== null}
              onClick={() => void pick(look.id)}
              className={cn(
                "group min-w-0 rounded-xl border p-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                on ? "border-gold bg-coal-2" : "border-graphite/60 hover:border-hairline-2",
              )}
            >
              <LookPreview look={look.id} tokens={tokens} />
              <span className="mt-2 flex items-center gap-2 px-1">
                <span
                  aria-hidden
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-full border",
                    on ? "border-gold" : "border-graphite",
                  )}
                >
                  {on && <span className="size-2 rounded-full bg-gold" />}
                </span>
                <span className="text-sm font-medium text-bone">{look.label}</span>
              </span>
              <span className="mt-0.5 block px-1 pb-1 pl-8 text-[0.6875rem] leading-snug text-steel">{look.blurb}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A still miniature of each look, drawn with inline styles only (no pl-* or
 * glass classes), so it shows its own look whichever one the app wears.
 * Same room light behind both: the brand's pools over the void.
 */
function LookPreview({ look, tokens }: { look: Look; tokens: Record<string, string> }) {
  const glass = look === "glass";
  return (
    <div
      aria-hidden
      className="relative isolate h-32 overflow-hidden rounded-lg"
      style={{ ...(tokens as React.CSSProperties), background: "#0f0f11" }}
    >
      <div
        className="absolute -left-10 -top-16 size-44 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(var(--pl-yellow-rgb, 255,201,0), 0.55), rgba(var(--pl-yellow-rgb, 255,201,0), 0.12) 55%, transparent)" }}
      />
      <div
        className="absolute -bottom-20 -right-10 size-44 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(var(--pl-copper-rgb, 208,148,123), 0.5), rgba(var(--pl-copper-rgb, 208,148,123), 0.1) 55%, transparent)" }}
      />
      <div className="absolute inset-0 flex gap-2 p-3">
        {/* rail */}
        <div
          className="w-1/4 shrink-0 p-2"
          style={
            glass
              ? {
                  borderRadius: 16,
                  background: "linear-gradient(145deg, rgba(255,255,255,.16), rgba(255,255,255,.04)), rgba(12,12,18,.45)",
                  border: "1px solid rgba(255,255,255,.2)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,.45), 0 6px 16px rgba(0,0,0,.35)",
                  backdropFilter: "blur(10px) saturate(180%)",
                  WebkitBackdropFilter: "blur(10px) saturate(180%)",
                }
              : {
                  borderRadius: 6,
                  background: "#242427",
                  border: "1px solid #3d3d41",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,.2), 2px 3px 0 #18181a, 0 8px 12px rgba(0,0,0,.5)",
                }
          }
        >
          <span className="block h-[3px] w-5 rounded-full" style={{ background: "rgb(var(--pl-yellow-rgb, 255,201,0))" }} />
          <span
            className="mt-2 block h-3"
            style={
              glass
                ? { borderRadius: 8, background: "rgba(var(--pl-yellow-rgb, 255,201,0), .3)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.35)" }
                : { borderRadius: 2, background: "#161618", boxShadow: "inset 1px 2px 3px rgba(0,0,0,.8)" }
            }
          />
          <span className="mt-1.5 block h-2 w-3/4 rounded-full bg-white/15" />
        </div>
        {/* card */}
        <div
          className="flex min-w-0 flex-1 flex-col justify-between p-2.5"
          style={
            glass
              ? {
                  borderRadius: 18,
                  background: "linear-gradient(145deg, rgba(255,255,255,.16), rgba(255,255,255,.04)), rgba(12,12,18,.45)",
                  border: "1px solid rgba(255,255,255,.2)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,.45), 0 6px 16px rgba(0,0,0,.35)",
                  backdropFilter: "blur(10px) saturate(180%)",
                  WebkitBackdropFilter: "blur(10px) saturate(180%)",
                }
              : {
                  borderRadius: 8,
                  background: "#2b2b2e",
                  border: "1px solid #3d3d41",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,.22), 2px 3px 0 #18181a, 0 8px 12px rgba(0,0,0,.5)",
                }
          }
        >
          <span className="block h-2 w-1/2 rounded-full bg-white/70" />
          <span className="block h-1.5 w-3/4 rounded-full bg-white/25" />
          <span className="flex items-center gap-1.5">
            <span
              className="block h-4 w-12"
              style={
                glass
                  ? {
                      borderRadius: 999,
                      background: "linear-gradient(180deg, var(--pl-yellow-top, #ffe066), var(--pl-yellow, #ffc900))",
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,.6), 0 4px 10px rgba(var(--pl-yellow-rgb, 255,201,0), .35)",
                    }
                  : {
                      borderRadius: 2,
                      background: "linear-gradient(180deg, var(--pl-yellow-top, #ffe066), var(--pl-yellow, #ffc900))",
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,.4), 1px 2px 0 #121214",
                    }
              }
            />
            <span
              className="block h-4 w-8"
              style={
                glass
                  ? { borderRadius: 999, background: "rgba(255,255,255,.14)", border: "1px solid rgba(255,255,255,.22)" }
                  : { borderRadius: 2, background: "#4a4a4e", boxShadow: "1px 2px 0 #121214" }
              }
            />
          </span>
        </div>
      </div>
    </div>
  );
}
