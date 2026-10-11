import { redirect } from "next/navigation";

/* Retired with /onboard (see ../page.tsx): it waited for an agency that is no
   longer created. Plan changes now return to Settings > Billing. */
export default function OnboardDonePage() {
  redirect("/pricing");
}
