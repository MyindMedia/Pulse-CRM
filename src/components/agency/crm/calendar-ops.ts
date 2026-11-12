/* Zuops operationIds the Calendar calls. Each is an entry in convex/crm/ops.generated.ts
   (ZU_OPS); that registry is deliberately not imported here (eval P-04).
   Booking, rescheduling and cancelling notify the lead by design and are single,
   deliberate actions (design D12). Removing a busy block is a DELETE, so the server
   wants a confirm grant from ConfirmDialog. */

export const CAL_OP = {
  bookings: "list_bookings",
  book: "create_booking",
  reschedule: "reschedule_booking",
  cancel: "cancel_booking",
  update: "update_booking",

  calendars: "list_calendars",
  availability: "calendar_availability",
  hours: "get_availability",

  busyBlocks: "list_busy_blocks",
  busyPut: "put_busy_block",
  busyDelete: "delete_busy_block",

  members: "list_members",
  leads: "list_leads",
  lead: "get_lead",
} as const;

export type CalOpId = (typeof CAL_OP)[keyof typeof CAL_OP];
