import { tintFromString } from "@/lib/utils";

/** Compact, deterministic-tinted chips for a genre or tag list. */
export function GenreChips({
  items,
  max = 3,
  emptyLabel = "—",
}: {
  items: string[];
  max?: number;
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return <span className="text-sm text-ash-dim">{emptyLabel}</span>;
  }
  const shown = items.slice(0, max);
  const extra = items.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((item) => {
        const tint = tintFromString(item);
        return (
          <span
            key={item}
            className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[0.625rem] font-medium"
            style={{
              borderColor: `${tint}44`,
              backgroundColor: `${tint}14`,
              color: tint,
            }}
          >
            {item}
          </span>
        );
      })}
      {extra > 0 && (
        <span className="font-mono text-[0.625rem] text-ash-dim">+{extra}</span>
      )}
    </div>
  );
}
