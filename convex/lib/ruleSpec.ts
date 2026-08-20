/* ============================================================
   Rule vocabulary - shared by the server and the rule builder UI so
   both describe a rule with the same words.
   ============================================================ */

export type RuleTrigger =
  | "session.completed"
  | "session.no_show"
  | "session.upcoming"
  | "invoice.overdue"
  | "client.dormant"
  | "booking.created";

export type RuleAction = "notify_team" | "email_client" | "sms_client" | "flag_insight";

export const TRIGGERS: {
  key: RuleTrigger;
  label: string;
  needs: "none" | "hours" | "days";
  defaultValue?: number;
}[] = [
  { key: "booking.created",   label: "A booking comes in",           needs: "none" },
  { key: "session.upcoming",  label: "A session is coming up",       needs: "hours", defaultValue: 24 },
  { key: "session.completed", label: "A session finishes",           needs: "none" },
  { key: "session.no_show",   label: "Somebody does not show",       needs: "none" },
  { key: "invoice.overdue",   label: "An invoice goes overdue",      needs: "days", defaultValue: 7 },
  { key: "client.dormant",    label: "A client goes quiet",          needs: "days", defaultValue: 90 },
];

export const ACTIONS: { key: RuleAction; label: string; blurb: string }[] = [
  { key: "notify_team",  label: "Tell the team",     blurb: "A notification for whoever is working" },
  { key: "email_client", label: "Email the client",  blurb: "Sends from the studio's connected address" },
  { key: "sms_client",   label: "Text the client",   blurb: "Respects opt-outs, like every other text" },
  { key: "flag_insight", label: "Raise an insight",  blurb: "Puts it on the dashboard to look at" },
];

const TRIGGER_LABEL = new Map(TRIGGERS.map((t) => [t.key, t.label]));
const ACTION_LABEL = new Map(ACTIONS.map((a) => [a.key, a.label]));

/** One sentence describing what a rule does, for the list and the audit log. */
export function describeRule(r: {
  trigger: RuleTrigger;
  action: RuleAction;
  thresholdDays?: number;
  thresholdHours?: number;
}): string {
  const spec = TRIGGERS.find((t) => t.key === r.trigger);
  let when = TRIGGER_LABEL.get(r.trigger) ?? r.trigger;
  if (spec?.needs === "hours" && r.thresholdHours) when = `${when} in ${r.thresholdHours} hours`;
  if (spec?.needs === "days" && r.thresholdDays) when = `${when} for ${r.thresholdDays} days`;
  return `When ${when.toLowerCase()}, ${(ACTION_LABEL.get(r.action) ?? r.action).toLowerCase()}.`;
}

/** Fill {client} and {studio} in a template.
 *
 *  Substitution only, never interpolation into anything executable, and the
 *  values come from our own records rather than from the template author. An
 *  unknown token is left visible rather than blanked, so a typo shows up in
 *  a preview instead of silently sending an empty sentence. */
export function fillTemplate(
  template: string,
  vars: { client?: string; studio?: string },
): string {
  return template
    .replace(/\{client\}/g, vars.client ?? "there")
    .replace(/\{studio\}/g, vars.studio ?? "the studio");
}

export const MAX_TEMPLATE = 480;
