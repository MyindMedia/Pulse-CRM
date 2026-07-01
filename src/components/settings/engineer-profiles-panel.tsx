"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Save, UserRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";

/** Roles that can be requested to run a session on the public booking page -
 *  mirrors ENGINEER_ROLES on the server. Only these get a client-facing
 *  profile. */
const ENGINEER_ROLES = new Set(["owner", "engineer", "assistant_engineer", "producer"]);

type MemberRow = {
  _id: Id<"members">;
  name: string;
  role: string;
  bio?: string;
  credits?: string[];
  photoUrl: string | null;
};

/** Per-engineer bio + notable credits, shown to clients choosing who runs
 *  their session. Real proof-of-work lifts the booking-page conversion rate. */
export function EngineerProfilesPanel() {
  const members = useQuery(api.members.list) as MemberRow[] | undefined;
  const engineers = (members ?? []).filter((m) => ENGINEER_ROLES.has(m.role));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Engineer profiles</CardTitle>
        <CardDescription>
          A short bio and notable credits for each engineer, producer, and
          assistant. Clients see these when they pick who runs their session -
          proof-of-work that justifies a premium rate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {members === undefined ? (
          <p className="py-6 text-center text-xs text-steel/70">Loading…</p>
        ) : engineers.length === 0 ? (
          <p className="rounded-md border border-dashed border-graphite/60 py-6 text-center text-xs text-steel/70">
            No engineers on the team yet. Invite engineers or producers from the
            Team tab to give them a booking-page profile.
          </p>
        ) : (
          engineers.map((m) => <EngineerRow key={m._id} member={m} />)
        )}
      </CardContent>
    </Card>
  );
}

function EngineerRow({ member }: { member: MemberRow }) {
  const setProfile = useMutation(api.members.setProfile);

  const [bio, setBio] = React.useState(member.bio ?? "");
  const [credits, setCredits] = React.useState((member.credits ?? []).join("\n"));
  const [saving, setSaving] = React.useState(false);

  // Re-seed when the underlying record changes.
  const key = `${member.bio ?? ""}|${(member.credits ?? []).join("\n")}`;
  const [prevKey, setPrevKey] = React.useState(key);
  if (prevKey !== key) {
    setPrevKey(key);
    setBio(member.bio ?? "");
    setCredits((member.credits ?? []).join("\n"));
  }

  const creditsArr = credits
    .split("\n")
    .map((c) => c.trim())
    .filter(Boolean);
  const dirty =
    bio.trim() !== (member.bio ?? "").trim() ||
    JSON.stringify(creditsArr) !== JSON.stringify(member.credits ?? []);

  async function save() {
    if (!dirty) return;
    setSaving(true);
    try {
      await setProfile({ id: member._id, bio: bio.trim(), credits: creditsArr });
      toast.success(`${member.name}'s profile saved.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-graphite/50 bg-coal-2 p-3">
      <div className="flex items-center gap-2.5">
        {member.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={member.photoUrl}
            alt=""
            className="size-8 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-coal-3 text-steel">
            <UserRound className="size-4" />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate font-grotesk text-sm font-semibold text-bone">{member.name}</p>
          <p className="text-xs capitalize text-steel/70">{member.role.replace(/_/g, " ")}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Bio" hint="1-2 sentences, shown to clients">
          <Textarea
            placeholder="Grammy-nominated engineer with 12 years behind the SSL. Specializes in vocal-forward hip-hop and R&B."
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
          />
        </Field>
        <Field label="Notable credits" hint="One per line">
          <Textarea
            placeholder={"Drake - Certified Lover Boy\nSZA - SOS\nMetro Boomin"}
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
            rows={3}
          />
        </Field>
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={!dirty || saving}>
          <Save className="size-3.5" />
          {saving ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </div>
  );
}
