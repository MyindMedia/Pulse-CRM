/* Every Zuops operationId the CRM screens call, in one place so it is easy to
   audit. Each id is an entry in convex/crm/ops.generated.ts (ZU_OPS), which the
   server checks before any request; that registry is deliberately NOT imported
   here, so it stays out of these chunks (eval P-04). */

export const OP = {
  // Dashboard
  overview: "get_overview",
  healthScore: "get_health_score",
  usage: "get_usage",
  messageLimits: "message_limits",
  setupStatus: "setup_status",

  // Leads
  leadsList: "list_leads",
  leadGet: "get_lead",
  leadCreate: "create_lead",
  leadUpdate: "update_lead",
  leadSetStage: "set_lead_stage",
  leadTimeline: "lead_timeline",
  leadNote: "create_lead_note",
  leadDoNotContact: "set_do_not_contact",

  // Pipeline stages
  stagesList: "list_stages",
  stageCreate: "create_stage",
  stageUpdate: "update_stage",
  stageDelete: "delete_stage",
  stagesReorder: "reorder_stages",

  // Lookups
  tagsList: "list_tags",
  customFieldsList: "list_custom_fields",
} as const;

export type OpId = (typeof OP)[keyof typeof OP];
