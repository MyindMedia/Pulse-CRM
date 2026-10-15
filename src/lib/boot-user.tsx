"use client";

import * as React from "react";

/* Who is signed in, as the server verified it for this request (null when no
   one is). The root layout provides it on every page; the app shell's boot
   cache (src/lib/boot-snapshot.tsx) reads it. Its own module so the public
   pages, which only pass it through, load nothing else of the boot cache. */
const BootUserContext = React.createContext<string | null>(null);

export function BootUserProvider({ userId, children }: { userId: string | null; children: React.ReactNode }) {
  return <BootUserContext.Provider value={userId}>{children}</BootUserContext.Provider>;
}

export function useBootUserId(): string | null {
  return React.useContext(BootUserContext);
}
