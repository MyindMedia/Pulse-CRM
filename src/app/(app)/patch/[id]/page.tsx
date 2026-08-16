"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ArrowLeft, Cable, History, LayoutGrid, List, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilities } from "@/lib/use-capabilities";
import { PatchCanvas } from "@/components/patch/patch-canvas";
import { DeviceList } from "@/components/patch/device-list";
import { CableManager } from "@/components/patch/cable-manager";

type Tab = "canvas" | "devices" | "cables" | "history";

const TABS: { key: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { key: "canvas", label: "Canvas", icon: LayoutGrid },
  { key: "devices", label: "Devices", icon: List },
  { key: "cables", label: "Cables", icon: Cable },
  { key: "history", label: "History", icon: History },
];

function HistoryTab({ patchSpaceId }: { patchSpaceId: Id<"patchSpaces"> }) {
  const log = useQuery(api.patchManager.history, { patchSpaceId, limit: 100 }) as
    | {
        _id: string;
        actor: string;
        at: number;
        changeType: string;
        entityType: string;
        summary: string;
      }[]
    | undefined;

  if (log === undefined) return <Skeleton className="h-64 w-full" />;
  if (log.length === 0) {
    return <p className="text-xs text-steel">Nothing has changed in this space yet.</p>;
  }

  return (
    <ol className="space-y-1.5">
      {log.map((entry) => (
        <li
          key={entry._id}
          className="flex items-start gap-3 rounded-md border border-hairline bg-coal-2/40 px-3 py-2"
        >
          <Badge
            tone={
              entry.changeType === "delete"
                ? "critical"
                : entry.changeType === "create"
                  ? "positive"
                  : "neutral"
            }
            className="mt-0.5 shrink-0"
          >
            {entry.changeType}
          </Badge>
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-bone">{entry.summary}</span>
            <span className="mt-0.5 block font-meta text-[10px] uppercase tracking-wide text-steel">
              {entry.actor} · {new Date(entry.at).toLocaleString()}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function PatchSpacePage() {
  const params = useParams<{ id: string }>();
  const patchSpaceId = params.id as Id<"patchSpaces">;

  const spaces = useQuery(api.patchManager.spaces) as
    | { _id: Id<"patchSpaces">; name: string; roomName: string | null; connectionCount: number }[]
    | undefined;
  const { can, loaded } = useCapabilities();
  const canEdit = loaded && can("patch.edit");

  const [tab, setTab] = React.useState<Tab>("canvas");
  const space = spaces?.find((s) => s._id === patchSpaceId);

  return (
    // The app shell pads its main element and lets it grow; a canvas needs a
    // fixed box or it runs off the bottom of the window and takes the zoom
    // controls with it. So this page cancels the padding and pins its height
    // to the viewport below the 64px topbar.
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-64px)] flex-col overflow-hidden lg:-mx-8 lg:-my-8">
      {/* Header strip */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-hairline bg-coal-2/40 px-4 py-2.5 lg:px-6">
        <Link
          href="/patch"
          className="flex items-center gap-1.5 font-meta text-[10px] uppercase tracking-wide text-steel transition-colors hover:text-bone"
        >
          <ArrowLeft className="size-3" />
          Patch
        </Link>
        <span className="h-4 w-px bg-hairline-2" />
        {space ? (
          <>
            <h1 className="truncate text-sm font-semibold text-bone">{space.name}</h1>
            {space.roomName && <Badge tone="neutral">{space.roomName}</Badge>}
            {!canEdit && loaded && <Badge tone="caution">Read only</Badge>}
          </>
        ) : (
          <Skeleton className="h-4 w-32" />
        )}

        <div className="ml-auto flex items-center gap-1">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-meta text-[10px] uppercase tracking-wide transition-colors",
                tab === key
                  ? "bg-gold/12 text-gold-bright"
                  : "text-steel hover:bg-coal-3/60 hover:text-bone",
              )}
            >
              <Icon className="size-3" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      {tab === "canvas" ? (
        <>
          {/* The canvas is a pointer surface. On a phone it is a trap, so
              mobile gets the device list instead, which is the read-and-
              trace view the spec asks for. */}
          <div className="hidden min-h-0 flex-1 lg:block">
            {/* Keyed on the space: the canvas holds an undo stack full of ids from
                this room, and reusing the component across a route change made
                Cmd+Z delete things in the room you just left. */}
            <PatchCanvas key={patchSpaceId} patchSpaceId={patchSpaceId} canEdit={canEdit} />
          </div>
          <div className="flex-1 space-y-4 p-4 lg:hidden">
            <p className="flex items-start gap-2 rounded-md border border-hairline-2 bg-coal-2/60 px-3 py-2 text-[11px] text-steel">
              <Smartphone className="mt-px size-3.5 shrink-0" />
              The canvas needs a bigger screen. Here is the device list so you can still read and
              trace the patch.
            </p>
            <DeviceList patchSpaceId={patchSpaceId} />
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          {tab === "devices" && <DeviceList patchSpaceId={patchSpaceId} />}
          {tab === "cables" && <CableManager patchSpaceId={patchSpaceId} />}
          {tab === "history" && <HistoryTab patchSpaceId={patchSpaceId} />}
        </div>
      )}
    </div>
  );
}
