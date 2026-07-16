"use client";

import * as React from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Check, UserPlus } from "lucide-react";
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
import { Field, Input, Textarea } from "@/components/ui/field";
import { PhotoUpload } from "@/components/ui/photo-upload";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { TagInput } from "@/components/roster/tag-input";
import { MEMBER_ROLES, type MemberRole } from "@/components/studio/constants";

export type EditableMember = {
  _id: Id<"members">;
  name: string;
  email?: string;
  phone?: string;
  role: string;
  skills: string[];
  photoUrl?: string | null;
  bio?: string;
  credits?: string[];
  spotifyUrl?: string;
  playlistUrls?: string[];
};

/** Roles that get a client-facing engineer profile (mirrors the server). */
const ENGINEER_ROLES = new Set(["owner", "engineer", "assistant_engineer", "producer"]);

type FormState = {
  name: string;
  email: string;
  phone: string;
  role: MemberRole;
  skills: string[];
  bio: string;
  credits: string;
  spotifyUrl: string;
  playlists: string;
};

const BLANK: FormState = {
  name: "",
  email: "",
  phone: "",
  role: "engineer",
  skills: [],
  bio: "",
  credits: "",
  spotifyUrl: "",
  playlists: "",
};

function toForm(member: EditableMember): FormState {
  return {
    name: member.name,
    email: member.email ?? "",
    phone: member.phone ?? "",
    role: member.role as MemberRole,
    skills: member.skills ?? [],
    bio: member.bio ?? "",
    credits: (member.credits ?? []).join("\n"),
    spotifyUrl: member.spotifyUrl ?? "",
    playlists: (member.playlistUrls ?? []).join("\n"),
  };
}

/**
 * Add or edit a team member. Pass `member` to edit an existing record,
 * omit it to invite a new one. Parent owns `open`.
 */
export function MemberDialog({
  member,
  open,
  onOpenChange,
}: {
  member?: EditableMember;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = member !== undefined;
  const createMember = useMutation(api.members.create);
  const inviteTeammate = useAction(api.members.inviteTeammate);
  const updateMember = useMutation(api.members.update);
  const setProfile = useMutation(api.members.setProfile);
  const genPhotoUrl = useMutation(api.members.generateUploadUrl);
  const setPhoto = useMutation(api.members.setPhoto);
  const clearPhoto = useMutation(api.members.clearPhoto);
  const [form, setForm] = React.useState<FormState>(
    member ? toForm(member) : BLANK,
  );
  const [submitting, setSubmitting] = React.useState(false);

  // Re-seed the form each time the dialog opens.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) setForm(member ? toForm(member) : BLANK);
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      toast.error("A team member needs a name.");
      return;
    }
    setSubmitting(true);
    try {
      const phone = form.phone.trim() || undefined;
      if (isEdit && member) {
        await updateMember({
          id: member._id,
          name,
          phone: form.phone.trim(),
          role: form.role,
          skills: form.skills,
        });
        if (ENGINEER_ROLES.has(form.role)) {
          await setProfile({
            id: member._id,
            bio: form.bio,
            credits: form.credits.split("\n").map((c) => c.trim()).filter(Boolean),
            spotifyUrl: form.spotifyUrl,
            playlistUrls: form.playlists.split("\n").map((u) => u.trim()).filter(Boolean),
          });
        }
        toast.success("Team member updated.");
      } else {
        const email = form.email.trim();
        const skills = form.skills.length ? form.skills : undefined;
        if (email) {
          // Email present → create the member AND email them a branded invite
          // with their role, so they can claim an account and onboard.
          const res = await inviteTeammate({ name, email, phone, role: form.role, skills });
          toast.success(
            res.inviteSent
              ? `Invite sent to ${email}.`
              : `${name} added - invite email couldn't send, you can resend it.`,
          );
        } else {
          await createMember({ name, phone, role: form.role, skills });
          toast.success(`${name} added to the team.`);
        }
      }
      onOpenChange(false);
    } catch {
      toast.error("Could not save changes. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit team member" : "Add team member"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? `Update the role and skills for ${member?.name}.`
              : "Invite someone onto the studio team. Their role sets what they can reach."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogBody className="space-y-4">
            {isEdit && member && (
              <Field label="Profile photo">
                <PhotoUpload
                  shape="circle"
                  photo={member.photoUrl}
                  generateUploadUrl={genPhotoUrl}
                  onStorageId={(storageId) => setPhoto({ id: member._id, storageId })}
                  onClear={() => clearPhoto({ id: member._id })}
                  hint="Use your camera or photo library."
                />
              </Field>
            )}
            <Field label="Name" htmlFor="member-name">
              <Input
                id="member-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Full name"
                autoFocus
                required
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Email"
                htmlFor="member-email"
                hint={
                  !isEdit && form.email.trim()
                    ? "We'll email them a branded invite to join and set up their profile."
                    : undefined
                }
              >
                <Input
                  id="member-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="name@studio.com"
                  autoComplete="off"
                  disabled={isEdit}
                />
              </Field>
              <Field
                label="Cell phone"
                htmlFor="member-phone"
                hint="On file for scheduling + SMS."
              >
                <Input
                  id="member-phone"
                  type="tel"
                  inputMode="tel"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="(404) 555-0134"
                  autoComplete="off"
                />
              </Field>
              <Field label="Role" htmlFor="member-role">
                <Select
                  value={form.role}
                  onValueChange={(v) => set("role", v as MemberRole)}
                >
                  <SelectTrigger id="member-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEMBER_ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <p className="rounded-md border border-graphite/50 bg-coal-2 px-3 py-2 text-[0.6875rem] text-steel/70">
              {MEMBER_ROLES.find((r) => r.value === form.role)?.blurb}
            </p>

            <Field
              label="Skills"
              htmlFor="member-skills"
              hint="Press Enter or comma to add each skill."
            >
              <TagInput
                id="member-skills"
                value={form.skills}
                onChange={(v) => set("skills", v)}
                placeholder="Tracking, mixing, vocal production…"
              />
            </Field>

            {isEdit && ENGINEER_ROLES.has(form.role) && (
              <div className="space-y-4 rounded-md border border-graphite/50 bg-coal-2 p-3">
                <div>
                  <p className="text-sm font-semibold text-bone">Engineer profile</p>
                  <p className="text-[0.6875rem] text-steel/70">
                    Stats, credits and listening links - shown to clients when they pick
                    who runs their session.
                  </p>
                </div>
                <Field label="Bio" hint="1-2 sentences, shown to clients.">
                  <Textarea
                    value={form.bio}
                    onChange={(e) => set("bio", e.target.value)}
                    placeholder="12 years behind the SSL. Vocal-forward hip-hop and R&B."
                    rows={2}
                  />
                </Field>
                <Field label="Notable credits" hint="One per line.">
                  <Textarea
                    value={form.credits}
                    onChange={(e) => set("credits", e.target.value)}
                    placeholder={"Drake - Certified Lover Boy\nSZA - SOS"}
                    rows={2}
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Spotify profile" hint="Artist or profile page link.">
                    <Input
                      type="url"
                      value={form.spotifyUrl}
                      onChange={(e) => set("spotifyUrl", e.target.value)}
                      placeholder="https://open.spotify.com/artist/..."
                    />
                  </Field>
                  <Field label="Playlist links" hint="One per line - work showcases.">
                    <Textarea
                      value={form.playlists}
                      onChange={(e) => set("playlists", e.target.value)}
                      placeholder={"https://open.spotify.com/playlist/..."}
                      rows={2}
                    />
                  </Field>
                </div>
              </div>
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
            <Button type="submit" disabled={submitting}>
              {isEdit ? <Check className="size-4" /> : <UserPlus className="size-4" />}
              {submitting
                ? "Saving…"
                : isEdit
                  ? "Save changes"
                  : form.email.trim()
                    ? "Send invite"
                    : "Add to team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
