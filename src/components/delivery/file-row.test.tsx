// @vitest-environment node
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileRow, type DeliveryFile } from "./file-row";

/* V5-01: when a row stacks, the icon tile, Play and Download are the direct
   children of ONE flex-wrap container, below the name. These tests read the
   rendered markup as a tree, so the structure is checked, not just a class. */

type Node = { tag: string; cls: string; children: Node[]; text: string };

function parse(html: string): Node {
  const root: Node = { tag: "#root", cls: "", children: [], text: "" };
  const stack: Node[] = [root];
  const token = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(html))) {
    if (m[5] !== undefined) {
      stack[stack.length - 1].text += m[5];
      continue;
    }
    const [, closing, tag, attrs, selfClose] = m;
    if (closing) {
      // Close the nearest open element with this tag, never the root.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const node: Node = { tag, cls, children: [], text: "" };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

function find(node: Node, pred: (n: Node) => boolean): Node | undefined {
  if (pred(node)) return node;
  for (const c of node.children) {
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return undefined;
}

function render(over: Partial<React.ComponentProps<typeof FileRow>> = {}) {
  const file: DeliveryFile = { versionId: "v1", name: "Mix Final.wav", size: 2048, mimeType: "audio/wav" };
  const html = renderToStaticMarkup(
    <FileRow
      file={file}
      locked={false}
      playing={false}
      progress={null}
      playBusy={false}
      downloadBusy={false}
      message={null}
      onPlay={() => {}}
      onDownload={() => {}}
      {...over}
    />,
  );
  return parse(html);
}

const row = (root: Node) => find(root, (n) => n.tag === "li")!.children[0];

describe("FileRow audio row structure (V5-01)", () => {
  it("the icon tile, the name, Play and Download are direct children of one row container", () => {
    const container = row(render());
    expect(container.cls).toContain("flex-wrap");
    expect(container.children.map((c) => c.tag)).toEqual(["span", "div", "button", "button"]);
  });

  it("Play and Download sit directly in the row, with no wrapper box around them", () => {
    const container = row(render());
    const buttons = container.children.filter((c) => c.tag === "button");
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b.cls).toContain("size-11");
    expect(find(container, (n) => n.cls.includes("ml-auto"))).toBeUndefined();
  });

  it("the locked row keeps one control, the lock mark, directly in the row", () => {
    const container = row(render({ locked: true }));
    expect(container.children.map((c) => c.tag)).toEqual(["span", "div", "span"]);
    expect(container.children[2].cls).toContain("size-11");
  });

  it("the name block is the stacking item, and the row never nests the controls in a box", () => {
    const container = row(render());
    const name = container.children[1];
    expect(name.cls).toContain("flex-1");
    expect(name.cls).toContain("@max-[18rem]:basis-full");
    expect(name.cls).toContain("@max-[18rem]:order-first");
  });
});
