import Link from "next/link";
import { PulseLogo } from "@/components/brand/pulse-logo";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "#features", label: "Features" },
      { href: "#workflow", label: "How it works" },
      { href: "#pricing", label: "Pricing" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/sign-in", label: "Log in" },
      { href: "/sign-up", label: "Get started" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative border-t border-hairline px-4 py-14 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-4">
          <PulseLogo size="sm" href="/" />
          <p className="max-w-xs text-sm text-ash">
            The operating system for recording studios. Bookings, rooms, staff,
            inventory and payments, automated.
          </p>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.title}>
            <p className="overline">{col.title}</p>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link
                    href={l.href}
                    className="link-underline text-sm text-ash transition-colors hover:text-gold"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div>
          <p className="overline">Made by</p>
          <p className="mt-4 text-sm text-ash">Myind Sound</p>
        </div>
      </div>

      <div className="mx-auto mt-12 flex max-w-6xl flex-col items-center justify-between gap-3 border-t border-hairline pt-6 text-xs text-ash-dim sm:flex-row">
        <p>&copy; 2026 Myind Sound. All rights reserved.</p>
        <p className="font-mono uppercase tracking-[0.16em]">Pulse</p>
      </div>
    </footer>
  );
}
