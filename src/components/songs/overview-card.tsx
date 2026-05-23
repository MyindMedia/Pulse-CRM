"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarClock,
  CircleDollarSign,
  Pencil,
  Target,
  UserRound,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { StatTile } from "@/components/ui/stat-tile";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { meta, SONG_STAGE } from "@/lib/labels";
import { money, longDate, relativeTime } from "@/lib/format";

/* The next-action heuristic -> a coloured chip. "On track" is the calm state. */
const ACTION_TONE: Record<string, "gold" | "caution" | "critical" | "positive"> = {
  "Collect balance": "critical",
  "Send recap": "caution",
  "Complete split sheet": "gold",
  "On track": "positive",
};

/** Convert a millisecond timestamp into a yyyy-mm-dd value for <input type=date>. */
function toDateInput(ts?: number | null) {
  if (ts == null) return "";
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function OverviewCard({ songId }: { songId: Id<"songs"> }) {
  const overview = useQuery(api.songs.overview, { songId });
  const members = useQuery(api.members.list, {});
  const update = useMutation(api.songs.update);

  const [editing, setEditing] = useState(false);
  const [deadlineDraft, setDeadlineDraft] = useState("");
  const [ownerDraft, setOwnerDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);
  // Capture "now" once (lazy initializer) so the overdue flag stays stable.
  const [now] = useState(() => Date.now());

  const deadline = overview?.deadline;
  const stageValue = overview?.stage;
  const overdue = useMemo(
    () => deadline != null && deadline < now && stageValue !== "released",
    [deadline, stageValue, now],
  );

  if (overview === undefined) {
    return <Card className="h-40 animate-pulse" material="thin" />;
  }
  if (overview === null) return null;

  const stage = meta(SONG_STAGE, overview.stage);
  const actionTone = ACTION_TONE[overview.nextAction] ?? "positive";

  function beginEdit() {
    setDeadlineDraft(toDateInput(overview!.deadline));
    setOwnerDraft(overview!.ownerMemberId ?? "");
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    try {
      const deadline =
        deadlineDraft.trim() === ""
          ? null
          : new Date(`${deadlineDraft}T12:00:00`).getTime();
      if (deadline != null && !Number.isFinite(deadline)) {
        toast.error("That deadline is not a valid date.");
        setSaving(false);
        return;
      }
      await update({
        id: songId,
        deadline,
        ownerMemberId: ownerDraft ? (ownerDraft as Id<"members">) : null,
      });
      toast.success("Workspace updated.");
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the workspace.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card material="regular">
      <CardContent className="space-y-4 p-5">
        {/* Header row: next action + edit */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[0.6875rem] uppercase tracking-wide text-ash-dim">
              Next action
            </span>
            <Badge tone={actionTone}>
              {actionTone === "critical" && <AlertTriangle className="size-3" />}
              {overview.nextAction}
            </Badge>
          </div>
          {!editing && (
            <Button variant="ghost" size="sm" onClick={beginEdit}>
              <Pencil className="size-3.5" />
              Owner &amp; deadline
            </Button>
          )}
        </div>

        {/* Stat grid */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Stage" value={stage.label} icon={Target} />
          <StatTile
            label="Open balance"
            value={money(overview.openBalanceCents)}
            icon={CircleDollarSign}
            accent={overview.openBalanceCents > 0}
            hint={
              overview.sessionCount > 0
                ? `across ${overview.sessionCount} ${overview.sessionCount === 1 ? "session" : "sessions"}`
                : "no sessions yet"
            }
          />
          <StatTile
            label="Owner"
            value={overview.ownerName ?? "Unassigned"}
            icon={UserRound}
          />
          <StatTile
            label="Deadline"
            value={overview.deadline != null ? longDate(overview.deadline) : "None set"}
            icon={CalendarClock}
            hint={
              overview.deadline != null
                ? overdue
                  ? "overdue"
                  : relativeTime(overview.deadline)
                : undefined
            }
          />
        </div>

        {/* Linked client */}
        <div className="flex items-center justify-between gap-3 border-t border-hairline pt-3">
          <span className="font-mono text-[0.6875rem] uppercase tracking-wide text-ash-dim">
            Client
          </span>
          {overview.clientId ? (
            <Link
              href={`/roster/${overview.clientId}`}
              className="text-sm font-medium text-gold hover:underline"
            >
              {overview.clientName}
            </Link>
          ) : (
            <span className="text-sm text-ash-dim">No client linked</span>
          )}
        </div>

        {/* Inline editor */}
        {editing && (
          <div className="space-y-3 rounded-md border border-hairline-2 bg-ink-2 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <span className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
                  Owner
                </span>
                <Select
                  value={ownerDraft || "none"}
                  onValueChange={(v) => setOwnerDraft(v === "none" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {(members ?? []).map((m) => (
                      <SelectItem key={m._id} value={m._id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <span className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
                  Deadline
                </span>
                <Input
                  type="date"
                  value={deadlineDraft}
                  onChange={(e) => setDeadlineDraft(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
