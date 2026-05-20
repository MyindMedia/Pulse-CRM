/* Default pre / post checklists used when a session is created.
   Studios will eventually customise these per room (future feature);
   for now everyone shares the templated baseline. */
export const PRE_SESSION_ITEMS = [
  "Unlock the room and turn on lights / climate",
  "Power up console + monitors + outboard rack",
  "Patch the mics for the session's service type",
  "Verify headphone mix on every cue station",
  "Confirm Pro Tools template loaded + session saved",
  "Stage drinks / refreshments for the artist",
  "Re-read the intake form for special requests",
] as const;

export const POST_SESSION_ITEMS = [
  "Save + bounce + cloud-back-up the session",
  "Coil cables + return mics + mic stands",
  "Wipe down the console + Steinway + outboard",
  "Reset patch bay to house default",
  "Empty trash + sweep + dim lights",
  "Lock the room + secure outboard",
  "Log notes for the next session in the room",
] as const;

export function newPreChecklistItems() {
  return PRE_SESSION_ITEMS.map((label) => ({ label, done: false }));
}

export function newPostChecklistItems() {
  return POST_SESSION_ITEMS.map((label) => ({ label, done: false }));
}
