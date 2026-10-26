"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";

/* Entry point to Unfinished sign-ups: people who started a trial on the
   pricing page and stopped at checkout. The count is the open ones. */

export function SignupLeadsButton({ className }: { className?: string }) {
  const data = useQuery(api.signupLeads.list);
  const open = data?.counts.open ?? 0;

  return (
    <Link
      href="/agency/signups"
      className={cn(
        "group inline-flex items-center gap-2 rounded-full border border-graphite/60 px-3 py-1.5",
        "font-meta text-[0.65rem] uppercase tracking-[0.06em] text-steel transition-colors",
        "hover:border-gold hover:text-bone",
        className,
      )}
    >
      <UserPlus className="size-3.5 text-steel/70 transition-colors group-hover:text-gold" />
      Unfinished sign-ups
      {open > 0 && <span className="font-mono text-[0.65rem] tabular-nums text-gold">{open}</span>}
    </Link>
  );
}
