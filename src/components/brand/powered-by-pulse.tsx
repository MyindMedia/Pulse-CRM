import { cn } from "@/lib/utils";

/**
 * The "Powered by Pulse" lockup that sits beneath a white-label studio's own
 * logo.
 *
 * This is a condition of the Label tier, not a feature flag: there is no prop,
 * setting, or price that removes it. The server mirrors that guarantee -
 * theme.get always returns poweredByPulse: true. If you are here to add an
 * opt-out, the answer is no.
 */
export function PoweredByPulse({
  className,
  size = "sm",
  href = "https://studiopulse.tech",
}: {
  className?: string;
  size?: "xs" | "sm";
  href?: string | null;
}) {
  const label = (
    <span
      className={cn(
        "font-meta uppercase tracking-[0.12em] text-steel/60",
        size === "xs" ? "text-[0.5rem]" : "text-[0.5625rem]",
      )}
    >
      Powered by{" "}
      <span className="text-gold/70">Pulse</span>
    </span>
  );

  if (!href) return <div className={cn("select-none", className)}>{label}</div>;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      // Every white-labeled workspace is a billboard. The link is how the
      // tier pays for itself in referrals.
      className={cn(
        "block select-none transition-opacity hover:opacity-100 opacity-80",
        className,
      )}
    >
      {label}
    </a>
  );
}
