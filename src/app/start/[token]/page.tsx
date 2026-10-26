"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { PulseLoader } from "@/components/brand/pulse-loader";
import { PulseLogo } from "@/components/brand/pulse-logo";

/*
 * "Finish setting up" link from a trial reminder (/start/<token>). Opens a
 * fresh Stripe Checkout for the plan the person picked, with their email
 * filled in, so the link still works after Stripe's own session has expired.
 */

type State = "loading" | "converted" | "not_found" | "error";

export default function ResumeSignupPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const resume = useAction(api.signupLeads.resume);
  const [state, setState] = React.useState<State>("loading");
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current || !token) return;
    started.current = true;
    resume({ token })
      .then((r) => {
        if (r.ok) window.location.href = r.checkoutUrl;
        else setState(r.reason);
      })
      .catch(() => setState("error"));
  }, [resume, token]);

  const message: Record<Exclude<State, "loading">, { title: string; body: string }> = {
    converted: {
      title: "You're already set up",
      body: "This trial has already started. Sign in to open your studio.",
    },
    not_found: {
      title: "This link is no longer valid",
      body: "Start again from the pricing page and it only takes a minute.",
    },
    error: {
      title: "Checkout didn't open",
      body: "Something went wrong on our side. Try the link again, or start from the pricing page.",
    },
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-ink px-4 py-10">
      <PulseLogo size="sm" href="/" />
      {state === "loading" ? (
        <PulseLoader variant="compact" message="Opening checkout" />
      ) : (
        <div className="w-full max-w-md rounded-chrome border border-graphite/50 bg-coal/60 p-8 text-center shadow-elev-2">
          <h1 className="font-grotesk text-lg font-semibold text-bone">{message[state].title}</h1>
          <p className="mt-2 text-sm text-steel">{message[state].body}</p>
          <Link
            href={state === "converted" ? "/sign-in" : "/pricing"}
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-chrome bg-gold px-5 font-grotesk text-sm font-semibold text-gold-ink hover:bg-gold-bright"
          >
            {state === "converted" ? "Sign in" : "See plans"}
          </Link>
        </div>
      )}
    </div>
  );
}
