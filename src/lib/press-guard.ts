/* One request per control at a time, without `disabled` (V3-01).

   A button that sets `disabled` while its own request runs drops keyboard
   focus (to the dialog or the page), so the result is never announced and the
   next Space does nothing. These controls stay enabled and focusable; a
   repeat press while the request is in flight is refused here instead. The
   check and the mark happen in the same synchronous step, so two presses in
   one tick (before React re-renders) still start only one request.

   The caller keeps its own React state for what it draws (aria-busy, a
   spinner); this only decides whether a press runs. */

export type PressResult<T> = { ran: true; value: T } | { ran: false };

export function createPressGuard() {
  const inFlight = new Set<string>();
  return {
    /** This key's request is still running. */
    busy(key: string): boolean {
      return inFlight.has(key);
    },
    /** Any request is still running. */
    anyBusy(): boolean {
      return inFlight.size > 0;
    },
    /** Runs `fn` unless this key is already running. Errors pass through
     *  after the key is freed. */
    async run<T>(key: string, fn: () => Promise<T>): Promise<PressResult<T>> {
      if (inFlight.has(key)) return { ran: false };
      inFlight.add(key);
      try {
        return { ran: true, value: await fn() };
      } finally {
        inFlight.delete(key);
      }
    },
  };
}

export type PressGuard = ReturnType<typeof createPressGuard>;

/** After a request from a control that had focus: what to do about focus on
 *  this commit (V4-04).
 *  - "wait": the pressed control is still on the page, so focus is where it was.
 *  - "focus": the control is gone and focus fell to the page or the dialog
 *    container (Radix's focus trap puts it there), so move it into the card.
 *  - "drop": the window closed, or the person moved focus themselves. */
export function focusRescue(input: {
  pressedConnected: boolean;
  now: number;
  until: number;
  /** Where focus is now: nowhere or the page body, the dialog container, or
   *  some other element. */
  focusOn: "none" | "body" | "dialog" | "other";
}): "wait" | "focus" | "drop" {
  if (input.now > input.until) return "drop";
  if (input.pressedConnected) return "wait";
  return input.focusOn === "other" ? "drop" : "focus";
}
