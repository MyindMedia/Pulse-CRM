"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { useClerk, useUser } from "@clerk/nextjs";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { ChevronDown, LogOut, UserPen } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";

/* The signed-in agency operator's corner of the console top bar. Mirrors the
   studio ProfileMenu but reads the agency-side profile (agencyProfile.mine),
   which self-provisions a member row on first save for allowlist owners. */

export function AgencyProfileMenu() {
  const profile = useQuery(api.agencyProfile.mine);
  const { signOut } = useClerk();
  const { user } = useUser();
  const [profileOpen, setProfileOpen] = React.useState(false);

  // Don't render for non-agency callers (query returns null).
  if (profile === null) return null;

  const name = profile?.name ?? user?.fullName ?? "Agency";
  const email = profile?.email ?? user?.primaryEmailAddress?.emailAddress ?? null;
  const photo = profile?.photoUrl ?? user?.imageUrl ?? null;
  const role = profile?.role ?? "owner";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-2 rounded-md border border-graphite/60 bg-coal/60 py-1 pl-1 pr-2 transition-colors hover:border-graphite hover:bg-coal"
            aria-label="Account menu"
          >
            <Avatar name={name} src={photo} size="sm" />
            <span className="hidden leading-tight text-left sm:block">
              <span className="block font-grotesk text-xs font-medium text-bone">{name}</span>
              <span className="font-meta block text-[0.5625rem] uppercase tracking-[0.18em] text-steel/80">
                {profile?.title ?? `Agency ${role}`}
              </span>
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
                <Badge tone="gold" className="capitalize">Agency {role}</Badge>
              </div>
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
            <UserPen className="size-4" />
            Edit profile
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void signOut({ redirectUrl: "/sign-in" })}>
            <LogOut className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AgencyProfileDialog open={profileOpen} onOpenChange={setProfileOpen} fallbackName={name} />
    </>
  );
}

function AgencyProfileDialog({
  open,
  onOpenChange,
  fallbackName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fallbackName: string;
}) {
  const profile = useQuery(api.agencyProfile.mine);
  const generateUploadUrl = useMutation(api.agencyProfile.generateUploadUrl);
  const setMyPhoto = useMutation(api.agencyProfile.setMyPhoto);
  const clearMyPhoto = useMutation(api.agencyProfile.clearMyPhoto);
  const updateMine = useMutation(api.agencyProfile.updateMine);

  const [name, setName] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(profile?.name ?? fallbackName);
      setTitle(profile?.title ?? "");
      setPhone(profile?.phone ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile?.memberId, profile?.provisioned]);

  async function save() {
    setSaving(true);
    try {
      await updateMine({ name, title, phone });
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
            How you appear across the agency console and to your sub-accounts.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <Field label="Profile photo">
            <PhotoUpload
              shape="circle"
              photo={profile?.photoUrl}
              generateUploadUrl={() => generateUploadUrl({})}
              onStorageId={(storageId) => setMyPhoto({ storageId })}
              onClear={profile?.hasUploadedPhoto ? () => clearMyPhoto({}) : undefined}
              hint="Synced from your account photo until you upload one."
            />
          </Field>
          <Field label="Name" htmlFor="ag-profile-name">
            <Input
              id="ag-profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </Field>
          <Field label="Title" htmlFor="ag-profile-title" hint="Shown next to your name, e.g. Founder.">
            <Input
              id="ag-profile-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Founder"
            />
          </Field>
          <Field label="Cell phone" htmlFor="ag-profile-phone" hint="For agency notifications.">
            <Input
              id="ag-profile-phone"
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
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
