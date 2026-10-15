import { redirect } from "next/navigation";

/* Today and Dashboard merged into one pane (the TodayBoard now lives at the
   top of /dashboard). This route sticks around so old links, bookmarks and
   installed-PWA start URLs keep working. The query string rides along, so a
   `/today?session=<id>` link still opens that booking. */
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v);
  }
  const qs = params.toString();
  redirect(qs ? `/dashboard?${qs}` : "/dashboard");
}
