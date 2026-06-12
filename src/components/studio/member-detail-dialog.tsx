"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Mail, NotebookPen, Pencil, Phone, UserCheck } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { tintFromString } from "@/lib/utils";
import { MEMBER_ROLE } from "@/components/studio/constants";
import type { TeamMember } from "@/components/studio/member-card";

/* Click-through detail view for a team member: photo, role, contact info,
   skills, invite status, and editable internal notes. The Edit button hands
   off to the existing MemberDialog. */
export function MemberDetailDialog({
  member,
  open,
  onOpenChange,
  onEdit,
}: {
  member: TeamMember;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEdit: () => void;
}) {
  const update = useMutation(api.members.update);
  const [notes, setNotes] = React.useState(member.notes ?? "");
  const [savingNotes, setSavingNotes] = React.useState(false);
  const role = MEMBER_ROLE[member.role] ?? { label: member.role, tone: "neutral" as const };
  const notesDirty = notes !== (member.notes ?? "");

  React.useEffect(() => {
    if (open) setNotes(member.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, member._id]);

  async function saveNotes() {
    setSavingNotes(true);
    try {
      await update({ id: member._id, notes });
      toast.success("Notes saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save notes.");
    } finally {
      setSavingNotes(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-4">
            <Avatar name={member.name} src={member.photoUrl} color={member.avatarColor} size="lg" />
            <div className="min-w-0">
              <DialogTitle className="truncate">{member.name}</DialogTitle>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone={role.tone}>{role.label}</Badge>
                {member.inviteStatus === "active" && (
                  <Badge tone="positive" className="gap-1">
                    <UserCheck className="size-3" />
                    Has account
                  </Badge>
                )}
                {member.inviteStatus === "pending" && <Badge tone="caution">Invite pending</Badge>}
              </div>
            </div>
          </div>
          <DialogDescription className="sr-only">Team member details</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          {/* Contact */}
          <div className="space-y-2">
            <p className="overline">Contact</p>
            {member.email ? (
              <a
                href={`mailto:${member.email}`}
                className="flex items-center gap-2 text-sm text-bone transition-colors hover:text-gold-bright"
              >
                <Mail className="size-3.5 text-steel/70" />
                {member.email}
              </a>
            ) : (
              <p className="flex items-center gap-2 text-sm text-steel/60">
                <Mail className="size-3.5 text-steel/40" />
                No email on file
              </p>
            )}
            {member.phone ? (
              <a
                href={`tel:${member.phone}`}
                className="flex items-center gap-2 text-sm text-bone transition-colors hover:text-gold-bright"
              >
                <Phone className="size-3.5 text-steel/70" />
                {member.phone}
              </a>
            ) : (
              <p className="flex items-center gap-2 text-sm text-steel/60">
                <Phone className="size-3.5 text-steel/40" />
                No phone on file
              </p>
            )}
          </div>

          {/* Skills */}
          {member.skills.length > 0 && (
            <div className="space-y-2">
              <p className="overline">Skills</p>
              <div className="flex flex-wrap gap-1.5">
                {member.skills.map((skill) => {
                  const tint = tintFromString(skill);
                  return (
                    <span
                      key={skill}
                      className="inline-flex items-center gap-1 rounded-sm border border-graphite/60 bg-coal-2 px-2 py-0.5 text-[0.6875rem] font-medium text-bone"
                    >
                      <span className="size-1.5 rounded-full" style={{ backgroundColor: tint }} />
                      {skill}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <p className="overline flex items-center gap-1.5">
              <NotebookPen className="size-3 text-steel/70" />
              Notes
            </p>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Internal notes - certifications, availability quirks, preferences…"
            />
            {notesDirty && (
              <div className="flex justify-end">
                <Button size="sm" variant="secondary" disabled={savingNotes} onClick={() => void saveNotes()}>
                  {savingNotes ? "Saving…" : "Save notes"}
                </Button>
              </div>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              onEdit();
            }}
          >
            <Pencil className="size-4" />
            Edit member
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
