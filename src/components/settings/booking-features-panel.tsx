"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { CalendarCheck01 } from "@untitledui/icons";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/toggle";
import {
  BOOKING_FEATURE_COPY,
  BOOKING_FEATURE_KEYS,
  type BookingFeatureKey,
} from "@convex/lib/bookingFeatureCopy";

/** Studio settings: the four booking switches (orgs.bookingFeatures). Each
 *  switch saves on its own; the server merges, so flipping one never resets
 *  another. Owners and managers only (the settings page is already gated on
 *  branding.edit, and the mutation checks it again). */
export function BookingFeaturesPanel() {
  const features = useQuery(api.bookingFeatures.get);
  const setFeatures = useMutation(api.bookingFeatures.set);
  const [pending, setPending] = React.useState<BookingFeatureKey | null>(null);

  async function toggle(key: BookingFeatureKey, on: boolean) {
    setPending(key);
    try {
      await setFeatures({ [key]: on });
      toast.success(`${BOOKING_FEATURE_COPY[key].label} is ${on ? "on" : "off"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update that setting.");
    } finally {
      setPending(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-gold/12 text-gold">
            <CalendarCheck01 className="size-4" aria-hidden />
          </span>
          <div>
            <CardTitle>Booking features</CardTitle>
            <CardDescription>
              How bookings from your link are handled. All off until you turn them on.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {BOOKING_FEATURE_KEYS.map((key) => {
          const copy = BOOKING_FEATURE_COPY[key];
          const id = `booking-feature-${key}`;
          return (
            <div
              key={key}
              className="flex items-start justify-between gap-4 rounded-lg border border-graphite/50 bg-coal/40 px-4 py-3"
            >
              <div className="min-w-0 space-y-1">
                <label htmlFor={id} className="font-grotesk text-sm font-semibold text-bone">
                  {copy.label}
                </label>
                <p className="text-xs text-steel">{copy.blurb}</p>
              </div>
              <Switch
                id={id}
                checked={features?.[key] ?? false}
                disabled={features === undefined || pending === key}
                onCheckedChange={(on) => toggle(key, on)}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
