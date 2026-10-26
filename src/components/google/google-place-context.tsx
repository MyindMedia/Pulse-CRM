"use client";

import * as React from "react";
import type { GooglePlace } from "@convex/lib/places";

/* The booking pages render in the browser, but the Google listing is
   fetched on the server (the key never reaches the browser). The server
   layout hands the result down through this context. */
const GooglePlaceContext = React.createContext<GooglePlace | null>(null);

export function GooglePlaceProvider({ place, children }: { place: GooglePlace | null; children: React.ReactNode }) {
  return <GooglePlaceContext.Provider value={place}>{children}</GooglePlaceContext.Provider>;
}

export function useGooglePlace(): GooglePlace | null {
  return React.useContext(GooglePlaceContext);
}
