import * as React from "react";

/* Tiny renderer for the markdown subset the Pulse Agent emits in artifacts:
   #/##/### headings, "- " bullet lists, blank-line paragraphs and inline
   **bold**. Dependency-free on purpose - agent output is trusted org data,
   but we still render text nodes (never HTML injection). */

function inline(text: string, keyBase: string): React.ReactNode[] {
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={`${keyBase}-${i}`} className="font-semibold text-bone">
        {part}
      </strong>
    ) : (
      <React.Fragment key={`${keyBase}-${i}`}>{part}</React.Fragment>
    ),
  );
}

export function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];

  const flushList = (key: string) => {
    if (list.length === 0) return;
    const items = [...list];
    list = [];
    blocks.push(
      <ul key={key} className="space-y-1 pl-4">
        {items.map((item, i) => (
          <li key={i} className="list-disc text-xs leading-relaxed text-steel marker:text-gold/70">
            {inline(item, `${key}-${i}`)}
          </li>
        ))}
      </ul>,
    );
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const key = `b${idx}`;
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1]);
      return;
    }
    flushList(`${key}-ul`);
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(
        <p
          key={key}
          className={
            level === 1
              ? "font-grotesk text-sm font-bold text-bone"
              : "pt-1 font-grotesk text-xs font-semibold uppercase tracking-wide text-gold/90"
          }
        >
          {inline(heading[2], key)}
        </p>,
      );
      return;
    }
    if (line.trim() === "") return;
    blocks.push(
      <p key={key} className="text-xs leading-relaxed text-steel">
        {inline(line, key)}
      </p>,
    );
  });
  flushList("tail-ul");

  return <div className="space-y-2">{blocks}</div>;
}
