"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { Check, UserRound, Plus, Music4, Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { money } from "@/lib/format";
import { Textarea } from "@/components/ui/field";

/** What the picker reports up to the booking page. */
export type AddOnSelection = {
  engineerId?: Id<"members">;
  engineerName?: string;
  /** Client declared they need an engineer - picking a person is required. */
  needsEngineer: boolean;
  gear: { id: Id<"equipment">; name: string; priceCents: number }[];
  gearRequestNote: string;
  addOnTotalCents: number;
};

export const emptyAddOns: AddOnSelection = {
  needsEngineer: false,
  gear: [],
  gearRequestNote: "",
  addOnTotalCents: 0,
};

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/**
 * Engineer + a-la-carte premium-gear add-ons for one room and time window.
 * Availability is conflict-checked server-side (api.booking.addOnOptions): an
 * engineer or single-unit piece already on an overlapping session shows as
 * unavailable and can't be selected. Unavailable or unlisted gear can still be
 * requested via the note, and the studio team is notified.
 */
export function AddOnsPicker({
  roomId,
  selection,
  onChange,
}: {
  roomId: Id<"rooms">;
  selection: { startTime: number; durationHours: number } | null;
  onChange: (value: AddOnSelection) => void;
}) {
  const options = useQuery(
    api.booking.addOnOptions,
    selection
      ? { roomId, startTime: selection.startTime, durationHours: selection.durationHours }
      : "skip",
  );

  // The user's raw picks. We never mutate these from an effect; instead the
  // EFFECTIVE selection is derived against live availability, so a pick that
  // becomes unavailable for the chosen time is simply ignored (and re-appears
  // if it frees up) without a render cascade.
  const [engineerId, setEngineerId] = React.useState<Id<"members"> | undefined>(undefined);
  const [needsEngineer, setNeedsEngineer] = React.useState(false);
  const [gearIds, setGearIds] = React.useState<Id<"equipment">[]>([]);
  const [note, setNote] = React.useState("");

  const derived = React.useMemo<AddOnSelection>(() => {
    if (!options) return emptyAddOns;
    const eng = options.engineers.find((e) => e.id === engineerId && e.available);
    const liveGear = options.gear.filter((g) => gearIds.includes(g.id) && g.available);
    return {
      // An engineer only rides the booking when the client declared they need
      // one - the roster is hidden (and any earlier pick ignored) otherwise.
      engineerId: needsEngineer ? eng?.id : undefined,
      engineerName: needsEngineer ? eng?.name : undefined,
      needsEngineer,
      gear: liveGear.map((g) => ({ id: g.id, name: g.name, priceCents: g.priceCents })),
      gearRequestNote: note.trim(),
      addOnTotalCents: liveGear.reduce((s, g) => s + g.priceCents, 0),
    };
  }, [options, engineerId, gearIds, note, needsEngineer]);

  // Report up only when the effective selection actually changes.
  const signature = JSON.stringify({
    e: derived.engineerId ?? null,
    ne: derived.needsEngineer,
    g: derived.gear.map((x) => x.id),
    n: derived.gearRequestNote,
    t: derived.addOnTotalCents,
  });
  React.useEffect(() => {
    onChange(derived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const selectedGearIds = new Set(derived.gear.map((g) => g.id));

  if (!selection) {
    return (
      <div className="rounded-lg border border-dashed border-graphite/60 bg-coal/50 p-4 text-sm text-steel/80">
        Pick a date and time above to choose your engineer and add premium gear.
      </div>
    );
  }

  if (options === undefined) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-graphite/50 bg-coal p-5 text-sm text-steel">
        <Loader2 className="size-4 animate-spin" />
        Checking what is available for your time…
      </div>
    );
  }

  const { engineers, gear } = options;
  if (engineers.length === 0 && gear.length === 0) return null;

  function toggleGear(id: Id<"equipment">) {
    setGearIds((cur) => (cur.includes(id) ? cur.filter((g) => g !== id) : [...cur, id]));
  }

  return (
    <div className="space-y-6 rounded-lg border border-graphite/50 bg-coal p-5">
      {/* Engineer / producer */}
      {engineers.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <UserRound className="size-4 text-gold" />
            <h3 className="font-grotesk text-base font-semibold tracking-tight text-bone">
              Need an engineer?
            </h3>
            <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-sm text-steel">
              <input
                type="checkbox"
                checked={needsEngineer}
                onChange={(e) => setNeedsEngineer(e.target.checked)}
                className="size-4 accent-[#fdb913]"
              />
              I need an engineer for this session
            </label>
          </div>
          {/* The roster reveals only once the client says they need an
              engineer - checking the box is what opens the selection. */}
          {needsEngineer && (
            <>
              <p className="text-xs text-steel/70">
                Pick who you want to work with - it&apos;s required so the right person can confirm
                your session. Your booking is finalized once they accept.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {engineers.map((e) => (
                  <OptionRow
                    key={e.id}
                    selected={derived.engineerId === e.id}
                    disabled={!e.available}
                    onClick={() => setEngineerId(e.id)}
                    avatar={e.photoUrl ?? undefined}
                    avatarFallback={initial(e.name)}
                    title={e.name}
                    subtitle={e.available ? e.role.replace(/_/g, " ") : "Booked for this time"}
                    bio={e.bio}
                    credits={e.credits}
                  />
                ))}
              </div>
            </>
          )}
          {needsEngineer && derived.engineerId && derived.engineerName && (
            <p className="rounded-md border border-gold/30 bg-gold/[0.06] px-3 py-2 text-xs text-gold">
              {derived.engineerName} will be asked to confirm this session - you&apos;ll get an
              email as soon as it&apos;s locked in.
            </p>
          )}
          {needsEngineer && !derived.engineerId && (
            <p className="text-xs text-critical">Select an engineer to continue.</p>
          )}
        </section>
      )}

      {/* Premium gear add-ons */}
      {gear.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Music4 className="size-4 text-gold" />
            <h3 className="font-grotesk text-base font-semibold tracking-tight text-bone">
              Premium gear add-ons
            </h3>
            <span className="text-xs text-steel/60">a-la-carte</span>
          </div>
          <div className="space-y-2">
            {gear.map((g) => {
              const checked = selectedGearIds.has(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  disabled={!g.available}
                  onClick={() => toggleGear(g.id)}
                  className={[
                    "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    !g.available
                      ? "cursor-not-allowed border-graphite/40 bg-coal-2/40 opacity-60"
                      : checked
                        ? "border-gold/60 bg-gold/[0.06]"
                        : "border-graphite/50 bg-coal-2 hover:border-bone/40",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "grid size-5 shrink-0 place-items-center rounded border",
                      checked ? "border-gold bg-gold text-gold-ink" : "border-graphite/70",
                    ].join(" ")}
                  >
                    {checked && <Check className="size-3.5" />}
                  </span>
                  {g.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={g.photo}
                      alt=""
                      className="size-9 shrink-0 rounded-md object-cover"
                      draggable={false}
                    />
                  ) : (
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-coal-3 text-steel">
                      <Music4 className="size-4" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-grotesk text-sm font-medium text-bone">
                      {g.name}
                    </span>
                    <span className="block text-xs capitalize text-steel/70">
                      {g.available
                        ? g.category.replace(/_/g, " ")
                        : "Unavailable for this time"}
                    </span>
                  </span>
                  <span className="shrink-0 font-meta text-sm text-gold-bright">
                    {money(g.priceCents)}
                    <span className="text-xs text-steel/60"> /session</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5 pt-1">
            <label
              htmlFor="gear-request"
              className="flex items-center gap-1.5 text-xs text-steel"
            >
              <Plus className="size-3.5 text-gold" />
              Need a specific mic or piece that is not listed or shows unavailable?
            </label>
            <Textarea
              id="gear-request"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. the Neumann U47, an SSL bus comp, or an extra pair of headphones - we will confirm and offer options."
              rows={2}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function OptionRow({
  selected,
  disabled,
  onClick,
  title,
  subtitle,
  avatar,
  avatarFallback,
  bio,
  credits,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  avatar?: string;
  avatarFallback?: string;
  // Engineer proof-of-work, shown at the point of choosing who runs the session.
  bio?: string | null;
  credits?: string[];
}) {
  const hasProof = Boolean((bio && bio.trim()) || (credits && credits.length > 0));
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors",
        disabled
          ? "cursor-not-allowed border-graphite/40 bg-coal-2/40 opacity-60"
          : selected
            ? "border-gold/60 bg-gold/[0.06]"
            : "border-graphite/50 bg-coal-2 hover:border-bone/40",
      ].join(" ")}
    >
      <span className="flex w-full items-center gap-2.5">
        {avatarFallback !== undefined &&
          (avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="size-8 shrink-0 rounded-full object-cover" draggable={false} />
          ) : (
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-coal-3 font-grotesk text-xs font-semibold text-steel">
              {avatarFallback}
            </span>
          ))}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-grotesk text-sm font-medium text-bone">{title}</span>
          <span className="block truncate text-xs capitalize text-steel/70">{subtitle}</span>
        </span>
        {selected && !disabled && <Check className="size-4 shrink-0 text-gold" />}
      </span>
      {hasProof && (
        <span className="block pl-[2.75rem]">
          {bio && bio.trim() && (
            <span className="block text-xs leading-relaxed text-steel">{bio}</span>
          )}
          {credits && credits.length > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-1">
              {credits.slice(0, 4).map((c, i) => (
                <span
                  key={i}
                  className="rounded-full border border-graphite/50 bg-coal-3 px-1.5 py-0.5 text-[0.625rem] text-mist/80"
                >
                  {c}
                </span>
              ))}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
