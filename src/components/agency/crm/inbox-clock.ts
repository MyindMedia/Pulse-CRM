"use client";

import * as React from "react";

/* The current time for render, kept in state and refreshed on an interval, so a
   render stays pure (react-hooks/purity) while "Outcome not recorded", schedule
   checks and zone names still move with the clock. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
