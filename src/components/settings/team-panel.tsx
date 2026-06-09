"use client";

import * as React from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import { Mail, MoreHorizontal, Pencil, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MEMBER_ROLE, MEMBER_ROLES, type MemberRole } from "@/components/studio/constants";
import { MemberDialog } from "@/components/studio/member-dialog";
import {
  RemoveMemberDialog,
  type TeamMember,
} from "@/components/studio/member-card";

/** Role explainer - owner / manager / engineer access summary. */
function RoleExplainer() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-gold" />
          Role permissions
        </CardTitle>
        <CardDescription>
          What each role can reach in the workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        {MEMBER_ROLES.map((r) => {
          const tone = MEMBER_ROLE[r.value]?.tone ?? "neutral";
          return (
            <div
              key={r.value}
              className="rounded-md border border-graphite/50 bg-coal-2 p-3"
            >
              <Badge tone={tone}>{r.label}</Badge>
              <p className="mt-2 text-[0.6875rem] leading-relaxed text-steel/70">
                {r.blurb}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** Invitation-status badge for the team table. */
function InviteStatusCell({ member }: { member: TeamMember }) {
  const status = member.inviteStatus ?? "none";
  if (status === "active") return <Badge tone="positive">Active</Badge>;
  if (!member.email) return <span className="text-steel/70">-</span>;
  if (status === "pending") return <Badge tone="caution">Invited</Badge>;
  if (status === "expired") return <Badge tone="critical">Expired</Badge>;
  return <Badge tone="neutral">Not invited</Badge>;
}

/** Team administration - invite, edit role, remove members. */
export function TeamPanel() {
  const members = useQuery(api.members.list) as TeamMember[] | undefined;
  const updateMember = useMutation(api.members.update);
  const resendInvite = useAction(api.members.resendInvite);

  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [editMember, setEditMember] = React.useState<TeamMember | null>(null);
  const [removeMember, setRemoveMember] = React.useState<TeamMember | null>(null);

  async function resend(member: TeamMember) {
    try {
      const res = await resendInvite({ memberId: member._id });
      toast.success(
        res.inviteSent
          ? `Invitation re-sent to ${member.email}.`
          : "Re-sent, but the email couldn't deliver. Check the address.",
      );
    } catch (e) {
      toast.error(e instanceof ConvexError ? String(e.data) : "Could not resend the invitation.");
    }
  }

  async function changeRole(member: TeamMember, role: MemberRole) {
    if (role === member.role) return;
    try {
      await updateMember({
        id: member._id,
        name: member.name,
        role,
        skills: member.skills ?? [],
      });
      toast.success(`${member.name} is now ${MEMBER_ROLE[role]?.label.toLowerCase()}.`);
    } catch {
      toast.error("Could not change the role. Try again.");
    }
  }

  return (
    <div className="space-y-4">
      <RoleExplainer />

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div className="space-y-1">
            <CardTitle>Team members</CardTitle>
            <CardDescription>
              Manage who is on the studio and what they can do.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" />
            Invite member
          </Button>
        </CardHeader>
        <CardContent>
          {members === undefined ? (
            <SkeletonRows rows={4} />
          ) : members.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No team members yet"
              description="Invite the engineers, managers and owners who run this studio."
              action={
                <Button onClick={() => setInviteOpen(true)}>
                  <UserPlus className="size-4" />
                  Invite member
                </Button>
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Member</TH>
                  <TH>Email</TH>
                  <TH>Role</TH>
                  <TH>Invitation</TH>
                  <TH>Skills</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {members.map((member) => {
                  const role =
                    MEMBER_ROLE[member.role] ?? {
                      label: member.role,
                      tone: "neutral" as const,
                    };
                  return (
                    <TR key={member._id}>
                      <TD>
                        <div className="flex items-center gap-2.5">
                          <Avatar
                            name={member.name}
                            color={member.avatarColor}
                            size="sm"
                          />
                          <span className="font-medium text-bone">
                            {member.name}
                          </span>
                        </div>
                      </TD>
                      <TD className="text-steel">
                        {member.email || member.phone ? (
                          <div className="leading-tight">
                            {member.email && <div>{member.email}</div>}
                            {member.phone && (
                              <div className="text-xs text-steel/70">{member.phone}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-steel/70">-</span>
                        )}
                      </TD>
                      <TD>
                        <Badge tone={role.tone}>{role.label}</Badge>
                      </TD>
                      <TD>
                        <InviteStatusCell member={member} />
                      </TD>
                      <TD>
                        {member.skills.length > 0 ? (
                          <span className="text-xs text-steel">
                            {member.skills.slice(0, 3).join(", ")}
                            {member.skills.length > 3 &&
                              ` +${member.skills.length - 3}`}
                          </span>
                        ) : (
                          <span className="text-xs text-steel/70">-</span>
                        )}
                      </TD>
                      <TD className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Actions for ${member.name}`}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => setEditMember(member)}
                            >
                              <Pencil className="size-4" />
                              Edit member
                            </DropdownMenuItem>
                            {member.email &&
                              (member.inviteStatus ?? "none") !== "active" && (
                                <DropdownMenuItem onSelect={() => resend(member)}>
                                  <Mail className="size-4" />
                                  {member.inviteStatus === "pending"
                                    ? "Resend invitation"
                                    : member.inviteStatus === "expired"
                                      ? "Resend (expired)"
                                      : "Send invitation"}
                                </DropdownMenuItem>
                              )}
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>Set role</DropdownMenuLabel>
                            {MEMBER_ROLES.map((r) => (
                              <DropdownMenuItem
                                key={r.value}
                                onSelect={() => changeRole(member, r.value)}
                                disabled={r.value === member.role}
                              >
                                {r.label}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              destructive
                              onSelect={() => setRemoveMember(member)}
                            >
                              <Trash2 className="size-4" />
                              Remove member
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <MemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      {editMember && (
        <MemberDialog
          member={{
            _id: editMember._id,
            name: editMember.name,
            email: editMember.email,
            phone: editMember.phone,
            role: editMember.role,
            skills: editMember.skills ?? [],
            photoUrl: editMember.photoUrl,
          }}
          open
          onOpenChange={(open) => {
            if (!open) setEditMember(null);
          }}
        />
      )}
      {removeMember && (
        <RemoveMemberDialog
          member={removeMember}
          open
          onOpenChange={(open) => {
            if (!open) setRemoveMember(null);
          }}
        />
      )}
    </div>
  );
}
