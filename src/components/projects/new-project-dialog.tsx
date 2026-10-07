"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fromDateInput } from "./constants";

const NONE = "none";

export function NewProjectDialog({ onCreated }: { onCreated?: (id: string) => void }) {
  const create = useMutation(api.projects.create);
  const candidates = useQuery(api.projects.linkCandidates);
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [due, setDue] = React.useState("");
  const [songId, setSongId] = React.useState(NONE);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const id = await create({
        name,
        dueDate: fromDateInput(due) ?? undefined,
        songId: songId === NONE ? undefined : (songId as Id<"songs">),
      });
      toast.success("Project started");
      setOpen(false);
      setName(""); setDue(""); setSongId(NONE);
      onCreated?.(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus /> New project</Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Starts in tracking. Add tasks and links after.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Night Drive EP" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-due">Due</Label>
              <Input id="project-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Song</Label>
              <Select value={songId} onValueChange={setSongId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No song</SelectItem>
                  {(candidates?.song ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy || !name.trim()}>Start project</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
