"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

/**
 * Starts the beta year on the owner's first sign-in after signing.
 *
 * The licence is granted by the agency, but the year runs from the moment
 * the studio actually gets in. Anything else spends their licence on the
 * days between an agency deciding to let them in and the owner reading the
 * agreement.
 *
 * Renders nothing. Fires once per mount and is a no-op on the server for
 * every studio that is not a signed, unstarted beta - the mutation itself
 * makes that decision, because the client must never be trusted with when
 * somebody's free year began.
 */
export function BetaClockStarter() {
  const start = useMutation(api.betaClock.startIfNeeded);
  const fired = React.useRef(false);

  React.useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    // Best effort. A studio that cannot reach this must still get its app.
    void start({}).catch(() => undefined);
  }, [start]);

  return null;
}
