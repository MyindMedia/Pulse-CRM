"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { PulseLoader } from "@/components/brand/pulse-loader";
import { PulseLogo } from "@/components/brand/pulse-logo";

/*
 * "Stop these emails" from a trial reminder (/unsubscribe/<token>). One
 * visit is enough: no confirm button, because a second step is how
 * unsubscribe links fail the people who use them.
 */

export default function UnsubscribePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const unsubscribe = useMutation(api.signupLeads.unsubscribe);
  const [state, setState] = React.useState<"loading" | "done" | "not_found">("loading");
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current || !token) return;
    started.current = true;
    unsubscribe({ token })
      .then((r) => setState(r.ok ? "done" : "not_found"))
      .catch(() => setState("not_found"));
  }, [unsubscribe, token]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-ink px-4 py-10">
      <PulseLogo size="sm" href="/" />
      {state === "loading" ? (
        <PulseLoader variant="compact" message="Updating" />
      ) : (
        <div className="w-full max-w-md rounded-chrome border border-graphite/50 bg-coal/60 p-8 text-center shadow-elev-2">
          <h1 className="font-grotesk text-lg font-semibold text-bone">
            {state === "done" ? "You're unsubscribed" : "This link is no longer valid"}
          </h1>
          <p className="mt-2 text-sm text-steel">
            {state === "done"
              ? "We won't send you any more trial reminders. If you start a trial later, you can still finish it any time."
              : "If you keep getting reminders, reply to one and we'll stop them by hand."}
          </p>
          <Link href="/" className="mt-6 inline-block text-sm text-mist underline underline-offset-4 hover:text-gold">
            Back to Pulse
          </Link>
        </div>
      )}
    </div>
  );
}
