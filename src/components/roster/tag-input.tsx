"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/field";
import { cn, tintFromString } from "@/lib/utils";

/**
 * Free-form tag/chip input - type a value, press Enter or comma to commit.
 * Backspace on an empty field removes the last chip. Fully controlled.
 */
export function TagInput({
  value,
  onChange,
  placeholder = "Add and press Enter",
  className,
  id,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}) {
  const [draft, setDraft] = React.useState("");

  function commit(raw: string) {
    const cleaned = raw.trim().replace(/,+$/, "").trim();
    if (!cleaned) return;
    if (value.some((v) => v.toLowerCase() === cleaned.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, cleaned]);
    setDraft("");
  }

  function remove(tag: string) {
    onChange(value.filter((v) => v !== tag));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <Input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => {
            const tint = tintFromString(tag);
            return (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-sm border border-graphite/60 bg-coal-2 py-0.5 pl-2 pr-1 text-[0.6875rem] font-medium text-bone"
              >
                <span className="size-1.5 rounded-full" style={{ backgroundColor: tint }} />
                {tag}
                <button
                  type="button"
                  onClick={() => remove(tag)}
                  className="grid size-4 place-items-center rounded-sm text-steel/70 transition-colors hover:bg-coal-3 hover:text-bone"
                  aria-label={`Remove ${tag}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
