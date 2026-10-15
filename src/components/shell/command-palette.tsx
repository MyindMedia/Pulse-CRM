"use client";

import * as React from "react";
import dynamic from "next/dynamic";

/* The command palette host. It listens for Cmd/Ctrl+K and the `pulse:command`
   event from the very first frame, but the palette (cmdk, its dialog) and its
   roster and songs queries load the first time it opens, not on every cold
   load of every page. Once opened it stays mounted, so closing animates. */
const CommandPaletteDialog = dynamic(() => import("./command-palette-dialog"), { ssr: false });

/** Fire `pulse:command` from anywhere (e.g. the topbar) to open the palette. */
export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent("pulse:command"));
}

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setLoaded(true);
        setOpen((o) => !o);
      }
    };
    const onCmd = () => {
      setLoaded(true);
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pulse:command", onCmd);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pulse:command", onCmd);
    };
  }, []);

  return loaded ? <CommandPaletteDialog open={open} setOpen={setOpen} /> : null;
}
