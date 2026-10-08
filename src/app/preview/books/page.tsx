"use client";

import * as React from "react";
import { notFound, useSearchParams } from "next/navigation";
import { BooksPreview } from "@/components/books/books-preview";

/* Books report preview: the anonymized July fixture through the real ledger
   engine. Development only. Production answers with a 404 so no fixture
   ships as a live page. Nothing here reads Convex or any customer data.
   ?accent=#rrggbb previews another studio accent. */
export default function BooksPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <React.Suspense fallback={null}>
        <AccentFromUrl />
      </React.Suspense>
    </main>
  );
}

function AccentFromUrl() {
  const raw = useSearchParams().get("accent");
  const accent = raw && /^#[0-9a-f]{6}$/i.test(raw) ? raw : undefined;
  return <BooksPreview accent={accent} />;
}
