"use client";

import * as React from "react";

type Props = {
  overrides: string[];
  onChange: (next: string[]) => void;
};

/**
 * Override tokens are "+cap" or "-cap" strings; the engine applies them
 * on top of the role default. UI is a simple textarea — power-user.
 */
export function CapabilityOverrides({ overrides, onChange }: Props) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(overrides.join("\n"));
  React.useEffect(() => {
    setText(overrides.join("\n"));
  }, [overrides]);
  function commit() {
    const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
    onChange(lines);
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-white/60 underline underline-offset-2"
      >
        Customize permissions ({overrides.length} overrides)
      </button>
    );
  }
  return (
    <div className="space-y-1 rounded border border-white/15 bg-black/30 p-3">
      <p className="text-xs text-white/60">
        One token per line. Use <code>+cap.name</code> to add or <code>-cap.name</code> to remove.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        rows={4}
        className="w-full rounded border border-white/15 bg-black/40 p-2 font-mono text-xs"
        placeholder="+finance.read&#10;-deliverables.approve"
      />
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-white/40 underline underline-offset-2"
      >
        Collapse
      </button>
    </div>
  );
}
