"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import { useClerk, useUser } from "@clerk/nextjs";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bell,
  ChevronDown,
  FileText,
  LogOut,
  Sparkles,
  TrendingUp,
  UserPen,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PhotoUpload } from "@/components/ui/photo-upload";
import { EmptyState } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/* The signed-in user's corner of the topbar: their avatar (uploaded photo or
   Clerk account picture), with a menu for editing their profile, reviewing
   their alerts, and signing out. Replaces the old static plan chip - the plan
   still shows, inside the menu header. */

const SEVERITY = {
  warning: { icon: AlertTriangle, tone: "text-critical", ring: "bg-critical/10" },
  opportunity: { icon: TrendingUp, tone: "text-gold", ring: "bg-gold/10" },
  info: { icon: FileText, tone: "text-info", ring: "bg-info/10" },
} as const;

const KIND_ROUTE: Record<string, string> = {
  artist: "/roster",
  song: "/songs",
  session: "/calendar",
  invoice: "/payments",
  opportunity: "/pipeline",
};

export function ProfileMenu() {
  const org = useQuery(api.orgs.current);
  const profile = useQuery(api.members.myProfile);
  const counts = useQuery(api.insights.counts);
  const { signOut } = useClerk();
  const { user } = useUser();

  const [profileOpen, setProfileOpen] = React.useState(false);
  const [alertsOpen, setAlertsOpen] = React.useState(false);

  // Best available identity: member row first, Clerk account as fallback
  // (owners may not have a member row in older orgs).
  const name = profile?.name ?? user?.fullName ?? org?.actor ?? "Studio";
  const email = profile?.email ?? user?.primaryEmailAddress?.emailAddress ?? null;
  const photo = profile?.photoUrl ?? user?.imageUrl ?? null;
  const alertCount = counts?.new ?? 0;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-2 rounded-chrome border border-graphite/60 bg-coal/60 py-1 pl-1 pr-2 transition-colors hover:border-graphite hover:bg-coal"
            aria-label="Account menu"
          >
            <span className="relative">
              <Avatar name={name} src={photo} size="sm" />
              {alertCount > 0 && (
                <span className="absolute -right-1 -top-1 grid min-w-3.5 place-items-center rounded-full bg-gold px-0.5 text-[0.5625rem] font-bold leading-3 text-gold-ink">
                  {alertCount}
                </span>
              )}
            </span>
            <span className="hidden leading-tight text-left sm:block">
              <span className="block font-grotesk text-xs font-medium text-bone">{name}</span>
              <span className="chrome-meta block text-steel/80">{org?.plan ?? "studio"} plan</span>
            </span>
            <ChevronDown className="hidden size-3.5 text-steel/70 sm:block" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div className="flex items-center gap-3 px-2.5 py-2.5">
            <Avatar name={name} src={photo} size="md" />
            <div className="min-w-0">
              <p className="truncate font-grotesk text-sm font-semibold text-bone">{name}</p>
              {email && <p className="truncate text-xs text-steel">{email}</p>}
              <div className="mt-1 flex items-center gap-1.5">
                {profile?.role && (
                  <Badge tone="neutral" className="capitalize">
                    {profile.role.replace(/_/g, " ")}
                  </Badge>
                )}
                <Badge tone="gold" className="capitalize">{org?.plan ?? "studio"} plan</Badge>
              </div>
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
            <UserPen className="size-4" />
            Edit profile
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAlertsOpen(true)}>
            <Bell className="size-4" />
            Alerts
            {alertCount > 0 && (
              <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-gold px-1.5 text-[0.625rem] font-bold text-gold-ink">
                {alertCount}
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void signOut({ redirectUrl: "/sign-in" })}>
            <LogOut className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} fallbackName={name} />
      <AlertsDialog open={alertsOpen} onOpenChange={setAlertsOpen} />
    </>
  );
}

/* ── Edit profile ─────────────────────────────────────────────── */

function ProfileDialog({
  open,
  onOpenChange,
  fallbackName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fallbackName: string;
}) {
  const profile = useQuery(api.members.myProfile);
  // When the signed-in user is an agency operator (no studio member row), this
  // is non-null and we point them at their agency profile instead of a dead end.
  const agencyProfile = useQuery(api.agencyProfile.mine);
  const generateUploadUrl = useMutation(api.members.generateUploadUrl);
  const setMyPhoto = useMutation(api.members.setMyPhoto);
  const clearMyPhoto = useMutation(api.members.clearMyPhoto);
  const updateMyProfile = useMutation(api.members.updateMyProfile);

  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // Seed the form whenever the dialog opens with fresh data.
  React.useEffect(() => {
    if (open) {
      setName(profile?.name ?? fallbackName);
      setPhone(profile?.phone ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile?._id]);

  async function save() {
    setSaving(true);
    try {
      await updateMyProfile({ name, phone });
      toast.success("Profile updated.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Your profile</DialogTitle>
          <DialogDescription>
            How you appear to your team across Pulse.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          {profile === null && agencyProfile ? (
            <div className="space-y-4">
              <p className="text-sm text-steel">
                You&apos;re signed in as an agency {agencyProfile.role}. Manage your
                profile photo, name and contact details in the agency console.
              </p>
              <Button asChild>
                <Link href="/agency">Open the agency console</Link>
              </Button>
            </div>
          ) : profile === null ? (
            <p className="text-sm text-steel">
              Your account isn&apos;t linked to a team member profile in this studio yet.
              Ask the studio owner to add you on the Team page with this email.
            </p>
          ) : (
            <>
              <Field label="Profile photo">
                <PhotoUpload
                  shape="circle"
                  photo={profile?.photoUrl}
                  generateUploadUrl={() => generateUploadUrl({})}
                  onStorageId={(storageId) => setMyPhoto({ storageId })}
                  onClear={
                    profile?.hasUploadedPhoto ? () => clearMyPhoto({}) : undefined
                  }
                  hint="Synced from your account photo until you upload one."
                />
              </Field>
              <Field label="Name" htmlFor="profile-name">
                <Input
                  id="profile-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                />
              </Field>
              <Field label="Cell phone" htmlFor="profile-phone" hint="Used for shift notifications.">
                <Input
                  id="profile-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 555 010 0000"
                />
              </Field>
              <div className="flex justify-end">
                <Button onClick={() => void save()} disabled={saving || !name.trim()}>
                  {saving ? "Saving…" : "Save profile"}
                </Button>
              </div>
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/* ── Alerts ───────────────────────────────────────────────────── */

function AlertsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const insights = useQuery(api.insights.open, open ? { limit: 25 } : "skip");
  const markAllSeen = useMutation(api.insights.markAllSeen);
  const setStatus = useMutation(api.insights.setStatus);

  React.useEffect(() => {
    if (open) void markAllSeen();
  }, [open, markAllSeen]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Your alerts</DialogTitle>
          <DialogDescription>
            Everything Pulse thinks needs your attention.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[60vh] space-y-1 overflow-y-auto">
          {insights === undefined ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-16 rounded-md" />
              ))}
            </div>
          ) : insights.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="All clear"
              description="No open alerts. Pulse will surface anything that needs you here."
              className="border-0 bg-transparent py-8"
            />
          ) : (
            insights.map((it) => {
              const sev = SEVERITY[it.severity as keyof typeof SEVERITY] ?? SEVERITY.info;
              const Icon = sev.icon;
              const route = it.entityType ? KIND_ROUTE[it.entityType] : undefined;
              return (
                <button
                  key={it._id}
                  className="w-full rounded-md p-2.5 text-left transition-colors hover:bg-coal-2"
                  onClick={() => {
                    if (route && it.entityId) {
                      void setStatus({ id: it._id, status: "actioned" });
                      onOpenChange(false);
                      router.push(`${route}/${it.entityId}`);
                    }
                  }}
                >
                  <div className="flex gap-2.5">
                    <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-md", sev.ring)}>
                      <Icon className={cn("size-3.5", sev.tone)} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-bone">{it.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-steel">{it.body}</p>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
