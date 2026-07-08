import { redirect } from "next/navigation";

/* Today and Dashboard merged into one pane (the TodayBoard now lives at the
   top of /dashboard). This route sticks around so old links, bookmarks and
   installed-PWA start URLs keep working. */
export default function TodayPage() {
  redirect("/dashboard");
}
