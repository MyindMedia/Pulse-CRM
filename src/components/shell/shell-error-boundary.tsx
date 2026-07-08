"use client";

import * as React from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Last line of defense for the app SHELL. Next's error.tsx cannot catch
 * throws from its own layout segment, and the shell chrome (sidebar, topbar,
 * banners, widgets) runs a dozen Convex queries whose render-time throws
 * used to white-screen every route. This class boundary catches them and
 * shows a recoverable panel instead.
 */
export class ShellErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[shell] boundary caught:", error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isAuthError =
      /UNAUTHENTICATED|Sign in required|NO_WORKSPACE|NO_STUDIO_MEMBER|NO_AGENCY_MEMBER|isn't linked to a studio/i.test(
        error.message,
      );

    return (
      <div className="grid min-h-dvh place-items-center bg-ink px-4">
        <div className="max-w-md space-y-5 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-chrome border border-graphite/60 bg-coal-2 text-warning">
            <ShieldAlert className="size-5" />
          </span>
          <div className="space-y-2">
            <h1 className="font-grotesk text-xl font-bold tracking-tight text-bone">
              {isAuthError ? "Your session needs a refresh" : "Pulse hit a snag"}
            </h1>
            <p className="text-sm text-steel">
              {isAuthError
                ? "Pulse could not authenticate this browser session. Sign in again and you'll be right back where you were."
                : "Something failed while loading the studio. Reload to pick up where you left off."}
            </p>
          </div>
          <div className="flex items-center justify-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                // Hard navigation on purpose: a fresh document re-runs the
                // auth handshake and clears wedged in-memory state.
                window.location.href = isAuthError ? "/sign-in" : window.location.pathname;
              }}
            >
              {isAuthError ? "Sign in again" : "Reload"}
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
