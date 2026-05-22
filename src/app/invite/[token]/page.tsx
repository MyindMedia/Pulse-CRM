"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useAction } from "convex/react";
import { useSignIn } from "@clerk/nextjs";
import { api } from "@convex/_generated/api";
import { PulseLogo } from "@/components/brand/pulse-logo";

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();

  // useParams may return null during prerendering (Pages Router compat); guard it.
  const token = params?.token ?? "";

  // Convex: public query - no auth required
  const invite = useQuery(api.invites.lookupByToken, token ? { token } : "skip");
  const accept = useAction(api.invites.accept);

  // Clerk v7 Signals API: { signIn: SignInFutureResource, errors, fetchStatus }
  // No isLoaded / setActive - finalize() establishes the session.
  const { signIn } = useSignIn();

  // name is seeded from invite.ownerName when the invite loads, then becomes
  // freely editable. We track whether the user has edited so we never clobber
  // a typed value with a re-delivered Convex result.
  const suggestedName = invite?.state === "valid" ? (invite.ownerName ?? "") : "";
  const [nameOverride, setNameOverride] = React.useState<string | null>(null);
  const name = nameOverride ?? suggestedName;

  const [password, setPassword] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !signIn || invite?.state !== "valid") return;
    setErr("");
    setBusy(true);
    try {
      const res = await accept({ token, name: name.trim(), password });
      if (!res.ok) {
        if (res.reason === "exists") {
          setErr("You already have a Pulse account. Please sign in.");
          return;
        }
        setErr("This invitation could not be completed. Ask your admin to resend it.");
        return;
      }
      // Establish a browser session using the Clerk v7 Signals password flow.
      await signIn.password({ identifier: res.email, password });
      if (signIn.status === "complete") {
        // finalize() sets the active session; navigate callback receives a
        // decorated URL for Safari ITP cookie refresh.
        await signIn.finalize({
          navigate: ({ decorateUrl }) => {
            router.push(decorateUrl("/dashboard"));
          },
        });
      } else {
        // Unexpected MFA / second-factor step; fall back to sign-in page.
        router.push("/sign-in");
      }
    } catch {
      setErr("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative grid min-h-dvh place-items-center bg-ink p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(60% 40% at 50% 28%, rgba(253,185,19,0.10), transparent 70%)",
        }}
      />
      <div className="relative w-full max-w-sm text-center">
        <PulseLogo size="md" asLink={false} />

        {token !== "" && invite === undefined && (
          <p className="mt-8 text-sm text-ash">Loading your invitation&hellip;</p>
        )}

        {(token === "" || (invite && invite.state !== "valid")) && (
          <div className="mt-8 space-y-3">
            <h1 className="font-display text-2xl font-bold text-bone">
              {invite?.state === "accepted"
                ? "Already claimed"
                : invite?.state === "expired"
                  ? "Invitation expired"
                  : "Invalid invitation"}
            </h1>
            <p className="text-sm text-ash">
              {invite?.state === "accepted"
                ? "This invitation has already been used. Sign in to continue."
                : "This link is no longer valid. Ask your administrator to resend your invite."}
            </p>
            <Link
              href="/sign-in"
              className="inline-block text-sm font-medium text-gold hover:underline"
            >
              Go to sign in
            </Link>
          </div>
        )}

        {invite?.state === "valid" && (
          <form onSubmit={submit} className="mt-6 text-left">
            <p className="mb-1 text-center text-sm text-ash">
              Joining <b className="text-bone">{invite.studioName}</b> as Owner
            </p>
            <h1 className="mb-1 text-center font-display text-2xl font-bold text-bone">
              Create your account
            </h1>
            <p className="mb-6 text-center text-sm text-ash">
              You&apos;ve been invited to the Pulse beta. Set a password to finish.
            </p>

            <label className="mb-1.5 block text-xs font-semibold text-ash">Email</label>
            <div className="mb-3.5 flex items-center justify-between rounded-[10px] border border-hairline-2 bg-[#0e0e12] px-3 py-3 text-sm text-ash-dim">
              <span>{invite.email}</span>
              <span className="text-xs text-gold">locked</span>
            </div>

            <label htmlFor="invite-name" className="mb-1.5 block text-xs font-semibold text-ash">Full name</label>
            <input
              id="invite-name"
              value={name}
              onChange={(e) => setNameOverride(e.target.value)}
              placeholder="Jordan Rivera"
              className="mb-3.5 w-full rounded-[10px] border border-hairline-2 bg-[#0a0a0d] px-3 py-3 text-sm text-bone outline-none focus:border-gold"
            />

            <label htmlFor="invite-password" className="mb-1.5 block text-xs font-semibold text-ash">Password</label>
            <div className="mb-1 flex items-center rounded-[10px] border border-hairline-2 bg-[#0a0a0d] focus-within:border-gold">
              <input
                id="invite-password"
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full bg-transparent px-3 py-3 text-sm text-bone outline-none"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? "Hide password" : "Show password"}
                aria-controls="invite-password"
                className="px-3 text-ash-dim"
              >
                {show ? "hide" : "show"}
              </button>
            </div>

            {err && <p className="mt-3 text-sm text-critical">{err}</p>}

            <button
              type="submit"
              disabled={busy || password.length < 8 || name.trim().length < 2}
              className="mt-4 w-full rounded-[11px] bg-gold py-3.5 text-sm font-extrabold text-gold-ink disabled:opacity-50"
            >
              {busy ? "Creating account..." : "Create account & enter Pulse"}
            </button>

            <p className="mt-5 text-center text-[11px] leading-relaxed text-ash-dim">
              By continuing you agree to the{" "}
              <Link href="/legal" className="text-ash">
                Terms
              </Link>{" "}
              &amp;{" "}
              <Link href="/legal" className="text-ash">
                Privacy Policy
              </Link>
              .
            </p>
            <p className="mt-4 text-center text-[10.5px] tracking-wide text-ash-dim">
              Secured by Pulse &middot; powered by Clerk
            </p>
            <div id="clerk-captcha" />
          </form>
        )}
      </div>
    </div>
  );
}
