import Link from "next/link";
import { PulseLogo } from "@/components/brand/pulse-logo";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "#features", label: "Features" },
      { href: "#workflow", label: "How it works" },
      { href: "#contact", label: "Contact" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/sign-in", label: "Log in" },
      { href: "#contact", label: "Get started" },
    ],
  },
  {
    // Carrier / TCR campaign reviewers look for these in the footer first.
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms of Service" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative border-t border-graphite/50 px-4 py-14 lg:px-8">
      {/* 5 cells: brand blurb + Product + Account + Legal + Made by. */}
      <div className="mx-auto grid max-w-6xl gap-10 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-4">
          <PulseLogo size="md" href="/" variant="footer" />
          <p className="font-grotesk max-w-xs text-sm text-mist/75">
            The operating system for recording studios. Bookings, rooms, staff,
            inventory and payments, automated.
          </p>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.title}>
            <p className="chrome-meta text-steel">{col.title}</p>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link
                    href={l.href}
                    className="link-underline font-grotesk text-sm text-mist/75 transition-colors hover:text-gold"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div>
          <p className="chrome-meta text-steel">Made by</p>
          <p className="font-grotesk mt-4 text-sm text-mist/75">Myind Sound</p>
        </div>
      </div>

      <div className="chrome-meta mx-auto mt-12 flex max-w-6xl flex-col items-center justify-between gap-3 border-t border-graphite/50 pt-6 text-steel/70 sm:flex-row">
        <p>&copy; 2026 Myind Sound. All rights reserved.</p>
        <p>Pulse · v1.0</p>
      </div>
    </footer>
  );
}
