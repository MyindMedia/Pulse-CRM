"use client";

import * as React from "react";

/* Where a page's title and actions land in the hardware shell.
 *
 * The kit puts the page title, its caption and the page's one primary key in
 * the top bar chassis, not in a header inside the page. PageHeader portals
 * its title into `title` and its actions into `actions`, so all 31 pages move
 * without each one changing. Outside the shell (the agency console, tests)
 * there is no provider and PageHeader renders inline as it always did. */

type Slots = { title: HTMLElement | null; actions: HTMLElement | null };
type SetSlot = (key: keyof Slots, el: HTMLElement | null) => void;

/* undefined = no shell here; render inline. */
const SlotsContext = React.createContext<Slots | undefined>(undefined);
const SetSlotContext = React.createContext<SetSlot | null>(null);

export function PageHeaderSlotProvider({ children }: { children: React.ReactNode }) {
  const [slots, setSlots] = React.useState<Slots>({ title: null, actions: null });
  const setSlot = React.useCallback<SetSlot>((key, el) => {
    setSlots((prev) => (prev[key] === el ? prev : { ...prev, [key]: el }));
  }, []);
  return (
    <SetSlotContext.Provider value={setSlot}>
      <SlotsContext.Provider value={slots}>{children}</SlotsContext.Provider>
    </SetSlotContext.Provider>
  );
}

/** The top bar's slot elements, or undefined outside the shell. */
export function usePageHeaderSlots(): Slots | undefined {
  return React.useContext(SlotsContext);
}

/** A callback ref that registers one slot element with the provider. */
export function useSlotRef(key: keyof Slots): (el: HTMLElement | null) => void {
  const setSlot = React.useContext(SetSlotContext);
  return React.useCallback((el: HTMLElement | null) => setSlot?.(key, el), [setSlot, key]);
}

/** Yellow corner brackets for a chassis (kit section 3). The chassis must be
 *  positioned; .pl-card is. */
export function Brackets() {
  return <span className="pl-brackets" aria-hidden />;
}
