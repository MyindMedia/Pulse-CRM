"use client";

import * as React from "react";
import { QRCodeSVG } from "qrcode.react";

/* The download block: Apple's official badge beside a QR of the same link.
 *
 * The QR is the point of the page. A studio owner reads this on the laptop
 * they run the studio from, and the phone they need the app on is in their
 * pocket - the badge is a dead end there, the code is not.
 *
 * The badge artwork is Apple's own SVG, unmodified, per their marketing
 * guidelines. Do not redraw it, do not recolour it, do not set it in a box
 * smaller than the link target below. */

import { APP_STORE_URL } from "./app-store";

export function DownloadBlock({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-5">
      <a
        href={APP_STORE_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="Download My Studio Pulse on the App Store"
        className="inline-flex rounded-[0.6rem] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
      >
        {/* Apple ships the badge black-on-transparent; the white sheet is the
            required clear space, not decoration. */}
        <span className="inline-flex items-center rounded-[0.6rem] bg-white px-3 py-2 transition-transform duration-200 hover:-translate-y-0.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/app-store-badge.svg"
            alt="Download on the App Store"
            width={140}
            height={47}
            className={compact ? "h-8 w-auto" : "h-10 w-auto"}
          />
        </span>
      </a>

      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-white p-2.5 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]">
          <QRCodeSVG
            value={APP_STORE_URL}
            size={compact ? 64 : 84}
            level="M"
            marginSize={0}
            bgColor="#ffffff"
            fgColor="#08080a"
            title="App Store link for My Studio Pulse"
          />
        </div>
        <p className="font-meta text-[0.625rem] uppercase leading-[1.6] tracking-[0.14em] text-slate">
          Point your camera
          <br />
          at the code
        </p>
      </div>
    </div>
  );
}
