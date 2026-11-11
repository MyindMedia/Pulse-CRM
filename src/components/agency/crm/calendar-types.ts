/* Calendar response shapes (the `data` part of the Zuops envelope), from
   specs/features/agency-crm-zuops/api-shapes.md and the examples in the Zuops
   OpenAPI spec. Everything is optional or nullable. */

import type { Iso } from "./zu-types";

export type BookingStatus = "scheduled" | "confirmed" | "completed" | "no_show" | "cancelled";

export type ServiceDetails = {
  service?: string | null;
  option?: { id?: string; name?: string | null } | string | null;
  addons?: Array<{ id?: string; name?: string | null } | string> | null;
  total_cents?: number | null;
  deposit_cents?: number | null;
  balance_cents?: number | null;
  currency?: string | null;
};

export type Booking = {
  id: string;
  lead_id?: string | null;
  calendar_id?: string | null;
  appointment_number?: number | null;
  title?: string | null;
  starts_at?: Iso | null;
  ends_at?: Iso | null;
  timezone?: string | null;
  lead_timezone?: string | null;
  location?: string | null;
  notes?: string | null;
  meeting_type?: string | null;
  meeting_location?: string | null;
  meeting_url?: string | null;
  host_user_id?: string | null;
  status?: BookingStatus | string | null;
  source?: string | null;
  notify_lead?: boolean | null;
  is_arrival_window?: boolean | null;
  service_details?: ServiceDetails | null;
  manage_url?: string | null;
};
export type BookingsResponse = { bookings?: Booking[] };
export type BookingResponse = { booking?: Booking; warning?: string | null };

export type WeeklyHours = Partial<Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", string[][]>>;

export type PricingOption = { id: string; name?: string | null; description?: string | null; price_cents?: number | null; duration_minutes?: number | null };
export type PricingAddon = { id: string; name?: string | null; price_cents?: number | null; extra_minutes?: number | null };

export type Calendar = {
  id: string;
  slug?: string | null;
  name?: string | null;
  title?: string | null;
  timezone?: string | null;
  duration_minutes?: number | null;
  duration_days?: number | null;
  buffer_minutes?: number | null;
  max_days_ahead?: number | null;
  weekly_hours?: WeeklyHours | null;
  meeting_type?: string | null;
  location_label?: string | null;
  is_active?: boolean | null;
  currency?: string | null;
  pricing?: {
    enabled?: boolean | null;
    options_label?: string | null;
    options?: PricingOption[] | null;
    addons_label?: string | null;
    addons?: PricingAddon[] | null;
  } | null;
  summary?: { length_label?: string | null; has_options?: boolean | null; price_from_cents?: number | null; price_to_cents?: number | null } | null;
  booking_path?: string | null;
};
export type CalendarsResponse = { calendars?: Calendar[] };

export type Quote = {
  option?: { id?: string; name?: string | null } | null;
  addons?: Array<{ id?: string; name?: string | null }> | null;
  length_label?: string | null;
  total_cents?: number | null;
  deposit_cents?: number | null;
  balance_cents?: number | null;
  currency?: string | null;
};

export type AvailabilityResponse = {
  calendar?: { id?: string; name?: string | null; timezone?: string | null; duration_minutes?: number | null } | null;
  from_date?: string | null;
  to_date?: string | null;
  slots?: Iso[] | null;
  days?: Array<{ date: string; label?: string | null; slots?: Iso[] | null }> | null;
  quote?: Quote | null;
};

export type BusyBlock = {
  id?: string;
  external_id: string;
  team_members?: Array<{ id?: string | null; email?: string | null; name?: string | null }> | null;
  starts_at?: Iso | null;
  ends_at?: Iso | null;
  title?: string | null;
  source?: string | null;
};
export type BusyBlocksResponse = { busy_blocks?: BusyBlock[]; has_more?: boolean };

export type HoursResponse = {
  availability?: {
    timezone?: string | null;
    weekly_hours?: WeeklyHours | null;
    slot_minutes?: number | null;
    buffer_minutes?: number | null;
    scheduling_mode?: string | null;
    date_overrides?: Array<{ date?: string; pairs?: string[][] }> | null;
  } | null;
  configured?: boolean | null;
};
