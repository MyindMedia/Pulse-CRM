"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/* Email moved into the CRM as its Email tab (owner request 2026-11-11). The
   route stays so old bookmarks, docs and links still land somewhere. A server
   redirect cannot carry the #email hash, so the browser replaces the URL itself;
   the link is the fallback without JavaScript. The inbox reads nothing from the
   URL (mailbox and thread are plain state), so there is nothing to carry over. */

const EMAIL_HREF = "/agency/crm#email";

export default function EmailMovedPage() {
  const router = useRouter();
  React.useEffect(() => {
    router.replace(EMAIL_HREF);
  }, [router]);
  return (
    <p className="text-sm text-steel">
      <Link href={EMAIL_HREF} className="text-gold-bright underline underline-offset-2 hover:text-bone">
        Email moved into the CRM. Open Email.
      </Link>
    </p>
  );
}
