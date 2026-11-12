/* Which approval types Pulse actually carries out when a person approves them.
   The agent may also propose an invoice, a booking, a file delivery or a client
   record change. Pulse has no executor for those yet, so approving one records
   the decision and tells the person where to do it; it never reports it as done. */

export const AUTO_EXECUTED_ACTIONS = ["send_email", "send_sms", "enable_automation"] as const;

const WHERE: Record<string, string> = {
  create_invoice: "Create the invoice in Payments.",
  update_invoice: "Change the invoice in Payments.",
  schedule_session: "Book the session in Calendar.",
  deliver_files: "Send the files from the session or song page.",
  update_client_record: "Update the client in Clients.",
};

export function isAutoExecuted(actionType: string): boolean {
  return (AUTO_EXECUTED_ACTIONS as readonly string[]).includes(actionType);
}

/** For an action Pulse does not carry out, the step the person still has to take. */
export function manualStepFor(actionType: string): string | null {
  if (isAutoExecuted(actionType)) return null;
  return WHERE[actionType] ?? "Pulse does not do this for you. Do it by hand.";
}

/** An email or text can be approved only with a recipient and a message:
 *  without a recipient nothing would be sent. Other types need no fields. */
export function canApproveSend(actionType: string, to: string, body: string): boolean {
  if (actionType !== "send_email" && actionType !== "send_sms") return true;
  return to.trim() !== "" && body.trim() !== "";
}
