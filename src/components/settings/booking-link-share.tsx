"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, Link2, Send, ShieldCheck } from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** The studio's own, unique, live booking link with one-tap share actions.
 *  Every sub-account gets its own slug; this surfaces it so the owner can
 *  copy it, open it, or send it straight to a client. */
export function BookingLinkShare({ slug, studioName }: { slug: string; studioName: string }) {
  const [origin, setOrigin] = React.useState("");
  const [copied, setCopied] = React.useState(false);

  // Absolute URL is only available client-side.
  React.useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const path = `/book/${slug}`;
  const url = origin ? `${origin}${path}` : path;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Booking link copied.");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy. Long-press the link to copy it.");
    }
  }

  const mailto = `mailto:?subject=${encodeURIComponent(`Book a session with ${studioName}`)}&body=${encodeURIComponent(
    `Hi,\n\nYou can see our rooms, live availability and pricing and book a session here:\n${url}\n\nThanks,\n${studioName}`,
  )}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="size-4 text-gold" />
          Your booking link
        </CardTitle>
        <CardDescription>
          This link is live and unique to {studioName}. Share it anywhere &mdash; clients see your
          rooms, real-time availability, pricing and any memberships, and book directly.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-coal-2 px-3 py-2.5">
          <code className="min-w-0 flex-1 truncate font-mono text-sm text-bone">{url}</code>
          <Button size="sm" variant={copied ? "secondary" : "primary"} onClick={() => void copy()}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={path} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" />
              Open
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={mailto}>
              <Send className="size-4" />
              Send to a client
            </a>
          </Button>
        </div>

        <div className="flex items-start gap-2 rounded-md border border-hairline bg-coal-2 px-3 py-2.5">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-positive" />
          <p className="text-[0.6875rem] text-ash-dim">
            Not a demo &mdash; this is your studio&apos;s own page. Renaming your studio can change the
            slug, so re-copy the link if you do.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
