"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { DatabaseZap, KeyRound, RefreshCw } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";

/** Data management — reload the demo workspace and an auth-mode note. */
export function DataPanel() {
  const seedRun = useMutation(api.seed.run);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [running, setRunning] = React.useState(false);

  async function handleReload() {
    setRunning(true);
    try {
      await seedRun();
      toast.success("Demo workspace rebuilt — Lumen Recording Co. is fresh.");
      setConfirmOpen(false);
    } catch {
      toast.error("Could not reload the demo data. Try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseZap className="size-4 text-gold" />
            Reload demo data
          </CardTitle>
          <CardDescription>
            Rebuild the Lumen Recording Co. demo workspace from scratch.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ash">
            This wipes the current records and reseeds songs, sessions, rooms,
            gear, the team and clients to their original demo state. Use it to
            return the workspace to a clean starting point for a walkthrough.
          </p>
        </CardContent>
        <CardFooter className="justify-between">
          <p className="text-[0.6875rem] text-ash-dim">
            This action cannot be undone.
          </p>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            <RefreshCw className="size-4" />
            Reload demo data
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-gold" />
            Authentication
          </CardTitle>
          <CardDescription>How sign-in is handled for this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ash">
            When a Clerk integration is configured, Pulse authenticates every
            member through Clerk and maps them to their team record. With no
            Clerk keys present the workspace runs in demo mode — a single shared
            actor with full access, so the product is fully explorable without
            a sign-in step. This is a read-only status; there is nothing to
            change here.
          </p>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Reload the demo workspace?</DialogTitle>
            <DialogDescription>
              Every current record is replaced with the original Lumen Recording
              Co. demo data.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-ash">
              All songs, sessions, rooms, gear, team members and clients return
              to their seeded state. Anything added or edited since the last
              reload is lost.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={running}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleReload}
              disabled={running}
            >
              <RefreshCw className={running ? "size-4 animate-spin" : "size-4"} />
              {running ? "Rebuilding…" : "Reload demo data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
