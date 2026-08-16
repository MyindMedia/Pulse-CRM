"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Cable, DoorOpen, Plug, Plus, Waves } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { StatTile } from "@/components/ui/stat-tile";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCapabilities } from "@/lib/use-capabilities";

type Space = {
  _id: Id<"patchSpaces">;
  name: string;
  description?: string;
  roomName: string | null;
  deviceCount: number;
  connectionCount: number;
};

type Room = { _id: Id<"rooms">; name: string };

function NewSpaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const createSpace = useMutation(api.patchManager.createSpace);
  const rooms = useQuery(api.rooms.bookable) as Room[] | undefined;

  const [name, setName] = React.useState("");
  const [roomId, setRoomId] = React.useState<string>("none");
  const [description, setDescription] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const [wasOpen, setWasOpen] = React.useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setName("");
      setRoomId("none");
      setDescription("");
    }
  }

  async function submit() {
    if (!name.trim()) {
      toast.error("Give the space a name.");
      return;
    }
    setSaving(true);
    try {
      const id = await createSpace({
        name: name.trim(),
        roomId: roomId === "none" ? undefined : (roomId as Id<"rooms">),
        description: description.trim() || undefined,
      });
      toast.success(`${name.trim()} created.`);
      onOpenChange(false);
      router.push(`/patch/${id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create that.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>New patch space</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Field label="Name" htmlFor="ps-name">
            <Input
              id="ps-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Control Room"
              autoFocus
            />
          </Field>
          <Field
            label="Room"
            hint="Linking a room scopes the palette to the gear installed there."
          >
            <Select value={roomId} onValueChange={setRoomId}>
              <SelectTrigger>
                <SelectValue placeholder="No room" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No room (a mobile rig)</SelectItem>
                {(rooms ?? []).map((room) => (
                  <SelectItem key={room._id} value={room._id}>
                    {room.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Description" htmlFor="ps-desc">
            <Textarea
              id="ps-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="The main tracking chain and the outboard rack."
              className="min-h-16"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Creating" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PatchIndexPage() {
  const spaces = useQuery(api.patchManager.spaces) as Space[] | undefined;
  const cableSummary = useQuery(api.patchCables.stockSummary, {});
  const { can } = useCapabilities();
  const canEdit = can("patch.edit");
  const [newOpen, setNewOpen] = React.useState(false);

  const loading = spaces === undefined;
  const totalRuns = (spaces ?? []).reduce((sum, s) => sum + s.connectionCount, 0);
  const totalDevices = (spaces ?? []).reduce((sum, s) => sum + s.deviceCount, 0);

  return (
    <div className="space-y-7">
      <PageHeader
        overline="Signal"
        title="Patch Manager"
        description="What is physically plugged into what, down to the channel. Devices come from your inventory, cables come from your locker."
        actions={
          canEdit ? (
            <Button onClick={() => setNewOpen(true)}>
              <Plus className="size-4" />
              New patch space
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {loading || cableSummary === undefined ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
        ) : (
          <>
            <StatTile label="Patch spaces" value={spaces!.length} icon={Plug} />
            <StatTile label="Devices mapped" value={totalDevices} />
            <StatTile label="Cable runs" value={totalRuns} icon={Waves} />
            <StatTile
              label="Cables free"
              value={cableSummary.free}
              icon={Cable}
              accent={cableSummary.free === 0}
            />
          </>
        )}
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : spaces!.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="No patch spaces yet"
          description="Make one per room or rig. Then drag your gear onto the canvas and draw the cables."
          action={
            canEdit ? (
              <Button onClick={() => setNewOpen(true)}>
                <Plus className="size-4" />
                New patch space
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {spaces!.map((space) => (
            <Link
              key={space._id}
              href={`/patch/${space._id}`}
              className="sheen glass-edge material-thin press group rounded-chrome border-transparent p-4 transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-gold-dim/60 hover:shadow-elev-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-bone">{space.name}</p>
                  {space.roomName ? (
                    <p className="mt-0.5 flex items-center gap-1 font-meta text-[10px] uppercase tracking-wide text-steel">
                      <DoorOpen className="size-2.5" />
                      {space.roomName}
                    </p>
                  ) : (
                    <p className="mt-0.5 font-meta text-[10px] uppercase tracking-wide text-steel">
                      Mobile rig
                    </p>
                  )}
                </div>
                <Plug className="size-4 shrink-0 text-steel transition-colors group-hover:text-gold" />
              </div>

              {space.description && (
                <p className="mt-2 line-clamp-2 text-xs text-steel">{space.description}</p>
              )}

              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone="neutral">{space.deviceCount} devices</Badge>
                <Badge tone={space.connectionCount > 0 ? "gold" : "neutral"}>
                  {space.connectionCount} runs
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      )}

      <NewSpaceDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
