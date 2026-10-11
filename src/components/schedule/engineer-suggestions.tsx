"use client";

import * as React from "react";
import { useAction, useQueries, type RequestForQueries } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";

/* Engineer-fit suggestions (Jev, convex/jevEngineerFit.ts).

   Asked on demand with a button, never on page load. A suggestion is a chip
   next to a name: the owner still picks, and nothing is ever assigned from
   here. The button only exists for someone who may schedule staff on a
   deployment that can reach Jev, and when Jev cannot answer nothing new
   renders, so the page works exactly as it did. */

type SuggestArgs = FunctionArgs<typeof api.jevEngineerFit.suggest>;
export type EngineerSuggestion = FunctionReturnType<typeof api.jevEngineerFit.suggest>["suggestions"][number];

/** What Jev's answer leaves to show: the suggested engineers, at most two,
 *  and none when it answered and nobody fit clearly. */
export type SuggestionResult = { key: string; picks: EngineerSuggestion[] };

/** True when this viewer may ask (schedule.manage) and Jev is configured.
 *  `active` false skips the query (a closed dialog, nothing to staff).
 *  useQueries hands back an Error rather than throwing, so a backend without
 *  this function (a frontend published before its backend) fails closed:
 *  no button, and the page renders as it always did. */
export function useEngineerFitEnabled(active = true): boolean {
  const request = React.useMemo((): RequestForQueries => {
    if (!active) return {};
    return { enabled: { query: api.jevEngineerFit.available, args: {} } };
  }, [active]);
  return useQueries(request).enabled === true;
}

/** Ask Jev about one session on demand. `key` names what was asked about,
 *  so a caller can drop a result once its inputs change. The result is null
 *  before an answer, and stays null when Jev is unavailable or the call
 *  fails: there is then simply nothing to show. */
export function useEngineerSuggestions() {
  const suggest = useAction(api.jevEngineerFit.suggest);
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<SuggestionResult | null>(null);
  const latest = React.useRef(0);

  const ask = React.useCallback(
    async (args: SuggestArgs, key = "") => {
      const call = ++latest.current;
      setLoading(true);
      try {
        const res = await suggest(args);
        if (call !== latest.current) return;
        setResult(res.status === "unavailable" ? null : { key, picks: res.suggestions.filter((s) => s.suggested) });
      } catch {
        if (call === latest.current) setResult(null);
      } finally {
        if (call === latest.current) setLoading(false);
      }
    },
    [suggest],
  );

  const clear = React.useCallback(() => {
    latest.current += 1;
    setLoading(false);
    setResult(null);
  }, []);

  return { ask, clear, loading, result };
}

/** The "Suggest engineer" button. */
export function SuggestEngineerButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick} disabled={loading}>
      {loading ? <Spinner /> : <Sparkles />}
      {loading ? "Suggesting…" : "Suggest engineer"}
    </Button>
  );
}

/** The chip next to a suggested engineer: "Suggested · Good fit". */
export function SuggestedBadge({ pick }: { pick: EngineerSuggestion }) {
  return (
    <Badge
      tone="gold"
      title={`Fit ${pick.score.toFixed(1)} of 3 · confidence ${Math.round(pick.confidence * 100)}%`}
    >
      <Sparkles className="size-3" />
      Suggested · {pick.label}
    </Badge>
  );
}

/** The suggested engineers by name, each with its chip. */
export function SuggestedEngineers({ result }: { result: SuggestionResult }) {
  if (result.picks.length === 0) {
    return <p className="text-xs text-steel/70">No clear fit among the free engineers.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {result.picks.map((pick) => (
        <span key={pick.memberId} className="inline-flex items-center gap-1.5 text-xs text-bone">
          {pick.name}
          <SuggestedBadge pick={pick} />
        </span>
      ))}
    </div>
  );
}

/** The suggestion for one engineer in a picker list, if they got the chip. */
export function suggestionFor(result: SuggestionResult | null, memberId: string): EngineerSuggestion | undefined {
  return result?.picks.find((p) => p.memberId === memberId);
}
