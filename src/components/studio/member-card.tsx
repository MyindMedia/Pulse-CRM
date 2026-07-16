"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Mail, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { tintFromString } from "@/lib/utils";
import { MEMBER_ROLE } from "@/components/studio/constants";
import {
  MemberDialog,
  type EditableMember,
} from "@/components/studio/member-dialog";
import { MemberDetailDialog } from "@/components/studio/member-detail-dialog";

export type TeamMember = {
  _id: Id<"members">;
  name: string;
  email?: string;
  phone?: string;
  role: string;
  skills: string[];
  avatarColor?: string;
  clerkUserId?: string;
  photoUrl?: string | null;
  notes?: string;
  bio?: string;
  credits?: string[];
  spotifyUrl?: string;
  playlistUrls?: string[];
  inviteStatus?: "active" | "pending" | "expired" | "none";
  invitedAt?: number;
};

function toEditable(member: TeamMember): EditableMember {
  return {
    _id: member._id,
    name: member.name,
    email: member.email,
    phone: member.phone,
    role: member.role,
    skills: member.skills ?? [],
    photoUrl: member.photoUrl,
  };
}

/** A team member card with an edit/remove menu. */
export function MemberCard({ member }: { member: TeamMember }) {
  const [editOpen, setEditOpen] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const role = MEMBER_ROLE[member.role] ?? { label: member.role, tone: "neutral" as const };

  return (
    <>
      <Card
        className="flex cursor-pointer flex-col transition-colors hover:border-graphite"
        role="button"
        tabIndex={0}
        aria-label={`View ${member.name}`}
        onClick={() => setDetailOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setDetailOpen(true);
          }
        }}
      >
        <CardContent className="flex flex-1 flex-col gap-3 p-4 pt-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar
                name={member.name}
                src={member.photoUrl}
                color={member.avatarColor}
                size="md"
              />
              <div className="min-w-0">
                <p className="truncate font-grotesk text-sm font-semibold text-bone">
                  {member.name}
                </p>
                <Badge tone={role.tone} className="mt-1">
                  {role.label}
                </Badge>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${member.name}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                  <Pencil className="size-4" />
                  Edit member
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  destructive
                  onSelect={() => setConfirmOpen(true)}
                >
                  <Trash2 className="size-4" />
                  Remove member
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {member.email && (
            <a
              href={`mailto:${member.email}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1.5 truncate text-xs text-steel transition-colors hover:text-gold-bright"
            >
              <Mail className="size-3 shrink-0 text-steel/70" />
              {member.email}
            </a>
          )}

          <div className="mt-auto border-t border-graphite/50 pt-3">
            {member.skills.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {member.skills.map((skill) => {
                  const tint = tintFromString(skill);
                  return (
                    <span
                      key={skill}
                      className="inline-flex items-center gap-1 rounded-sm border border-graphite/60 bg-coal-2 px-2 py-0.5 text-[0.6875rem] font-medium text-bone"
                    >
                      <span
                        className="size-1.5 rounded-full"
                        style={{ backgroundColor: tint }}
                      />
                      {skill}
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-[0.6875rem] text-steel/70">No skills listed.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <MemberDetailDialog
        member={member}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onEdit={() => setEditOpen(true)}
      />

      <MemberDialog
        member={toEditable(member)}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <RemoveMemberDialog
        member={member}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
      />
    </>
  );
}

/** Confirmation dialog for removing a team member. */
export function RemoveMemberDialog({
  member,
  open,
  onOpenChange,
}: {
  member: TeamMember;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const removeMember = useMutation(api.members.remove);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleRemove() {
    setSubmitting(true);
    try {
      await removeMember({ id: member._id });
      toast.success(`${member.name} removed from the team.`);
      onOpenChange(false);
    } catch {
      toast.error("Could not remove the member. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Remove {member.name}?</DialogTitle>
          <DialogDescription>
            They lose access to the workspace. Their past sessions and logs stay
            on the records.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-steel">
            This only removes the team membership - it does not delete any
            session history.
          </p>
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
          <Button
            type="button"
            variant="danger"
            onClick={handleRemove}
            disabled={submitting}
          >
            <Trash2 className="size-4" />
            {submitting ? "Removing…" : "Remove member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
