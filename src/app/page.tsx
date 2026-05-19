import { redirect } from "next/navigation";

/* Pulse opens straight into the studio dashboard. In demo mode the app is
   fully explorable; with Clerk configured the middleware gates this first. */
export default function Home() {
  redirect("/dashboard");
}
