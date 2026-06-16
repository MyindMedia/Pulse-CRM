"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { CircleCheck, DoorOpen, PlugZap, Plus, Users, UserPlus, Wrench } from "lucide-react";
import { PageHeader, Section } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/shell/app-motion";
import { useCapabilities } from "@/lib/use-capabilities";
import { StatTile } from "@/components/ui/stat-tile";
import { Skeleton, SkeletonCards } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import {
  RoomCard,
  type RoomEquipment,
  type RoomItem,
} from "@/components/studio/room-card";
import { MemberCard, type TeamMember } from "@/components/studio/member-card";
import { AddRoomDialog } from "@/components/studio/add-room-dialog";
import { MemberDialog } from "@/components/studio/member-dialog";

/**
 * One room card backed by a live `api.rooms.get` query so the card can show a
 * preview of the room's installed gear. `useQuery` must run at the top level of
 * a component, so each room gets its own card component.
 */
function StudioRoomCard({ room }: { room: RoomItem }) {
  const detail = useQuery(api.rooms.get, { id: room._id });
  const equipment: RoomEquipment[] | undefined = detail
    ? detail.equipment.map((e) => ({
        _id: e._id,
        name: e.name,
        category: e.category,
        currentValueCents: e.currentValueCents,
      }))
    : undefined;
  return <RoomCard room={room} equipment={equipment} />;
}

export default function StudioPage() {
  const rooms = useQuery(api.rooms.list) as RoomItem[] | undefined;
  const members = useQuery(api.members.list) as TeamMember[] | undefined;
  const { can } = useCapabilities();

  const [addRoomOpen, setAddRoomOpen] = React.useState(false);
  const [addMemberOpen, setAddMemberOpen] = React.useState(false);

  // Headline counts off the live room list.
  const counts = React.useMemo(() => {
    const c = { available: 0, in_use: 0, maintenance: 0, retired: 0 };
    for (const r of rooms ?? []) {
      if (r.status in c) c[r.status as keyof typeof c] += 1;
    }
    return c;
  }, [rooms]);

  return (
    <div className="space-y-8">
      <PageHeader
        overline="Operations"
        title="Studio"
        description="Every room and the people who run them - the physical backbone behind the catalog. Gear lives in Inventory."
        actions={
          <>
            {can("members.invite") && (
              <Button variant="outline" onClick={() => setAddMemberOpen(true)}>
                <UserPlus className="size-4" />
                Add team member
              </Button>
            )}
            {can("rooms.edit") && (
              <Button onClick={() => setAddRoomOpen(true)}>
                <Plus className="size-4" />
                Add room
              </Button>
            )}
          </>
        }
      />

      {/* Stat row */}
      {rooms === undefined || members === undefined ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <div className="rise-stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Rooms available"
            value={<CountUp to={counts.available} />}
            icon={CircleCheck}
            accent
            hint="ready to book"
          />
          <StatTile
            label="In use"
            value={<CountUp to={counts.in_use} />}
            icon={PlugZap}
            hint="active right now"
          />
          <StatTile
            label="In maintenance"
            value={<CountUp to={counts.maintenance} />}
            icon={Wrench}
            hint="off the floor"
          />
          <StatTile
            label="Team size"
            value={<CountUp to={members.length} />}
            icon={Users}
            hint="studio staff"
          />
        </div>
      )}

      {/* Studios */}
      <Section
        title="Studios"
        trailing={
          rooms !== undefined && rooms.length > 0 ? (
            <span className="font-meta text-[0.6875rem] uppercase tracking-wide text-steel/70">
              {rooms.length} {rooms.length === 1 ? "room" : "rooms"}
            </span>
          ) : undefined
        }
      >
        {rooms === undefined ? (
          <SkeletonCards cards={6} />
        ) : rooms.length === 0 ? (
          <EmptyState
            icon={DoorOpen}
            title="No rooms yet"
            description="Add the studio's bookable spaces so sessions can run against real rooms. Install gear into them from the Inventory page."
            action={
              can("rooms.edit") ? (
                <Button onClick={() => setAddRoomOpen(true)}>
                  <Plus className="size-4" />
                  Add room
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rooms.map((room) => (
              <StudioRoomCard key={room._id} room={room} />
            ))}
          </div>
        )}
      </Section>

      {/* The team */}
      <Section
        title="The team"
        trailing={
          members !== undefined && members.length > 0 ? (
            <span className="font-meta text-[0.6875rem] uppercase tracking-wide text-steel/70">
              {members.length} {members.length === 1 ? "member" : "members"}
            </span>
          ) : undefined
        }
      >
        {members === undefined ? (
          <SkeletonCards cards={4} />
        ) : members.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No team members yet"
            description="Add the engineers, managers and owners who run the studio. Their role sets what they can reach."
            action={
              can("members.invite") ? (
                <Button onClick={() => setAddMemberOpen(true)}>
                  <UserPlus className="size-4" />
                  Add team member
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {members.map((member) => (
              <MemberCard key={member._id} member={member} />
            ))}
          </div>
        )}
      </Section>

      <AddRoomDialog open={addRoomOpen} onOpenChange={setAddRoomOpen} />
      <MemberDialog open={addMemberOpen} onOpenChange={setAddMemberOpen} />
    </div>
  );
}
