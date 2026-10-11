import { redirect } from "next/navigation";

/* Retired 2026-10-10. This was the signed-in checkout that made the buyer an
   agency. Agency accounts are the platform owner's only: every new account
   starts on /pricing and gets its own studio sub-account. */
export default function OnboardPage() {
  redirect("/pricing");
}
