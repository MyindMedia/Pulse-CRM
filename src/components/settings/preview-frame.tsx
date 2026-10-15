"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ensureFontStylesheet } from "@/lib/theme-fonts";

const SRC_DOC =
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>';

/** Attributes the frame owns on its own <html>. Anything else is copied from
 *  the host page (the next/font classes, data-theme). */
const OWNED_ATTRS = ["data-ui-style", "data-brand-theme", "data-whitelabel", "data-theme-mode"] as const;

/**
 * A same-origin iframe that renders React children with the app's own
 * stylesheets, under its own <html>.
 *
 * Why a frame and not a styled wrapper div: the hardware kit keys on
 * `:root:has(.pulse-hw)` and `:root[data-brand-theme]`, glass keys on an
 * ancestor `[data-ui-style=glass]` (so a Hardware preview inside a Glass app
 * would still frost), and the room light is `position: fixed` in viewport
 * units. Inside a frame each of those resolves against the preview's own
 * root and viewport, so the miniature is the real CSS at a real width, and
 * the draft tokens never touch the page around it.
 *
 * Children render through a portal, so they keep React context.
 */
export function PreviewFrame({
  title,
  vars,
  attrs,
  fonts,
  className,
  children,
}: {
  title: string;
  vars: Record<string, string>;
  attrs: Partial<Record<(typeof OWNED_ATTRS)[number], string>>;
  /** Theme fonts to load inside the frame. */
  fonts: (string | null | undefined)[];
  className?: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLIFrameElement>(null);
  const [body, setBody] = React.useState<HTMLElement | null>(null);

  const onLoad = React.useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc || doc.body.dataset.ready) return;
    doc.body.dataset.ready = "1";
    // The app's stylesheets (Tailwind, hardware, glass, next/font faces).
    for (const node of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
      doc.head.appendChild(node.cloneNode(true));
    }
    doc.documentElement.className = document.documentElement.className;
    const theme = document.documentElement.dataset.theme;
    if (theme) doc.documentElement.dataset.theme = theme;
    doc.body.className = "min-h-full antialiased";
    doc.body.style.margin = "0";
    setBody(doc.body);
  }, []);

  // Dev only in practice: Next adds stylesheets as routes compile. Mirror any
  // that arrive later so the preview never renders half styled.
  React.useEffect(() => {
    if (!body) return;
    const doc = body.ownerDocument;
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (n instanceof HTMLStyleElement || (n instanceof HTMLLinkElement && n.rel === "stylesheet")) {
            if (n instanceof HTMLLinkElement && n.dataset.themeFont) continue;
            doc.head.appendChild(n.cloneNode(true));
          }
        }
      }
    });
    mo.observe(document.head, { childList: true });
    return () => mo.disconnect();
  }, [body]);

  // Tokens and look on the frame's root, replaced whole on every change.
  React.useLayoutEffect(() => {
    if (!body) return;
    const root = body.ownerDocument.documentElement;
    root.removeAttribute("style");
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    for (const a of OWNED_ATTRS) {
      const v = attrs[a];
      if (v) root.setAttribute(a, v);
      else root.removeAttribute(a);
    }
  }, [body, vars, attrs]);

  const fontKey = fonts.filter(Boolean).join("|");
  React.useEffect(() => {
    if (!body) return;
    for (const f of fontKey.split("|")) if (f) ensureFontStylesheet(body.ownerDocument, f);
  }, [body, fontKey]);

  return (
    <>
      <iframe
        ref={ref}
        title={title}
        srcDoc={SRC_DOC}
        onLoad={onLoad}
        tabIndex={-1}
        className={className}
      />
      {body && createPortal(children, body)}
    </>
  );
}
