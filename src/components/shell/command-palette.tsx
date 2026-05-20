"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { NAV } from "@/lib/nav";
import { Music2, Users, ArrowRight, Plus } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

/** Fire `pulse:command` from anywhere (e.g. the topbar) to open the palette. */
export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent("pulse:command"));
}

const QUICK_ACTIONS = [
  { label: "New song", href: "/songs?new=1", icon: Plus },
  { label: "Add artist", href: "/roster?new=1", icon: Plus },
  { label: "Book a session", href: "/calendar?new=1", icon: Plus },
  { label: "Create invoice", href: "/payments?new=1", icon: Plus },
];

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const roster = useQuery(api.artists.roster) ?? [];
  const songs = useQuery(api.songs.picker, {}) ?? [];

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onCmd = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pulse:command", onCmd);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pulse:command", onCmd);
    };
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="anim-overlay fixed inset-0 z-50 bg-ink/80 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className="anim-pop fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl glass-liquid shadow-elev-4 text-bone"
          aria-label="Command palette"
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <Command loop className="[&_[cmdk-group-heading]]:overline [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
            <div className="border-b border-hairline px-3">
              <Command.Input
                autoFocus
                placeholder="Search songs, artists, or jump to a screen…"
                className="h-12 w-full bg-transparent text-sm text-bone placeholder:text-ash-dim outline-none"
              />
            </div>
            <Command.List className="max-h-[56vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-sm text-ash-dim">
                Nothing matches that.
              </Command.Empty>

              <Command.Group heading="Quick actions">
                {QUICK_ACTIONS.map((a) => (
                  <Item key={a.label} onSelect={() => go(a.href)}>
                    <a.icon className="size-4 text-gold" />
                    {a.label}
                  </Item>
                ))}
              </Command.Group>

              <Command.Group heading="Navigate">
                {NAV.map((n) => (
                  <Item key={n.href} value={`go ${n.label} ${n.blurb}`} onSelect={() => go(n.href)}>
                    <n.icon className="size-4 text-ash-dim" />
                    <span>{n.label}</span>
                    <span className="ml-auto truncate text-xs text-ash-dim">{n.blurb}</span>
                  </Item>
                ))}
              </Command.Group>

              {songs.length > 0 && (
                <Command.Group heading="Songs">
                  {songs.slice(0, 8).map((s) => (
                    <Item
                      key={s._id}
                      value={`song ${s.title}`}
                      onSelect={() => go(`/songs/${s._id}`)}
                    >
                      <Music2 className="size-4 text-ash-dim" />
                      <span>{s.title}</span>
                      <span className="ml-auto font-mono text-[0.625rem] uppercase text-ash-dim">
                        {s.stage}
                      </span>
                      <ArrowRight className="size-3.5 text-ash-dim" />
                    </Item>
                  ))}
                </Command.Group>
              )}

              {roster.length > 0 && (
                <Command.Group heading="Roster">
                  {roster.slice(0, 8).map((a) => (
                    <Item
                      key={a._id}
                      value={`artist ${a.name}`}
                      onSelect={() => go(`/roster/${a._id}`)}
                    >
                      <Users className="size-4 text-ash-dim" />
                      <span>{a.name}</span>
                      <span className="ml-auto font-mono text-[0.625rem] uppercase text-ash-dim">
                        {a.type}
                      </span>
                      <ArrowRight className="size-3.5 text-ash-dim" />
                    </Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Item({
  children,
  onSelect,
  value,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  value?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm text-bone outline-none data-[selected=true]:bg-coal-2"
    >
      {children}
    </Command.Item>
  );
}
