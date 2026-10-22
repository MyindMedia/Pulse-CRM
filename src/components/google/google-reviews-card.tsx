"use client";

import * as React from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { SearchLg, Star01 } from "@untitledui/icons";
import type { GooglePlace, PlaceCandidate } from "@convex/lib/places";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/errors";

/* Settings > Integrations > Google reviews
   (openspec/changes/google-reviews-studio-seo). Find the studio on Google,
   link it, then choose whether its rating and Google's featured reviews show
   on the booking page and in Find a Studio. */
export function GoogleReviewsCard() {
  const status = useQuery(api.googlePlaces.status, {});
  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-gold/12 text-gold">
            <Star01 className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-grotesk text-sm font-semibold text-bone">Google reviews</p>
            <p className="text-xs text-steel">
              Link your studio&apos;s Google listing to show your Google rating and reviews on your booking page and
              in Find a Studio. Clients who rate a session by text also get your Google review link.
            </p>
          </div>
        </div>

        {status === undefined ? (
          <Skeleton className="h-10 w-full" />
        ) : !status.available ? (
          <div className="flex items-center gap-2 rounded-md border border-graphite/50 bg-coal/40 px-3 py-2">
            <Badge tone="caution">Not available yet</Badge>
            <p className="text-[0.6875rem] text-steel/70">Google reviews are being switched on for Pulse. Check back soon.</p>
          </div>
        ) : status.placeId ? (
          <Linked placeId={status.placeId} shown={status.shown} />
        ) : (
          <Finder defaultQuery={status.studioName} />
        )}
      </CardContent>
    </Card>
  );
}

function Finder({ defaultQuery }: { defaultQuery: string }) {
  const search = useAction(api.googlePlaces.search);
  const connect = useAction(api.googlePlaces.connect);
  const [q, setQ] = React.useState(defaultQuery);
  const [results, setResults] = React.useState<PlaceCandidate[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function find(e: React.FormEvent) {
    e.preventDefault();
    setBusy("search");
    try {
      setResults(await search({ q }));
    } catch (err) {
      toast.error(errorMessage(err, "Could not search Google."));
    } finally {
      setBusy(null);
    }
  }

  async function link(c: PlaceCandidate) {
    setBusy(c.placeId);
    try {
      await connect({ placeId: c.placeId });
      toast.success(`Linked ${c.name}. Turn on "Show publicly" when you are ready.`);
    } catch (err) {
      toast.error(errorMessage(err, "Could not link that listing."));
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={find} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="google-place-q" className="sr-only">
          Studio name and city
        </label>
        <Input
          id="google-place-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Studio name and city, as on Google Maps"
          className="min-w-0 flex-1"
        />
        <Button type="submit" disabled={q.trim().length < 2 || busy !== null} className="shrink-0">
          <SearchLg className="size-4" aria-hidden /> Find on Google
        </Button>
      </form>
      {results !== null &&
        (results.length === 0 ? (
          <p className="text-xs text-steel">
            Nothing found. Try the name exactly as it appears on Google Maps, with the city.
          </p>
        ) : (
          <ul className="divide-y divide-graphite/40 rounded-md border border-graphite/50">
            {results.map((c) => (
              <li key={c.placeId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-bone">{c.name}</span>
                  <span className="block truncate text-xs text-steel">{c.address}</span>
                </span>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => link(c)} className="shrink-0">
                  {busy === c.placeId ? "Linking" : "This is us"}
                </Button>
              </li>
            ))}
          </ul>
        ))}
      <p className="text-[0.6875rem] text-steel/70">Results from Google Maps.</p>
    </div>
  );
}

function Linked({ placeId, shown }: { placeId: string; shown: boolean }) {
  const details = useAction(api.googlePlaces.details);
  const setShown = useMutation(api.googlePlaces.setShown);
  const disconnect = useMutation(api.googlePlaces.disconnect);
  const [place, setPlace] = React.useState<GooglePlace | null | undefined>(undefined);

  React.useEffect(() => {
    let live = true;
    details({})
      .then((p) => live && setPlace(p))
      .catch(() => live && setPlace(null));
    return () => {
      live = false;
    };
  }, [details, placeId]);

  async function toggle(next: boolean) {
    try {
      await setShown({ shown: next });
      toast.success(next ? "Google reviews now show on your booking page." : "Google reviews hidden.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not update that setting."));
    }
  }

  async function unlink() {
    try {
      await disconnect({});
      toast.success("Google listing unlinked.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not unlink."));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-graphite/50 bg-coal/40 px-3 py-2.5">
        {place === undefined ? (
          <Skeleton className="h-9 w-56" />
        ) : (
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-sm text-bone">
              <Badge tone="positive">Linked</Badge>
              <span className="truncate">{place?.name ?? "Your Google listing"}</span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-steel">
              {place
                ? [
                    place.address,
                    place.rating !== null ? `${place.rating.toFixed(1)} stars from ${place.count} reviews` : "No Google reviews yet",
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Google did not answer just now. Your link still works."}
            </span>
          </span>
        )}
        {place?.mapsUrl && (
          <a href={place.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-gold underline-offset-2 hover:underline">
            Open in Google Maps
          </a>
        )}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-bone">Show publicly</p>
          <p className="text-xs text-steel">
            Your Google rating and the reviews Google features, exactly as Google shows them, on your booking page
            and in Find a Studio. Pulse can&apos;t pick which reviews appear; you can hide all of them.
          </p>
        </div>
        <Switch checked={shown} onCheckedChange={toggle} aria-label="Show Google reviews publicly" />
      </div>

      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={unlink}>
          Unlink Google listing
        </Button>
      </div>
    </div>
  );
}
