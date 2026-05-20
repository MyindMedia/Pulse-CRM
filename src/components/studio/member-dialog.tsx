"use client";

import * as React from "react";
import { useMutation } from "convex/react";
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
import { Field, Input } from "@/components/ui/field";
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
  role: string;
  skills: string[];
};

type FormState = {
  name: string;
  email: string;
  role: MemberRole;
  skills: string[];
};

const BLANK: FormState = {
  name: "",
  email: "",
  role: "engineer",
  skills: [],
};

function toForm(member: EditableMember): FormState {
  return {
    name: member.name,
    email: member.email ?? "",
    role: member.role as MemberRole,
    skills: member.skills ?? [],
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
  const updateMember = useMutation(api.members.update);
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
      if (isEdit && member) {
        await updateMember({
          id: member._id,
          name,
          role: form.role,
          skills: form.skills,
        });
        toast.success("Team member updated.");
      } else {
        await createMember({
          name,
          email: form.email.trim() || undefined,
          role: form.role,
          skills: form.skills.length ? form.skills : undefined,
        });
        toast.success(`${name} added to the team.`);
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
              <Field label="Email" htmlFor="member-email">
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

            <p className="rounded-md border border-hairline bg-coal-2 px-3 py-2 text-[0.6875rem] text-ash-dim">
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
                  : "Add to team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
