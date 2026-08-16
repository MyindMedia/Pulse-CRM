"use client";

import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

/**
 * An icon-only button that always says what it does on hover.
 *
 * A control whose meaning is carried entirely by a glyph is a control the
 * user has to guess at, so the label is required rather than optional. It
 * doubles as the accessible name, which means there is only one string to
 * keep honest instead of two that drift apart.
 *
 * The button is wrapped in a span because a disabled button emits no
 * pointer events, and a disabled control is exactly when someone most
 * wants to know what it would have done.
 */
export function IconButton({
  label,
  hint,
  shortcut,
  side = "top",
  children,
  ...props
}: Omit<ButtonProps, "aria-label"> & {
  label: string;
  hint?: React.ReactNode;
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <Tooltip label={label} hint={hint} shortcut={shortcut} side={side}>
      <span className="inline-flex">
        <Button aria-label={label} {...props}>
          {children}
        </Button>
      </span>
    </Tooltip>
  );
}
