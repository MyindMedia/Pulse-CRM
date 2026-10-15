"use client";

import * as React from "react";
import { BarChart01, Calendar, Home02, SearchSm, Users01, Bell01 } from "@untitledui/icons";
import { Disc3 } from "lucide-react";
import { RADIUS_PX } from "@convex/lib/themeSpec";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { AmbientLight } from "@/components/shell/ambient-light";
import { GlassBackdrop } from "@/components/shell/glass-backdrop";
import { Chassis, ChassisTitle, KeyBank, StatTile } from "@/components/dashboard/hw/parts";
import { RoomCard } from "@/components/book/room-card";
import { statusColor } from "@/components/calendar/constants";
import { PreviewFrame } from "@/components/settings/preview-frame";
import { useBrandingDraft } from "@/components/settings/branding-draft";
import { previewScope } from "@/lib/brand-draft";
import { cn } from "@/lib/utils";

type Surface = "app" | "booking";
const SURFACES = [
  { value: "app", label: "App" },
  { value: "booking", label: "Booking page" },
] as const;

/**
 * The Branding page's live preview: a working miniature of the app (or the
 * public booking page) wearing the DRAFT brand. It renders the real
 * components and stylesheets inside its own frame, so what it shows is what
 * Apply will do, and the page around it stays as saved until then.
 */
export function BrandPreview({ className }: { className?: string }) {
  const { org, saved, draft, diff, canTheme, brandDriven, previewTheme, lockedThemeKeys } = useBrandingDraft();
  const [surface, setSurface] = React.useState<Surface>("app");

  const scope = React.useMemo(
    () => previewScope(saved, draft, { theme: previewTheme, brandDriven, radiusPx: RADIUS_PX }),
    [saved, draft, previewTheme, brandDriven],
  );
  const studio = (canTheme && draft.theme.appName.trim()) || org.name || "Your studio";
  const maxOnly = canTheme === false && lockedThemeKeys.length > 0 && previewTheme;

  return (
    <Card id="brand-preview" className={cn("scroll-mt-24", className)}>
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-grotesk text-sm font-semibold text-bone">
              Preview
              {diff.dirty ? (
                <Badge tone="gold">Not applied yet</Badge>
              ) : (
                <Badge tone="neutral">As saved</Badge>
              )}
              {maxOnly && <Badge tone="info">Max plan</Badge>}
            </p>
            <p className="mt-0.5 text-xs text-steel">
              {diff.dirty ? "This is how it will look after Apply." : "Change anything below to see it here first."}
            </p>
          </div>
          <KeyBank label="Preview surface" options={SURFACES} value={surface} onChange={setSurface} />
        </div>

        <div className="overflow-hidden rounded-lg border border-graphite/60 bg-ink">
          <PreviewFrame
            title={surface === "app" ? "Preview of the app with your draft branding" : "Preview of your booking page with your draft branding"}
            vars={scope.vars}
            attrs={scope.attrs}
            fonts={previewTheme ? [draft.theme.fontHeading, draft.theme.fontBody] : []}
            className="block h-[460px] w-full border-0 bg-transparent sm:h-[540px]"
          >
            {/* inert: a picture of the app, not a second copy to click in */}
            <div inert className="h-full">
              {surface === "app" ? (
                <AppMiniature studio={studio} logoUrl={org.logoUrl} />
              ) : (
                <BookingMiniature studio={studio} logoUrl={org.logoUrl} tagline={org.tagline} slug={org.slug} glass={draft.look === "glass"} />
              )}
            </div>
          </PreviewFrame>
        </div>
        <p className="text-[0.6875rem] text-steel">
          {draft.look === "glass" ? "iOS Glass" : "Pulse Hardware"}
          {previewTheme && (draft.theme.fontHeading || draft.theme.fontBody)
            ? ` · ${draft.theme.fontHeading || "Pulse default"} headings, ${draft.theme.fontBody || "Pulse default"} body`
            : ""}
          {maxOnly ? " · Theme changes are a Max plan feature, shown here so you can try them." : ""}
        </p>
      </CardContent>
    </Card>
  );
}

/* Widths below are the frame's own viewport: the rail folds to icons when
   the preview is phone width. */
const FRAME_CSS = `
html, body { height: 100%; }
.bp-rail { width: 148px; }
.bp-rail .pl-nav-item { font-size: 12.5px; }
.bp-rail .bp-icon { display: none; }
@media (max-width: 380px) {
  .bp-rail { width: 50px; padding-left: 6px; padding-right: 6px; }
  .bp-rail .bp-label, .bp-rail .bp-studio, .bp-rail .pl-led { display: none; }
  .bp-rail .bp-icon { display: block; }
  .bp-rail .pl-nav-item { justify-content: center; padding-left: 0; padding-right: 0; }
}
`;

function NavItem({ icon: Icon, label, active }: { icon: typeof Home02; label: string; active?: boolean }) {
  return (
    <span className="pl-nav-item" data-active={active ? "true" : undefined}>
      <span className="pl-led" data-on={active ? "true" : undefined} aria-hidden />
      <Icon className="bp-icon size-3.5 shrink-0" aria-hidden />
      <span className="bp-label truncate">{label}</span>
    </span>
  );
}

function StudioMark({ logoUrl }: { logoUrl: string | null }) {
  return logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoUrl} alt="" className="size-7 shrink-0 rounded object-contain" />
  ) : (
    <span className="grid size-7 shrink-0 place-items-center rounded-md bg-gold text-gold-ink">
      <Disc3 className="size-4" />
    </span>
  );
}

/** Sidebar, top bar, a dashboard chassis with a KPI and chart line, the
 *  calendar's booking pills, an input and the two key styles. */
function AppMiniature({ studio, logoUrl }: { studio: string; logoUrl: string | null }) {
  return (
    <div className="pulse-hw relative h-full overflow-hidden bg-ink">
      <style>{FRAME_CSS}</style>
      <AmbientLight />
      <div className="relative z-10 flex h-full gap-2.5 p-2.5">
        <aside className="pl-card pl-side bp-rail flex shrink-0 flex-col gap-1 px-2.5 py-3">
          <div className="flex items-center gap-2 px-1">
            <StudioMark logoUrl={logoUrl} />
            <span className="bp-studio truncate font-grotesk text-[13px] font-semibold text-bone">{studio}</span>
          </div>
          <span className="pl-bar mx-1 mb-2 mt-2 w-10" aria-hidden />
          <NavItem icon={Home02} label="Dashboard" active />
          <NavItem icon={Calendar} label="Calendar" />
          <NavItem icon={Users01} label="Clients" />
          <NavItem icon={BarChart01} label="Reports" />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <header className="pl-card relative flex items-center gap-2 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-sans text-[19px] font-extrabold leading-6 tracking-[-0.01em] text-bone">Dashboard</h1>
              <p className="truncate font-sans text-[10.5px] leading-4 text-steel">{studio}</p>
            </div>
            <span className="pl-icon-key grid" aria-hidden>
              <SearchSm className="size-4" />
            </span>
            <span className="pl-icon-key grid" aria-hidden>
              <Bell01 className="size-4" />
            </span>
          </header>

          <div className="pl-bay min-h-0 flex-1 overflow-hidden">
            <Chassis className="h-full gap-3 px-3.5 pb-3.5 pt-3">
              <ChassisTitle title="Tonight at the studio" kicker={<Badge tone="gold">Live now</Badge>} />
              <div className="grid grid-cols-2 gap-2">
                <StatTile label="Revenue" value="$18.4k" highlight foot={<span className="text-positive">+12% vs Sep</span>} />
                <div className="pl-well flex min-w-0 flex-col justify-between px-3 py-2.5">
                  <span className="pl-label truncate">Bookings</span>
                  <svg viewBox="0 0 120 40" className="h-10 w-full" preserveAspectRatio="none" aria-hidden>
                    <polyline
                      points="0,34 15,30 30,31 45,20 60,24 75,13 90,16 105,7 120,10"
                      fill="none"
                      stroke="var(--pl-yellow)"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                </div>
              </div>

              {/* The calendar's pills: a confirmed session and a request,
                  under a card heading in the headings face (CardTitle). */}
              <div className="space-y-1.5">
                <CardTitle className="text-[15px]">Next up</CardTitle>
                <BookingPill time="7:30 PM" title="Nova, mix session" status="confirmed" />
                <BookingPill time="9:00 PM" title="Kai, vocal tracking" status="tentative" pending />
              </div>

              <div className="mt-auto space-y-2">
                <Input readOnly value="" placeholder="Search clients, sessions" className="h-9" />
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm">New booking</Button>
                  <Button size="sm" variant="secondary">
                    Export
                  </Button>
                  <Badge tone="positive">Paid</Badge>
                </div>
              </div>
            </Chassis>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Same markup as the month grid's SessionPill (calendar/month-grid.tsx). */
function BookingPill({ time, title, status, pending }: { time: string; title: string; status: string; pending?: boolean }) {
  return (
    <span
      className={cn(
        "flex w-full items-center gap-1.5 overflow-hidden rounded-sm border border-graphite/50 bg-coal-2 px-1.5 py-1 text-left",
        pending && "border-dashed border-caution/60",
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: statusColor(status) }} />
      <span className="truncate font-meta text-[0.5625rem] text-steel/70">{time}</span>
      <span className="min-w-0 flex-1 truncate text-[0.6875rem] font-medium text-bone">
        {pending && <span className="text-caution">Request · </span>}
        {title}
      </span>
    </span>
  );
}

/** The public booking page's header and a room card, as /book/[slug] draws
 *  them (book/layout.tsx, book/room-card.tsx). */
function BookingMiniature({
  studio,
  logoUrl,
  tagline,
  slug,
  glass,
}: {
  studio: string;
  logoUrl: string | null;
  tagline: string;
  slug: string;
  glass: boolean;
}) {
  return (
    <div data-glass-root className="grain relative flex min-h-full flex-col bg-ink text-bone">
      <style>{FRAME_CSS}</style>
      {glass && <GlassBackdrop />}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[300px] bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,rgba(var(--brand-rgb),0.12),transparent_70%)]"
      />
      <header className="relative z-10 border-b border-graphite/50 bg-obsidian/80 backdrop-blur">
        <div className="flex h-14 items-center justify-between px-4">
          <span className="flex min-w-0 items-center gap-2.5">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-7 w-auto max-w-24 rounded object-contain object-left" />
            ) : (
              <span className="grid size-8 place-items-center rounded-md bg-gold text-gold-ink">
                <Disc3 className="size-4" />
              </span>
            )}
            <span className="flex min-w-0 flex-col leading-none">
              <span className="truncate font-grotesk text-sm font-semibold tracking-tight text-bone">{studio}</span>
              <span className="overline mt-0.5 truncate">{tagline || "Studio booking"}</span>
            </span>
          </span>
          <span className="text-[11px] text-steel/70">Secured by Pulse</span>
        </div>
      </header>
      <main className="relative z-10 flex-1 space-y-4 px-4 py-5">
        <div>
          <h2 className="font-grotesk text-[26px] font-semibold leading-tight tracking-tight text-bone">Book studio time</h2>
          <p className="mt-1.5 text-sm text-mist/85">Pick a room and lock in your time.</p>
          <span className="mt-3 inline-flex items-center gap-2 rounded-md bg-gold px-4 py-2 font-grotesk text-sm font-semibold text-gold-ink">
            Book a room
          </span>
        </div>
        <div className="max-w-[320px]">
          <RoomCard
            slug={slug}
            room={{
              _id: "preview",
              name: "Studio A",
              roomType: "tracking room",
              hourlyRateCents: 7500,
              minimumHours: 2,
              gearCount: 18,
              gearPreview: ["Neve 1073", "U87", "LA-2A"],
              photos: [],
            }}
          />
        </div>
      </main>
    </div>
  );
}
