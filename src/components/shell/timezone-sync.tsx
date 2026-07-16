"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

/* Sets the studio's timezone from the device's LOCATION the first time
   anyone with settings access loads the app - staff devices are at the
   studio, so their zone IS the studio's zone. Runs only while the org has
   no timezone; a cap denial (e.g. a plain staffer) fails silently and the
   next privileged load sets it. Manual override lives in Settings >
   Workspace. */
export function TimezoneSync() {
  const org = useQuery(api.orgs.current);
  const update = useMutation(api.orgs.update);
  const attempted = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!org || org.timezone) return;
    if (attempted.current === org.orgId) return;
    attempted.current = org.orgId;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;
    update({ timezone: tz }).catch(() => {
      /* viewer lacks settings access - a privileged load will set it */
    });
  }, [org, update]);

  return null;
}
