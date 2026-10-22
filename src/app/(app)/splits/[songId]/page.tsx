"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { SplitsTab } from "@/components/songs/splits-tab";

/** One split sheet, outside the Songs workspace, so Core can edit and send it. */
export default function SplitSheetPage({ params }: { params: Promise<{ songId: string }> }) {
  const { songId } = React.use(params);
  const sheets = useQuery(api.splitSheets.list, {});
  const row = sheets?.find((s) => s.songId === songId);
  return (
    <div className="space-y-6">
      <Link href="/splits" className="inline-flex min-h-11 items-center gap-1 text-sm text-steel hover:text-bone">
        <ChevronLeft className="size-4" /> Split sheets
      </Link>
      <PageHeader
        overline="Split sheet"
        title={row?.songTitle ?? "Split sheet"}
        description={row?.artistName ? `By ${row.artistName}` : undefined}
      />
      <SplitsTab songId={songId as Id<"songs">} />
    </div>
  );
}
