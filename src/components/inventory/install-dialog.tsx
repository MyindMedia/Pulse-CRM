"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { DoorOpen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/feedback";

/** Minimal target for the install dialog. */
export type InstallTarget = {
  _id: Id<"equipment">;
  name: string;
};

/**
 * Pick a room to install an equipment item into. Once installed the item's
 * availability follows the room. Parent owns `open`.
 */
export function InstallDialog({
  item,
  open,
  onOpenChange,
}: {
  item: InstallTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const install = useMutation(api.equipment.install);
  const rooms = useQuery(api.rooms.bookable);
  const [roomId, setRoomId] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) setRoomId("");
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    if (!roomId) {
      toast.error("Pick a room to install into.");
      return;
    }
    setSubmitting(true);
    try {
      await install({ id: item._id, roomId: roomId as Id<"rooms"> });
      toast.success(`${item.name} installed.`);
      onOpenChange(false);
    } catch {
      toast.error("Could not install the item. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const noRooms = rooms !== undefined && rooms.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Install in studio</DialogTitle>
          <DialogDescription>
            {item
              ? `Install ${item.name} into a room. Its availability will follow that room.`
              : "Install this item into a room."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogBody>
            {noRooms ? (
              <EmptyState
                icon={DoorOpen}
                title="No rooms available"
                description="Add a room on the Studio page before installing gear."
              />
            ) : (
              <Field label="Room" htmlFor="install-room">
                <Select value={roomId} onValueChange={setRoomId}>
                  <SelectTrigger id="install-room">
                    <SelectValue
                      placeholder={rooms ? "Select a room" : "Loading rooms…"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(rooms ?? []).map((r) => (
                      <SelectItem key={r._id} value={r._id}>
                        {r.name}
                        {r.roomType ? ` · ${r.roomType}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || noRooms}>
              <DoorOpen className="size-4" />
              {submitting ? "Installing…" : "Install"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
