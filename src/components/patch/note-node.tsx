"use client";

import * as React from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

/* ============================================================
   A sticky note on the patch canvas.

   Deliberately the dumbest node on the board: no ports, no
   handles, no inventory. It exists because half of what an
   engineer needs to say about a rig is not a connection -
   "console channel 7 crackles", "leave this patched for
   Thursday" - and without somewhere to write it, that goes on
   actual tape and is lost.
   ============================================================ */

export const NOTE_COLORS = [
  { key: "amber", label: "Amber", bg: "#3a2e12", border: "#7a5f1c", text: "#f6dfa4" },
  { key: "green", label: "Green", bg: "#15301f", border: "#2f6b45", text: "#b8ecc9" },
  { key: "blue", label: "Blue", bg: "#152535", border: "#2f5d8a", text: "#bfdcf6" },
  { key: "red", label: "Red", bg: "#341a1a", border: "#7d3434", text: "#f4c3c3" },
  { key: "violet", label: "Violet", bg: "#291d38", border: "#5b3f80", text: "#dcc9f6" },
  { key: "slate", label: "Slate", bg: "#1e2026", border: "#3d4149", text: "#d3d6dc" },
] as const;

export function noteColor(key: string) {
  return NOTE_COLORS.find((c) => c.key === key) ?? NOTE_COLORS[0];
}

export const NOTE_DEFAULT_SIZE = { width: 200, height: 132 };

export type NoteNodeData = {
  text: string;
  color: string;
  width: number;
  height: number;
  canEdit: boolean;
  onChangeText: (text: string) => void;
};

export const NoteNode = React.memo(function NoteNode({
  data,
  selected,
}: NodeProps & { data: NoteNodeData }) {
  const palette = noteColor(data.color);
  const [draft, setDraft] = React.useState(data.text);
  const [editing, setEditing] = React.useState(false);

  // Re-seed when the stored text changes underneath, but never while the
  // caret is in the box - that would eat what is being typed.
  const [seeded, setSeeded] = React.useState(data.text);
  if (!editing && seeded !== data.text) {
    setSeeded(data.text);
    setDraft(data.text);
  }

  // autoFocus does not survive React Flow re-rendering the node around the
  // textarea, and a note you have to click twice to type in reads as broken.
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [editing]);

  function commit() {
    setEditing(false);
    if (draft !== data.text) data.onChangeText(draft);
  }

  return (
    <>
      <NodeResizer
        isVisible={!!selected && data.canEdit}
        minWidth={140}
        minHeight={90}
        lineClassName="!border-transparent"
        handleClassName="!size-2 !rounded-[2px] !border !border-white/40 !bg-white/70"
      />
      <div
        // `nopan` keeps a drag inside the note from panning the canvas, and
        // swallowing the double-click stops React Flow zooming the whole board
        // when someone is only trying to type on a sticky.
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (data.canEdit) setEditing(true);
        }}
        className={cn(
          "nopan flex h-full w-full flex-col rounded-[10px] border p-2 shadow-elev-2 transition-shadow",
          selected && "shadow-elev-3 ring-1 ring-gold/60",
        )}
        style={{
          background: palette.bg,
          borderColor: palette.border,
          color: palette.text,
          width: data.width,
          height: data.height,
        }}
      >
        {editing ? (
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              // Escape abandons the edit; the canvas must not also read it as
              // "clear the selection" while a note has the caret.
              event.stopPropagation();
              if (event.key === "Escape") {
                setDraft(data.text);
                setEditing(false);
              }
            }}
            placeholder="Type a note"
            className="nodrag nowheel h-full w-full resize-none bg-transparent text-[11px] leading-snug outline-none placeholder:opacity-45"
            style={{ color: palette.text }}
          />
        ) : (
          <button
            type="button"
            disabled={!data.canEdit}
            className="h-full w-full cursor-text text-left text-[11px] leading-snug whitespace-pre-wrap break-words disabled:cursor-default"
          >
            {data.text || (
              <span className="opacity-45">
                {data.canEdit ? "Double-click to write" : "Empty note"}
              </span>
            )}
          </button>
        )}
      </div>
    </>
  );
});
