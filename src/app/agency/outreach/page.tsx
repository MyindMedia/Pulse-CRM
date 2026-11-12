"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/* Outreach moved into the CRM as its Prospects tab (owner request 2026-11-11).
   The route stays so old bookmarks and links in emails or notifications still
   land somewhere. A server redirect cannot carry the #prospects hash, so the
   browser replaces the URL itself; the link is the fallback without JavaScript. */

const PROSPECTS_HREF = "/agency/crm#prospects";

export default function OutreachMovedPage() {
  const router = useRouter();
  React.useEffect(() => {
    router.replace(PROSPECTS_HREF);
  }, [router]);
  return (
    <p className="text-sm text-steel">
      <Link href={PROSPECTS_HREF} className="text-gold-bright underline underline-offset-2 hover:text-bone">
        Outreach moved into the CRM. Open Prospects.
      </Link>
    </p>
  );
}
