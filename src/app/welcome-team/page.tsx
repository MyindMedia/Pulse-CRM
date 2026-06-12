"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Check, ChevronRight, Loader2, Plus, X, CalendarClock } from "lucide-react";
import { PulseLogo } from "@/components/brand/pulse-logo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import { PhotoUpload } from "@/components/ui/photo-upload";
import { Avatar } from "@/components/ui/avatar";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { MEMBER_ROLE, MEMBER_ROLES } from "@/components/studio/constants";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const toHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

type Slot = { weekday: number; startMinutes: number; endMinutes: number };
type StepKey = "intro" | "photo" | "availability";
const STEPS: { key: StepKey; title: string; blurb: string }[] = [
  { key: "intro", title: "Welcome to the team", blurb: "Here's what your role can do in Pulse." },
  { key: "photo", title: "Add your photo", blurb: "So the team knows who's who across sessions and the schedule." },
  { key: "availability", title: "Your weekly availability", blurb: "Set the hours you usually work so you get scheduled right." },
];

export default function WelcomeTeamPage() {
  const profile = useQuery(api.members.myProfile, {});

  if (profile === undefined) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink text-steel">
        <Loader2 className="size-5 animate-spin text-gold" />
      </div>
    );
  }
  if (profile === null) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink px-4 text-center">
        <div className="max-w-sm space-y-4">
          <PulseLogo className="mx-auto h-7" />
          <p className="text-sm text-steel">
            We couldn&apos;t link your profile to your login yet. If you just accepted an invite, give
            it a moment and refresh - or ask your studio to re-send your invite.
          </p>
          <WelcomeTeamSkip />
        </div>
      </div>
    );
  }

  return <Wizard key={profile._id} profile={profile} />;
}

function WelcomeTeamSkip() {
  const router = useRouter();
  return (
    <Button variant="secondary" size="sm" onClick={() => router.push("/dashboard")}>
      Go to dashboard
    </Button>
  );
}

function Wizard({
  profile,
}: {
  profile: { _id: string; name: string; role: string; photoUrl: string | null };
}) {
  const router = useRouter();
  const avail = useQuery(api.availability.myAvailability, {});
  const generateUploadUrl = useMutation(api.members.generateUploadUrl);
  const setMyPhoto = useMutation(api.members.setMyPhoto);
  const clearMyPhoto = useMutation(api.members.clearMyPhoto);
  const saveAvail = useMutation(api.availability.setMyAvailability);

  const [step, setStep] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [slots, setSlots] = React.useState<Slot[] | null>(null);

  const editable = slots ?? avail?.slots ?? [];
  const roleMeta = MEMBER_ROLES.find((r) => r.value === profile.role);
  const roleLabel = MEMBER_ROLE[profile.role]?.label ?? profile.role;

  function finishLater() {
    router.push("/dashboard");
  }

  async function next() {
    const key = STEPS[step].key;
    if (key === "availability") {
      setBusy(true);
      try {
        await saveAvail({ slots: editable });
      } catch {
        toast.error("Could not save your availability.");
        setBusy(false);
        return;
      }
      setBusy(false);
      toast.success("You're all set. Welcome to the team!");
      router.push("/dashboard");
      return;
    }
    setStep((s) => s + 1);
  }

  return (
    <div className="min-h-dvh bg-ink">
      <div className="app-bloom" aria-hidden />
      <div className="relative z-10 mx-auto flex min-h-dvh max-w-xl flex-col px-5 py-10">
        <div className="flex items-center justify-between">
          <PulseLogo className="h-6" />
          <button onClick={finishLater} className="text-xs font-medium text-steel transition-colors hover:text-bone">
            Finish later
          </button>
        </div>

        <div className="mt-8 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-meta uppercase tracking-[0.18em] text-steel/70">
              Step {step + 1} of {STEPS.length}
            </span>
            <span className="text-steel">{STEPS[step].title}</span>
          </div>
          <Progress value={step + 1} max={STEPS.length} />
        </div>

        <div className="mt-8 flex-1">
          <h1 className="font-grotesk text-2xl font-bold tracking-tight text-bone">{STEPS[step].title}</h1>
          <p className="mt-1 text-sm text-steel">{STEPS[step].blurb}</p>

          <div className="mt-6 space-y-4">
            {STEPS[step].key === "intro" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-chrome border border-graphite/60 bg-coal/40 px-4 py-3.5">
                  <Avatar name={profile.name} src={profile.photoUrl} size="md" />
                  <div className="min-w-0">
                    <p className="truncate font-grotesk text-base font-semibold text-bone">{profile.name}</p>
                    <p className="text-xs text-gold">{roleLabel}</p>
                  </div>
                </div>
                <div className="rounded-chrome border border-graphite/50 bg-coal-2 px-4 py-3.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-steel/70">What you can do</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-bone">
                    {roleMeta?.blurb ?? "Your studio set up your access. You can reach the areas your role allows."}
                  </p>
                </div>
                <p className="text-sm leading-relaxed text-steel">
                  Two quick things and you&apos;re in: add a profile photo, then set your weekly availability so
                  the schedule books you at the right times.
                </p>
              </div>
            )}

            {STEPS[step].key === "photo" && (
              <Field label="Profile photo">
                <PhotoUpload
                  shape="circle"
                  photo={profile.photoUrl}
                  generateUploadUrl={generateUploadUrl}
                  onStorageId={(storageId) => setMyPhoto({ storageId })}
                  onClear={() => clearMyPhoto({})}
                  hint="Use your camera or photo library. You can skip and add it later."
                />
              </Field>
            )}

            {STEPS[step].key === "availability" && (
              <div className="space-y-2">
                {editable.length === 0 && (
                  <p className="rounded-md border border-graphite/50 bg-coal/40 px-3 py-2 text-xs text-steel/70">
                    No hours yet. Add the days you usually work - you can change this anytime from the Schedule page.
                  </p>
                )}
                {editable.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select
                      value={String(s.weekday)}
                      onValueChange={(v) => setSlots(editable.map((x, j) => (j === i ? { ...x, weekday: Number(v) } : x)))}
                    >
                      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>{WD.map((d, wi) => <SelectItem key={wi} value={String(wi)}>{d}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="time" className="w-28" value={toHM(s.startMinutes)}
                      onChange={(e) => setSlots(editable.map((x, j) => (j === i ? { ...x, startMinutes: toMin(e.target.value) } : x)))} />
                    <Input type="time" className="w-28" value={toHM(s.endMinutes)}
                      onChange={(e) => setSlots(editable.map((x, j) => (j === i ? { ...x, endMinutes: toMin(e.target.value) } : x)))} />
                    <button aria-label="Remove" onClick={() => setSlots(editable.filter((_, j) => j !== i))} className="text-steel/70 hover:text-critical">
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
                <Button size="sm" variant="secondary"
                  onClick={() => setSlots([...editable, { weekday: 1, startMinutes: 540, endMinutes: 1020 }])}>
                  <Plus className="size-3.5" />Add day
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between border-t border-graphite/50 pt-5">
          <Button variant="ghost" size="sm" disabled={step === 0 || busy}
            onClick={() => setStep((s) => Math.max(0, s - 1))}>
            Back
          </Button>
          <Button size="sm" disabled={busy} onClick={next}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {STEPS[step].key === "availability" ? (
              <>Finish<Check className="size-3.5" /></>
            ) : STEPS[step].key === "intro" ? (
              <>Get started<ChevronRight className="size-3.5" /></>
            ) : (
              <>Continue<CalendarClock className="size-3.5" /></>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
