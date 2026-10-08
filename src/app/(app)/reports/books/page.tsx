"use client";

import Link from "next/link";
import { ArrowLeft } from "@untitledui/icons";
import { CapabilityGuard } from "@/components/shell/capability-guard";
import { BooksLive } from "@/components/books/books-live";

/** Books: the studio's double-entry books and the owner's statements, with
 *  reported and recomputed figures side by side. Money follows permission:
 *  only roles with insights.read may open it. */
export default function BooksPage() {
  return (
    <CapabilityGuard cap="insights.read">
      <div className="space-y-5">
        <Link
          href="/reports"
          className="books-no-print inline-flex items-center gap-1.5 text-sm text-steel hover:text-bone"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Reports
        </Link>
        <BooksLive />
      </div>
    </CapabilityGuard>
  );
}
