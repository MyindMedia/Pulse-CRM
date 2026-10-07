"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ScanLine, Camera, CameraOff } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts?: { formats?: string[] }) => Detector;

/** A scanned QR holds the bare code; tolerate a pasted URL ending in the code. */
export function codeFromScan(raw: string): string {
  const t = raw.trim();
  const m = t.match(/[?&]code=([^&#]+)/);
  return decodeURIComponent(m ? m[1] : t);
}

type HolderKind = "member" | "client" | "session" | "rental";

/**
 * Scan or type a gear code, then check the gear out to a person, client,
 * session or rental, or check it back in. The camera uses the browser's
 * BarcodeDetector where it exists; everywhere else (and for handheld
 * scanners, which type the code and press Enter) the code box works.
 */
export function GearScanDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [code, setCode] = React.useState("");
  const [looked, setLooked] = React.useState("");
  const [cameraOn, setCameraOn] = React.useState(false);
  const [cameraNote, setCameraNote] = React.useState("");
  const videoRef = React.useRef<HTMLVideoElement>(null);

  const [kind, setKind] = React.useState<HolderKind>("member");
  const [memberId, setMemberId] = React.useState("");
  const [artistId, setArtistId] = React.useState("");
  const [sessionId, setSessionId] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [due, setDue] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const found = useQuery(api.gearCheckout.lookup, open && looked ? { code: looked } : "skip");
  const members = useQuery(api.members.list, open ? {} : "skip");
  const artists = useQuery(api.artists.list, open && kind === "client" ? {} : "skip");
  const sessions = useQuery(api.sessions.upcoming, open && kind === "session" ? { limit: 20 } : "skip");
  const checkOut = useMutation(api.gearCheckout.checkOut);
  const checkIn = useMutation(api.gearCheckout.checkIn);

  const reset = React.useCallback(() => {
    setCode(""); setLooked(""); setNotes(""); setDue(""); setLabel("");
    setMemberId(""); setArtistId(""); setSessionId("");
  }, []);

  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) { reset(); setCameraOn(false); }
  }

  // Camera loop.
  React.useEffect(() => {
    if (!open || !cameraOn) return;
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    if (!Ctor) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    const detector = new Ctor({ formats: ["qr_code", "code_128"] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = s;
        void v.play();
        timer = setInterval(async () => {
          try {
            const hits = await detector.detect(v);
            if (hits[0]?.rawValue) {
              const c = codeFromScan(hits[0].rawValue);
              setCode(c); setLooked(c); setCameraOn(false);
            }
          } catch { /* a frame that fails to decode is normal */ }
        }, 250);
      })
      .catch(() => {
        setCameraNote("Camera access was blocked. Type the code instead.");
        setCameraOn(false);
      });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, cameraOn]);

  function toggleCamera() {
    setCameraNote("");
    if (cameraOn) return setCameraOn(false);
    const supported = !!(window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector && !!navigator.mediaDevices?.getUserMedia;
    if (!supported) {
      setCameraNote("This browser cannot scan with the camera. Type the code, or use a handheld scanner.");
      return;
    }
    setCameraOn(true);
  }

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      reset();
    } catch (e) {
      const data = (e as { data?: { message?: string } }).data;
      toast.error(data?.message ?? "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const holderReady =
    (kind === "member" && memberId) || (kind === "client" && artistId) || (kind === "session" && sessionId) || (kind === "rental" && label.trim());

  function submitOut() {
    if (!found) return;
    const dueAt = due ? new Date(due).getTime() : undefined;
    void run(
      () =>
        checkOut({
          equipmentId: found.equipmentId as Id<"equipment">,
          holder: {
            kind,
            ...(kind === "member" ? { memberId: memberId as Id<"members"> } : {}),
            ...(kind === "client" ? { artistId: artistId as Id<"artists"> } : {}),
            ...(kind === "session" ? { sessionId: sessionId as Id<"sessions"> } : {}),
            ...(kind === "rental" ? { label } : {}),
          },
          ...(dueAt ? { dueAt } : {}),
          ...(notes.trim() ? { notes } : {}),
        }),
      `${found.name} checked out`,
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Scan gear</DialogTitle>
          <DialogDescription>Scan a label with the camera, or type the code, to check gear out or back in.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            {cameraOn && (
              <video ref={videoRef} muted playsInline className="aspect-video w-full rounded-lg bg-black object-cover" aria-label="Camera view" />
            )}
            <div className="flex items-end gap-2">
              <Field label="Gear code" htmlFor="gear-code" className="flex-1">
                <Input
                  id="gear-code"
                  value={code}
                  autoFocus
                  autoComplete="off"
                  autoCapitalize="characters"
                  placeholder="PX-7K3M9Q2T"
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setLooked(codeFromScan(code)); } }}
                />
              </Field>
              <Button type="button" variant="ghost" onClick={() => setLooked(codeFromScan(code))}>
                <ScanLine className="size-4" /> Look up
              </Button>
              <Button type="button" variant="ghost" onClick={toggleCamera} aria-pressed={cameraOn}>
                {cameraOn ? <CameraOff className="size-4" /> : <Camera className="size-4" />}
                {cameraOn ? "Stop" : "Camera"}
              </Button>
            </div>
            {cameraNote && <p className="text-xs text-steel">{cameraNote}</p>}

            {looked && found === null && <p className="text-sm text-critical">No gear found for that code.</p>}

            {found && (
              <div className="space-y-3 rounded-lg border border-hairline p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-bone">{found.name}</p>
                    <p className="font-meta text-xs text-steel">{found.barcode}</p>
                  </div>
                  <Badge tone={found.out ? (found.out.overdue ? "critical" : "caution") : "positive"}>
                    {found.out ? (found.out.overdue ? "Overdue" : "Out") : found.status === "available" ? "In" : found.status.replace("_", " ")}
                  </Badge>
                </div>

                {found.out ? (
                  <>
                    <p className="text-sm text-steel">
                      With {found.out.holderLabel} since {new Date(found.out.outAt).toLocaleString()}
                      {found.out.dueAt ? `, due ${new Date(found.out.dueAt).toLocaleString()}` : ""}.
                    </p>
                    <Field label="Return notes (optional)" htmlFor="gear-return-notes">
                      <Input id="gear-return-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </Field>
                    <Button
                      disabled={busy}
                      onClick={() => run(() => checkIn({ equipmentId: found.equipmentId as Id<"equipment">, ...(notes.trim() ? { notes } : {}) }), `${found.name} checked in`)}
                    >
                      Check in
                    </Button>
                  </>
                ) : (
                  <>
                    <Field label="Check out to" htmlFor="gear-holder-kind">
                      <Select value={kind} onValueChange={(v) => setKind(v as HolderKind)}>
                        <SelectTrigger id="gear-holder-kind"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">A team member</SelectItem>
                          <SelectItem value="client">A client</SelectItem>
                          <SelectItem value="session">A session</SelectItem>
                          <SelectItem value="rental">A rental</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    {kind === "member" && (
                      <Select value={memberId} onValueChange={setMemberId}>
                        <SelectTrigger aria-label="Team member"><SelectValue placeholder="Pick a person" /></SelectTrigger>
                        <SelectContent>{(members ?? []).map((m) => <SelectItem key={m._id} value={m._id}>{m.name}</SelectItem>)}</SelectContent>
                      </Select>
                    )}
                    {kind === "client" && (
                      <Select value={artistId} onValueChange={setArtistId}>
                        <SelectTrigger aria-label="Client"><SelectValue placeholder="Pick a client" /></SelectTrigger>
                        <SelectContent>{(artists ?? []).map((a) => <SelectItem key={a._id} value={a._id}>{a.name}</SelectItem>)}</SelectContent>
                      </Select>
                    )}
                    {kind === "session" && (
                      <Select value={sessionId} onValueChange={setSessionId}>
                        <SelectTrigger aria-label="Session"><SelectValue placeholder="Pick a session" /></SelectTrigger>
                        <SelectContent>
                          {(sessions ?? []).map((s) => (
                            <SelectItem key={s._id} value={s._id}>{s.title} · {new Date(s.startTime).toLocaleDateString()}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {kind === "rental" && (
                      <Input aria-label="Who is renting" placeholder="Who is renting it" value={label} onChange={(e) => setLabel(e.target.value)} />
                    )}
                    <Field label="Due back (optional)" htmlFor="gear-due">
                      <Input id="gear-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
                    </Field>
                    <Field label="Notes (optional)" htmlFor="gear-notes">
                      <Input id="gear-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </Field>
                    <Button disabled={busy || !holderReady} onClick={submitOut}>Check out</Button>
                  </>
                )}
              </div>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
