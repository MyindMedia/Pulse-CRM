"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { featureForPath } from "@/lib/features";

/** Redirects to the dashboard if the current route's feature has been disabled
 *  for this sub-account by the agency. Hiding it from the nav isn't enough -
 *  this blocks direct-URL access too. Dashboard + Settings are never gated. */
export function FeatureGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const org = useQuery(api.orgs.current);
  const disabledKey = (org?.disabledFeatures ?? []).join(",");

  useEffect(() => {
    if (!org) return;
    const feature = featureForPath(pathname);
    if (feature && disabledKey.split(",").filter(Boolean).includes(feature)) {
      router.replace("/dashboard");
    }
  }, [pathname, disabledKey, org, router]);

  return null;
}
