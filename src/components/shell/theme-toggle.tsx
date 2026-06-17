"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/use-theme";
import { cn } from "@/lib/utils";

/** Sun/moon theme toggle. `variant="nav"` is the bare icon button for the
    marketing nav; `variant="menu"` is a full-width row for the profile menu. */
export function ThemeToggle({
  variant = "nav",
  className,
}: {
  variant?: "nav" | "menu";
  className?: string;
}) {
  const { theme, toggle } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // Avoid a hydration mismatch: render a stable icon until mounted.
  const isLight = mounted && theme === "light";
  const Icon = isLight ? Moon : Sun;
  const label = isLight ? "Switch to dark mode" : "Switch to light mode";

  if (variant === "menu") {
    return (
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-bone transition-colors hover:bg-coal-2",
          className,
        )}
      >
        <Icon className="size-4 text-steel" />
        {isLight ? "Dark mode" : "Light mode"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-9 place-items-center rounded-chrome border border-graphite/60 text-steel transition-colors hover:border-gold-dim hover:text-bone",
        className,
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}
