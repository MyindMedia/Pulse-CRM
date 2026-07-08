"use client";

/**
 * Root-level last resort. Catches anything the (app) shell boundary and the
 * per-route error.tsx files miss, including throws from the root layout
 * itself. Must render its own <html>/<body> per the Next.js convention, and
 * uses no app components (they may be what crashed).
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isAuthError =
    /UNAUTHENTICATED|Sign in required|NO_WORKSPACE|NO_STUDIO_MEMBER|NO_AGENCY_MEMBER|isn't linked to a studio/i.test(
      error.message,
    );
  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          background: "#08080a",
          color: "#f6f6f5",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
            {isAuthError ? "Your session needs a refresh" : "Pulse hit a snag"}
          </h1>
          <p style={{ fontSize: 14, color: "#a3a3ad", marginBottom: 20 }}>
            {isAuthError
              ? "Sign in again and you'll be right back where you were."
              : "Reload to pick up where you left off."}
          </p>
          <button
            type="button"
            onClick={() => {
              window.location.href = isAuthError ? "/sign-in" : window.location.pathname;
            }}
            style={{
              background: "#fdb913",
              color: "#241900",
              border: "none",
              borderRadius: 11,
              padding: "10px 22px",
              fontSize: 14,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            {isAuthError ? "Sign in again" : "Reload"}
          </button>
        </div>
      </body>
    </html>
  );
}
