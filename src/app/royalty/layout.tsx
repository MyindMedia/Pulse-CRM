import type { Metadata } from "next";

/* A contributor's statement link is a bearer token: keep it out of search
   and out of the Referer header of anything the page loads. */
export const metadata: Metadata = {
  title: "Royalty statement",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function RoyaltyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
