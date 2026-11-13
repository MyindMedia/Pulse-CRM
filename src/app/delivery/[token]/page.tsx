"use client";

import { useParams } from "next/navigation";
import { DeliveryPage } from "@/components/delivery/delivery-page";

/** Public, token-authed download page for a booking's final files. No login.
 *  Everything lives in src/components/delivery so this route pulls in nothing
 *  from the signed-in app shell. */
export default function DeliveryRoute() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === "string" ? params.token : "";
  return <DeliveryPage token={token} />;
}
