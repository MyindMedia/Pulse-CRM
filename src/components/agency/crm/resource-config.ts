/* Every config-driven CRM screen as plain data (design D13). One entry is one
   resource: what to list or read, which columns, what opens on a row, and which
   actions it offers. resource-panel.tsx renders any entry.

   Operation ids are string literals checked against the 352-operation registry
   by resource-config.test.ts (the registry itself is NOT imported here, so it
   stays out of these chunks: eval P-04). Anything not surfaced here is still
   reachable in the Functions tab. */

export type CellFormat = "text" | "date" | "datetime" | "money" | "number" | "percent" | "bool" | "badge" | "count" | "pairs";

export type FieldDef = {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "boolean" | "select" | "date" | "datetime" | "json";
  options?: string[];
  required?: boolean;
  help?: string;
  /** Where the value goes. Default body. */
  in?: "path" | "query" | "body";
  /** A comma or line separated list, sent as an array of strings. */
  list?: boolean;
  /** For json fields: what the parsed value must be. */
  jsonShape?: "array" | "object";
};

export type ActionDef = {
  label: string;
  op: string;
  scope: "row" | "panel";
  /** The operation's path parameter filled from the row (row actions). */
  pathParam?: string;
  /** Row key that holds the path value. Default: the list's rowId. */
  pathFrom?: string;
  fields?: FieldDef[];
  /** A fixed body, merged under the fields. */
  body?: Record<string, unknown>;
  /** Body fields copied from the row (e.g. the row's id as `automation_ids`). */
  rowBody?: Array<{ field: string; from: string; array?: boolean }>;
  confirm?: {
    title: string;
    /** What or who it acts on. May use {count:noun} ("1 lead", "3 leads"), {name}, {email_audience},
     *  {send_when} ("now" or "at <time>"), {drip} and any {field} of the form. The consequence line for the operation's kind is
     *  added by the dialog, so this does not repeat it. */
    body: string;
    label: string;
    /** Where {count} comes from: the length of a list typed into this form.
     *  Never a row value: Zuops counts recipients only when it sends. */
    count?: { field: string };
    destructive?: boolean;
    /** Ask even where the server does not require it (voiding, replacing a whole list). */
    always?: boolean;
  };
  /** Needs a Full access key (the operation's scope ends in ":admin"). */
  admin?: boolean;
  /** Extra operation ids whose cached reads are refreshed after it runs. */
  invalidate?: string[];
  /** Row actions: only when a row value is one of these. */
  show?: { key: string; in: Array<string | number | boolean | null> };
  /** Keep the dialog open and show what Zuops answered (links, counts, reads). */
  showResult?: boolean;
  /** The answer carries a secret shown exactly once (webhook signing secret). */
  reveal?: { keys: string[]; title: string; note: string };
  /** Prefilled edits send every field, not only the changed ones (PUT). */
  sendAll?: boolean;
  /** Sentence for the success toast. */
  done?: string;
  /** Toast when the request was scheduled rather than done now (the answer
   *  says `scheduled: true`, or the form set `schedule_at`). {when} is the time. */
  doneScheduled?: string;
  /** Columns for a list shown in the answer dialog (showResult). Without them
   *  the dialog picks the rows' plain values and leaves ids out. */
  resultColumns?: ColumnDef[];
  /** false: never prefill from the row or settings object (adds, not edits). */
  prefill?: false;
};

export type ColumnDef = { key: string; label: string; format?: CellFormat };

export type ResourceDef = {
  key: string;
  title: string;
  /** One plain sentence. */
  blurb: string;
  list?: {
    op: string;
    query?: Record<string, string | number | boolean>;
    /** Key in data holding the array; the first array when omitted. */
    rowsKey?: string;
    columns: ColumnDef[];
    /** Default "id". */
    rowId?: string;
    paging?: "offset" | "cursor" | "none";
    /** Query param name for the search box. */
    search?: string;
    filters?: Array<{ param: string; label: string; options: Array<{ value: string; label: string }> }>;
  };
  /** A settings object rather than a list (GET returns one object). */
  single?: {
    op: string;
    query?: Record<string, string | number | boolean>;
    /** Show only these keys (alternatives with "|"), in this order. */
    only?: ColumnDef[];
    /** The object sits at this path in the answer (e.g. "key"). */
    pick?: string;
    /** A list whose rows can name the ids in this object, used ONLY when it is
     *  already cached (another tab read it). Never fetched for this. */
    names?: { op: string; rowsKey?: string };
  };
  /** Opens in a Sheet and shows every field. */
  detail?: { op: string; pathParam: string };
  actions?: ActionDef[];
  /** e.g. "Steps are built in the Zuops app." */
  note?: string;
};

export type ResourceGroup = "campaigns" | "automations" | "forms" | "calls" | "more" | "settings";

/* ---------- small builders so the table below stays readable ---------- */

type FieldOpts = Partial<Omit<FieldDef, "name" | "label" | "type">>;
const text = (name: string, label: string, o: FieldOpts = {}): FieldDef => ({ name, label, type: "text", ...o });
const area = (name: string, label: string, o: FieldOpts = {}): FieldDef => ({ name, label, type: "textarea", ...o });
const num = (name: string, label: string, o: FieldOpts = {}): FieldDef => ({ name, label, type: "number", ...o });
const bool = (name: string, label: string, o: FieldOpts = {}): FieldDef => ({ name, label, type: "boolean", ...o });
const pick = (name: string, label: string, options: string[], o: FieldOpts = {}): FieldDef => ({ name, label, type: "select", options, ...o });
const json = (name: string, label: string, o: FieldOpts = {}): FieldDef => ({ name, label, type: "json", ...o });
const when = (name: string, label: string, o: FieldOpts = {}): FieldDef => ({ name, label, type: "datetime", ...o });
const list = (name: string, label: string, o: FieldOpts = {}): FieldDef => ({ name, label, type: "textarea", list: true, ...o });

const col = (key: string, label: string, format?: CellFormat): ColumnDef => ({ key, label, format });
const opt = (...values: string[]) => values.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1).replace(/_/g, " ") }));

type Extra = Partial<Omit<ActionDef, "label" | "op" | "scope">>;
const make = (label: string, op: string, fields: FieldDef[] = [], x: Extra = {}): ActionDef => ({ label, op, scope: "panel", fields, ...x });
const rowAct = (label: string, op: string, pathParam: string, fields: FieldDef[] = [], x: Extra = {}): ActionDef => ({ label, op, scope: "row", pathParam, fields, ...x });
const view = (label: string, op: string, pathParam: string, x: Extra = {}): ActionDef => ({ label, op, scope: "row", pathParam, showResult: true, ...x });
const remove = (op: string, pathParam: string, what: string, x: Extra & { label?: string } = {}): ActionDef => ({
  label: "Delete", op, scope: "row", pathParam,
  confirm: { title: `Delete this ${what}?`, body: `You are deleting the ${what} {name}.`, label: "Delete", destructive: true },
  ...x,
});

const COLORS = ["blue", "amber", "violet", "cyan", "emerald", "rose", "teal", "orange", "pink", "indigo", "lime", "slate"];
const LEAD_IDS = (label = "Lead ids") => list("lead_ids", label, { required: true, help: "One per line or separated by commas. Find ids in Leads." });
/** Words for a confirm. The dialog adds the consequence line for the
 *  operation's kind (reaches people, uses credits, and so on) by itself. */
const ask = (title: string, body: string, label: string): NonNullable<ActionDef["confirm"]> => ({ title, body, label });

/* ---------- the resources ---------- */

const campaigns: ResourceDef[] = [
  {
    key: "email-campaigns",
    title: "Email campaigns",
    blurb: "Marketing emails to your leads, with who they went to and how they did.",
    list: {
      op: "list_email_campaigns", query: { limit: 25 }, rowsKey: "campaigns", paging: "none",
      columns: [
        col("name|subject", "Campaign"), col("status", "Status", "badge"),
        col("total_recipients|results.recipients", "Recipients", "number"),
        col("results.opened", "Opened", "number"),
        col("results.clicked", "Clicked", "number"),
        col("results.booked", "Booked", "number"),
        col("updated_at", "Changed", "datetime"),
      ],
      filters: [{ param: "status", label: "Status", options: opt("draft", "scheduled", "sending", "sent", "failed", "canceled") }],
    },
    detail: { op: "get_email_campaign", pathParam: "campaign_id" },
    actions: [
      make("New draft", "create_email_campaign", [
        text("name", "Name"), text("subject", "Subject"),
        area("brief", "Brief", { help: "Describe it in plain words and Zuops writes the email. Uses credits." }),
        text("headline", "Headline"), area("body", "Body"), text("button_label", "Button label"), text("button_url", "Button link"),
        pick("audience", "Audience", ["everyone", "not_booked", "stages", "tags"]),
        list("tags", "Tags (when the audience is tags)"), list("stages", "Stage keys (when the audience is stages)"),
        pick("design", "Design", ["classic", "bold", "letter", "flyer", "newsletter", "elegant", "minimal", "bright", "fresh", "blocks", "retro", "night", "soft"]),
      ], {
        done: "Draft saved in Zuops. Nothing was sent.",
        confirm: ask("Have Zuops write this draft?", "Zuops writes the email from your brief and saves it as a draft. Nothing is sent.", "Write draft"),
      }),
      rowAct("Edit draft", "update_email_campaign", "campaign_id", [
        text("name", "Name"), text("subject", "Subject"), text("preheader", "Preview text"), text("headline", "Headline"),
        area("body", "Body"), text("button_label", "Button label"), text("button_url", "Button link"),
        pick("audience", "Audience", ["everyone", "not_booked", "stages", "tags"]),
      ], { show: { key: "status", in: ["draft"] } }),
      rowAct("Send or schedule", "send_email_campaign", "campaign_id", [
        when("schedule_at", "Send at", { help: "Leave empty to send now. 2 minutes to 90 days ahead." }),
        pick("audience", "Audience", ["everyone", "not_booked", "stages", "tags"], { help: "Leave as is to use the saved audience." }),
        list("tags", "Tags (when the audience is tags)"), list("stages", "Stage keys (when the audience is stages)"),
        bool("not_booked", "Only people who have not booked", { help: "Leave as is to keep the campaign's setting." }),
        json("drip", "A few at a time", { jsonShape: "object", help: 'For example {"every": 50, "minutes": 60}. Leave empty to send all at once.' }),
      ], {
        show: { key: "status", in: ["draft"] },
        prefill: false,
        confirm: ask(
          "Send {name}?",
          "It emails {email_audience} from your Zuops sender {send_when}.{drip} Zuops leaves out leads with no email address and anyone who unsubscribed, bounced or marked it spam, and counts the recipients only when it sends.",
          "Send campaign",
        ),
        done: "Zuops is sending it now.",
        doneScheduled: "Scheduled in Zuops for {when}.",
      }),
      rowAct("Cancel send", "cancel_email_campaign", "campaign_id", [], { show: { key: "status", in: ["scheduled", "sending"] }, done: "Stopped in Zuops." }),
      rowAct("Send the rest now", "send_email_campaign_rest", "campaign_id", [], {
        show: { key: "status", in: ["sending"] },
        confirm: ask("Send the rest of {name} now?", "Everyone still waiting for {name} gets it now instead of in batches.", "Send the rest"),
      }),
      rowAct("Duplicate", "duplicate_email_campaign", "campaign_id", [], { done: "Copied as a new draft." }),
      remove("delete_email_campaign", "campaign_id", "campaign"),
    ],
  },
];

const automations: ResourceDef[] = [
  {
    key: "automations",
    title: "Automations",
    blurb: "Switch an automation on or off, see who is inside, and add or take out leads.",
    list: {
      op: "list_ws_automations", rowsKey: "automations", paging: "none",
      columns: [
        col("name", "Automation"), col("trigger_type", "Trigger"), col("enabled", "On", "bool"),
        col("run_count", "Runs", "number"), col("error_count", "Errors", "number"), col("last_run_at", "Last run", "datetime"),
      ],
    },
    detail: { op: "get_automation", pathParam: "automation_id" },
    actions: [
      rowAct("Switch on", "toggle_ws_automation", "automation_id", [], {
        body: { enabled: true }, show: { key: "enabled", in: [false, null] },
        confirm: { title: "Switch this automation on?", body: "{name} will run for real leads, including any texts or emails in its steps.", label: "Switch on" },
        done: "Switched on in Zuops.",
      }),
      rowAct("Switch off", "toggle_ws_automation", "automation_id", [], {
        body: { enabled: false }, show: { key: "enabled", in: [true] },
        confirm: { title: "Switch this automation off?", body: "{name} stops running. You can switch it back on at any time.", label: "Switch off" },
        done: "Switched off in Zuops.",
      }),
      view("Who is inside", "list_automation_enrollments", "automation_id"),
      view("Results per step", "automation_results", "automation_id"),
      rowAct("Enroll leads", "enroll_automation", "automation_id", [LEAD_IDS(), bool("ignore_filters", "Ignore the automation's filters")], {
        prefill: false,
        confirm: { title: "Enroll {count:lead}?", body: "{name} can text and email the {count:lead} you listed as its steps run.", label: "Enroll", count: { field: "lead_ids" } },
      }),
      rowAct("Take leads out", "unenroll_automation", "automation_id", [
        list("lead_ids", "Lead ids", { help: "One per line or separated by commas." }), bool("all", "Take everyone out"),
      ]),
      rowAct("Move to folder", "move_automations", "automation_id", [text("folder_id", "Folder id", { required: true, help: "From Automation folders." })], {
        pathParam: undefined, rowBody: [{ field: "automation_ids", from: "id", array: true }],
      }),
    ],
    note: "Steps are built in the Zuops app, or in Functions with a Full access key.",
  },
  {
    key: "automation-folders",
    title: "Automation folders",
    blurb: "Folders that group automations in the Zuops app.",
    list: { op: "list_automation_folders", paging: "none", columns: [col("name", "Folder"), col("automations", "Automations", "count"), col("created_at", "Created", "date")] },
    actions: [
      make("New folder", "create_automation_folder", [text("name", "Name", { required: true })]),
      rowAct("Rename", "rename_automation_folder", "folder_id", [text("name", "Name", { required: true })]),
      remove("delete_automation_folder", "folder_id", "folder"),
    ],
  },
];

const forms: ResourceDef[] = [
  {
    key: "smart-forms",
    title: "Smart forms",
    blurb: "Lead forms on your site, how many people saw them and how many sent them.",
    list: {
      op: "list_smart_forms", rowsKey: "smart_forms", paging: "none",
      columns: [
        col("name", "Form"), col("is_published", "Published", "bool"), col("views_count", "Views", "number"),
        col("submissions_count", "Submissions", "number"), col("created_at", "Created", "date"),
      ],
    },
    actions: [
      make("New form", "create_smart_form", [
        text("name", "Name", { required: true }), text("headline", "Headline"),
        pick("layout_mode", "Layout", ["single_step", "multi_step", "conversational", "funnel"]),
        bool("booking_enabled", "Books an appointment"), bool("is_published", "Published"),
      ], { confirm: ask("Publish {name}?", "With Published on, {name} goes live on the website for anyone who opens it.", "Create form") }),
      rowAct("Update or publish", "update_smart_form", "form_id", [
        bool("is_published", "Published"), pick("layout_mode", "Layout", ["single_step", "multi_step", "conversational", "funnel"]),
        bool("qualifier_enabled", "Screening questions on"), bool("calendar_routing", "Calendar routing on"),
      ], { confirm: ask("Update {name}?", "With Published on, {name} is live on the website for anyone who opens it.", "Save form") }),
      view("Submissions", "list_form_submissions", "form_id", {
        // GET /v1/smart-forms/{form_id}/submissions (api-shapes.md): who and when first, then the answers; ids stay in the record.
        resultColumns: [
          col("created_at", "Submitted", "datetime"),
          col("first_name+last_name|name|full_name", "Name"),
          col("email|phone", "Contact"),
          col("custom_fields.custom_answers|custom_fields.raw_answers|answers", "Answers", "pairs"),
          col("notes", "Notes"),
          col("status", "Status", "badge"),
        ],
      }),
    ],
  },
  {
    key: "surveys",
    title: "Surveys",
    blurb: "Feedback forms sent to leads and customers, with their answers.",
    list: { op: "list_surveys", paging: "none", columns: [col("name", "Survey"), col("live", "Live", "bool"), col("created_at", "Created", "date")] },
    actions: [
      make("New survey", "create_survey", [pick("template", "Template", ["lost_deal", "won_deal", "check_in", "recommend", "blank"]), text("name", "Name")]),
      rowAct("When it sends itself", "update_survey_rules", "form_id", [
        bool("live", "On"), area("message", "Message"), text("subject", "Email subject"), json("rules", "Rules", { jsonShape: "array" }),
      ], { confirm: ask("Change when {name} sends itself?", "Who gets {name} automatically, and when, follows these rules.", "Save rules") }),
      rowAct("Send", "send_survey", "form_id", [LEAD_IDS(), pick("channel", "Channel", ["sms", "email", "both"])], {
        prefill: false,
        confirm: { title: "Send {name} to {count:lead}?", body: "Each lead you listed ({count:lead}) gets their own link to {name}.", label: "Send survey", count: { field: "lead_ids" } },
      }),
      rowAct("Link for one lead", "create_survey_link", "form_id", [text("lead_id", "Lead id", { required: true })], { showResult: true, done: "Link ready. Nothing was sent." }),
      view("Answers", "get_survey_results", "form_id"),
    ],
  },
];

const calls: ResourceDef[] = [
  {
    key: "calls",
    title: "Calls",
    blurb: "Inbound, outbound, AI receptionist and AI campaign calls with the outcome and summary.",
    list: {
      op: "list_calls", query: { limit: 25 }, rowsKey: "calls", paging: "cursor",
      columns: [
        col("created_at", "When", "datetime"), col("direction", "Direction"), col("mode", "Type"),
        col("status", "Status", "badge"), col("duration_sec", "Seconds", "number"),
        col("ai_outcome", "Outcome", "badge"), col("ai_summary", "Summary"),
      ],
      filters: [
        { param: "direction", label: "Direction", options: opt("inbound", "outbound") },
        { param: "type", label: "Type", options: opt("softphone", "bridge", "inbound", "forward", "ai", "ai_receptionist") },
        { param: "outcome", label: "Outcome", options: opt("connected", "missed", "voicemail") },
      ],
    },
    detail: { op: "get_call", pathParam: "call_id" },
    note: "A recording link works for 15 minutes and opens in a new tab. Demo confirmation calls placed by Pulse are under Prospects, Meetings.",
  },
  {
    key: "call-campaigns",
    title: "AI calling campaigns",
    blurb: "Campaigns where the AI calls leads, and how far each has got.",
    list: {
      op: "list_call_campaigns", paging: "none",
      columns: [
        col("name", "Campaign"), col("status", "Status", "badge"), col("leads_total", "Leads", "number"),
        col("calls_placed|calls_total", "Calls", "number"), col("calls_connected", "Connected", "number"),
        col("bookings|booked|bookings_total", "Booked", "number"), col("credits_used", "Credits used", "number"),
      ],
      filters: [{ param: "status", label: "Status", options: opt("draft", "running", "paused", "completed") }],
    },
    actions: [rowAct("Pause", "pause_call_campaign", "campaign_id", [], { show: { key: "status", in: ["running"] }, done: "Paused in Zuops." })],
  },
  {
    key: "ai-lessons",
    title: "AI lessons",
    blurb: "Rules and examples every AI reply and call follows.",
    list: {
      op: "list_ai_lessons", query: { limit: 50 }, paging: "cursor",
      columns: [col("note|better_reply|ai_message", "Lesson"), col("kind", "Kind", "badge"), col("channel", "Channel"), col("active", "On", "bool"), col("created_at", "Added", "date")],
      filters: [{ param: "kind", label: "Kind", options: opt("good", "avoid", "rule") }],
    },
    actions: [
      make("Add a rule", "create_ai_lesson", [area("note", "What the AI should do", { required: true }), pick("channel", "Channel", ["sms", "email", "voice", "all"]), bool("active", "On")], {
        confirm: ask("Add this rule for the AI?", "The AI follows this rule in the replies it sends to your leads.", "Add rule"),
      }),
      rowAct("Edit", "update_ai_lesson", "lesson_id", [
        area("note", "Lesson"), pick("channel", "Channel", ["sms", "email", "voice", "all"]), bool("active", "On"),
        area("better_reply", "A better reply"), bool("never_again", "Never send anything like it again"),
      ], { confirm: ask("Change this AI lesson?", "The AI uses the changed lesson in the replies it sends to your leads.", "Save lesson") }),
      remove("delete_ai_lesson", "lesson_id", "lesson"),
    ],
  },
];

const ESTIMATE_COLS = [
  col("number", "No."), col("title", "Title"), col("customer_name", "Customer"),
  col("effective_status|status", "Status", "badge"), col("total_cents", "Total", "money"), col("sent_at", "Sent", "datetime"),
];

const more: ResourceDef[] = [
  {
    key: "estimates",
    title: "Estimates",
    blurb: "Quotes for leads: drafts, sent, approved, and the invoices they became.",
    list: {
      op: "list_estimates", query: { limit: 25 }, paging: "cursor", columns: ESTIMATE_COLS,
      filters: [{ param: "status", label: "Status", options: opt("draft", "sent", "approved", "declined", "expired", "converted") }],
    },
    detail: { op: "get_estimate", pathParam: "estimate_id" },
    actions: [
      make("New estimate", "create_estimate", [
        text("lead_id", "Lead id"), text("title", "Title"), area("intro", "Intro"),
        json("items", "Line items", { jsonShape: "array", help: 'For example [{"name": "Mix", "unit_price_cents": 50000, "quantity": 1}].' }),
        text("customer_name", "Customer name"), text("customer_email", "Customer email"), num("valid_days", "Valid for (days)"),
      ], { done: "Draft estimate saved. Nothing was sent." }),
      rowAct("Edit", "update_estimate", "estimate_id", [
        text("title", "Title"), area("intro", "Intro"), json("items", "Line items", { jsonShape: "array" }), area("terms", "Terms"), num("valid_days", "Valid for (days)"),
      ]),
      rowAct("Send", "send_estimate", "estimate_id", [pick("channel", "Channel", ["sms", "email", "both"]), area("message", "Message"), text("subject", "Email subject")], {
        prefill: false,
        confirm: ask("Send {name} to the lead?", "The lead on {name} gets the estimate link now.", "Send estimate"),
      }),
      rowAct("Make the invoice", "convert_estimate", "estimate_id", [text("option_id", "Option id", { help: "Leave empty for the option the customer picked." })]),
      remove("delete_estimate", "estimate_id", "estimate"),
    ],
  },
  {
    key: "estimate-templates",
    title: "Quote templates",
    blurb: "Starting points for new estimates.",
    list: { op: "list_estimate_templates", paging: "none", columns: [col("name", "Template"), col("title", "Title"), col("from_cents", "From", "money"), col("use_count", "Used", "number"), col("updated_at", "Changed", "date")] },
    detail: { op: "get_estimate_template", pathParam: "template_id" },
    actions: [
      make("New template", "create_estimate_template", [text("name", "Name", { required: true }), text("title", "Title"), area("intro", "Intro"), area("terms", "Terms"), num("valid_days", "Valid for (days)")]),
      rowAct("Edit", "update_estimate_template", "template_id", [text("name", "Name"), text("title", "Title"), area("intro", "Intro"), area("terms", "Terms"), num("valid_days", "Valid for (days)")]),
      remove("delete_estimate_template", "template_id", "template"),
    ],
  },
  {
    key: "invoices",
    title: "Invoices",
    blurb: "Invoices, deposits and balances, read only.",
    list: {
      op: "list_invoices", query: { limit: 25 }, paging: "cursor",
      columns: [
        col("number", "No."), col("customer_name", "Customer"),
        col("effective_status|status", "Status", "badge"), col("total_cents", "Total", "money"), col("balance_cents", "Balance", "money"), col("due_date", "Due", "date"),
      ],
      filters: [{ param: "status", label: "Status", options: opt("draft", "sent", "paid", "void", "overdue") }],
    },
    detail: { op: "get_invoice", pathParam: "invoice_id" },
  },
  {
    key: "stripe-payments",
    title: "Stripe payments",
    blurb: "Payments from the business's own Stripe account.",
    list: {
      op: "list_stripe_payments", query: { limit: 25 }, paging: "cursor",
      columns: [col("paid_at", "When", "datetime"), col("lead_name|name|email", "From"), col("amount_cents", "Amount", "money"), col("refunded_at", "Refunded", "datetime")],
    },
    actions: [
      make("Payment tracking", "set_stripe_payment_tracking", [
        bool("on", "Track payments"), text("stage_key", "Move paying leads to stage"), pick("meta_event", "Event sent to Meta", ["Purchase", "Schedule"]),
      ], { confirm: ask("Send payments to Meta?", "With an event set, each tracked payment is reported to Meta as {meta_event}.", "Save tracking") }),
    ],
  },
  {
    key: "price-book",
    title: "Price book",
    blurb: "Services and products with their prices.",
    list: {
      op: "list_price_book", query: { limit: 100 }, paging: "none", search: "search",
      columns: [col("name", "Item"), col("category", "Category"), col("unit_price_cents", "Price", "money"), col("is_active", "Active", "bool"), col("usage_count", "Used", "number")],
    },
  },
  {
    key: "reviews",
    title: "Review requests",
    blurb: "Who was asked for a review, and what they did.",
    list: {
      op: "list_review_requests", query: { limit: 25 }, paging: "cursor",
      columns: [
        col("lead.full_name|lead_name|name", "Lead"), col("sent_at|created_at", "Asked", "datetime"), col("rating", "Rating", "number"),
        col("clicked_at|clicked", "Went to review site", "bool"), col("feedback|private_feedback", "Private feedback"),
      ],
    },
    actions: [
      make("Review link for a lead", "create_review_link", [text("lead_id", "Lead id", { required: true, in: "path" }), text("funnel_id", "Review page id")], { showResult: true, done: "Link ready. Nothing was sent." }),
    ],
  },
  {
    key: "review-funnels",
    title: "Review pages",
    blurb: "The pages that ask customers for a review.",
    list: { op: "list_review_funnels", paging: "none", columns: [col("name", "Page"), col("slug|public_url|url", "Link"), col("created_at", "Created", "date")] },
    actions: [rowAct("Change words", "update_review_funnel", "funnel_id", [text("name", "Name"), json("copy", "Words", { jsonShape: "object" }), json("helper", "Writing helper", { jsonShape: "object" })], {
      confirm: ask("Change the words on {name}?", "Customers who open the review page {name} see the new words.", "Save words"),
    })],
  },
  {
    key: "contracts",
    title: "Contracts",
    blurb: "Contracts sent for signature and where each one stands.",
    list: {
      op: "list_contracts", query: { limit: 50 }, paging: "none",
      columns: [
        col("recipient_name", "Signer"), col("subject", "Contract"), col("status", "Status", "badge"),
        col("stage", "Stage"), col("sent_at", "Sent", "datetime"), col("signed_at", "Signed", "datetime"),
      ],
      filters: [{ param: "status", label: "Status", options: opt("draft", "sent", "signed", "declined", "voided") }],
    },
    detail: { op: "get_contract", pathParam: "contract_id" },
    actions: [
      make("New contract", "create_contract", [
        text("lead_id", "Lead id"), text("template_id", "Template id", { help: "From Contract templates." }), text("subject", "Subject"),
        area("body", "Contract text"), text("recipient_name", "Signer name"), text("recipient_email", "Signer email"),
        text("recipient_phone", "Signer phone"), num("expires_in_days", "Expires in (days)"),
      ], { done: "Draft contract saved. Nothing was sent." }),
      rowAct("Get signing link", "get_contract_link", "contract_id", [bool("allow_blanks", "Allow blank fields")], { showResult: true, done: "Link ready. Nothing was sent." }),
      rowAct("Send", "send_contract", "contract_id", [pick("channel", "Channel", ["email", "sms", "both"]), area("note", "Note")], {
        prefill: false,
        confirm: ask("Send {name} for signature?", "The signer of {name} gets it now.", "Send contract"),
      }),
      rowAct("Void", "void_contract", "contract_id", [], {
        show: { key: "status", in: ["draft", "sent"] },
        confirm: { title: "Void {name}?", body: "The signing link for {name} stops working.", label: "Void", destructive: true, always: true },
      }),
    ],
  },
  {
    key: "contract-templates",
    title: "Contract templates",
    blurb: "Reusable contracts.",
    list: { op: "list_contract_templates", paging: "none", columns: [col("name", "Template"), col("category", "Category"), col("updated_at", "Changed", "date")] },
  },
  {
    key: "proposals",
    title: "Proposals",
    blurb: "Proposals for clients, written by the AI or in your own HTML.",
    list: {
      op: "list_proposals", query: { limit: 50 }, paging: "none",
      columns: [col("title", "Proposal"), col("client_name|client_company", "Client"), col("status", "Status", "badge"), col("stage", "Stage"), col("sent_at", "Sent", "datetime"), col("public_url", "Link")],
      filters: [{ param: "status", label: "Status", options: opt("draft", "sent", "accepted", "declined") }],
    },
    detail: { op: "get_proposal", pathParam: "proposal_id" },
    actions: [
      make("New proposal", "create_proposal", [
        text("title", "Title"), text("lead_id", "Lead id"), text("client_name", "Client name"), text("client_company", "Client company"),
        text("client_email", "Client email"), text("template_id", "Template id"),
        json("build", "What the AI should write", { jsonShape: "object", help: "See Functions, create_proposal, for the shape. Uses credits." }),
      ], {
        done: "Proposal started in Zuops. Nothing was sent.",
        confirm: ask("Have the AI write this proposal?", "Zuops writes the proposal from what you filled in. Nothing is sent.", "Write proposal"),
      }),
      rowAct("Edit", "update_proposal", "proposal_id", [
        text("title", "Title"), text("client_name", "Client name"), text("client_company", "Client company"), text("client_email", "Client email"),
        text("accept_label", "Accept button"), num("expires_in_days", "Expires in (days)"),
      ]),
      rowAct("Change with the AI", "edit_proposal", "proposal_id", [area("instruction", "What to change", { required: true })], {
        prefill: false,
        confirm: ask("Change {name} with the AI?", "Zuops rewrites {name} from your instruction. Nothing is sent.", "Rewrite"),
      }),
      rowAct("Get the link", "get_proposal_link", "proposal_id", [bool("allow_blanks", "Allow blank fields")], { showResult: true, done: "Link ready. Nothing was sent." }),
      rowAct("Send", "send_proposal", "proposal_id", [pick("channel", "Channel", ["email", "sms", "both"]), text("to_email", "To email"), area("note", "Note")], {
        prefill: false,
        confirm: ask("Send {name}?", "The client gets {name} now.", "Send proposal"),
      }),
      rowAct("Duplicate", "duplicate_proposal", "proposal_id", [bool("as_template", "Save as a template"), text("title", "Title"), text("lead_id", "For lead id")], {
        prefill: false,
        confirm: ask("Duplicate {name}?", "Zuops makes a copy of {name}. Nothing is sent.", "Duplicate"),
      }),
    ],
  },
  {
    key: "reports",
    title: "Reports",
    blurb: "Saved reports with their share links, scheduled emails and alerts.",
    list: { op: "list_reports", paging: "none", columns: [col("name", "Report"), col("description", "About"), col("sources", "Sources", "count"), col("share_url", "Share link"), col("updated_at", "Changed", "date")] },
    detail: { op: "get_report", pathParam: "report_id" },
    actions: [
      make("New report", "create_report", [
        area("prompt", "Ask for it in words"), text("template", "Or start from a ready-made one", { help: "Names are in Report catalog." }),
        text("name", "Name"), text("description", "Description"), bool("with_schedule", "Also email it on a schedule"),
      ], { confirm: ask("Make this report?", "Zuops builds the report from your words or the ready-made one. With a schedule on, it is emailed on that schedule.", "Make report") }),
      rowAct("Edit", "update_report", "report_id", [area("prompt", "Change it by asking the AI"), text("name", "Name"), text("description", "Description")], {
        confirm: ask("Change {name}?", "Asking the AI changes what {name} shows, including in its scheduled emails.", "Save report"),
      }),
      view("Numbers", "get_report_data", "report_id"),
      rowAct("Share link", "share_report", "report_id", [bool("enabled", "Share link on"), bool("new_link", "Make a new link")], {
        showResult: true, prefill: false,
        confirm: ask("Change the share link for {name}?", "With the link on, anyone who has it can see {name} without signing in.", "Save link"),
      }),
      rowAct("Email on a schedule", "save_report_schedule", "report_id", [
        text("frequency", "How often", { required: true, help: "daily, weekly, every two weeks, monthly or quarterly, as Zuops names them." }),
        list("recipients", "Recipients", { required: true, help: "Email addresses, separated by commas." }), num("hour", "Hour (0 to 23)"),
        text("timezone", "Time zone"), text("subject", "Subject"), area("message", "Message"),
      ], { prefill: false, confirm: ask("Email {name} on a schedule?", "The recipients you listed get {name} by email on that schedule.", "Save schedule") }),
      rowAct("Alert", "save_report_alert", "report_id", [
        text("metric", "Metric", { required: true }), text("op", "Comparison", { required: true, help: "For example above or below." }),
        num("threshold", "Threshold", { required: true }), list("recipients", "Recipients", { required: true }),
      ], { prefill: false, confirm: ask("Save an alert on {name}?", "The recipients you listed are emailed when {metric} crosses the threshold.", "Save alert") }),
      rowAct("Email now", "send_report", "report_id", [list("recipients", "Recipients"), bool("test", "Only a test to yourself"), text("subject", "Subject"), area("message", "Message")], {
        prefill: false,
        confirm: ask("Email {name} now?", "The recipients get {name} now.", "Email report"),
      }),
      remove("delete_report", "report_id", "report", { confirm: { title: "Delete this report?", body: "{name}, its schedules and alerts are deleted in Zuops.", label: "Delete", destructive: true } }),
    ],
  },
  {
    key: "report-catalog",
    title: "Report catalog",
    blurb: "What a report can show here: connected sources, team emails and ready-made reports.",
    single: { op: "get_report_catalog" },
  },
  {
    key: "short-links",
    title: "Short links",
    blurb: "Short links and QR codes with their clicks.",
    list: {
      op: "list_short_links", query: { limit: 25 }, paging: "cursor", search: "q",
      columns: [col("short_url", "Short link"), col("url", "Goes to"), col("title", "Title"), col("clicks", "Clicks", "number"), col("qr_scans", "Scans", "number"), col("state", "State", "badge"), col("created_at", "Created", "date")],
      filters: [{ param: "archived", label: "Archived", options: opt("exclude", "include", "only") }],
    },
    detail: { op: "get_short_link", pathParam: "link_id" },
    actions: [
      make("New short link", "create_short_link", [
        text("url", "Long link", { required: true }), text("key", "Back half"), text("domain", "Domain"), text("title", "Title"),
        list("tags", "Tags"), when("expires_at", "Ends at"), area("notes", "Notes"),
      ], { showResult: true }),
      make("Make many", "bulk_create_short_links", [json("links", "Links", { required: true, jsonShape: "array", help: 'Up to 100, like [{"url": "https://..."}].' })], { showResult: true }),
      make("Check links work", "check_short_links", [list("ids", "Link ids", { help: "Leave empty to check every link." })], { showResult: true }),
      rowAct("Edit", "update_short_link", "link_id", [text("url", "Long link"), bool("archived", "Archived"), bool("pinned", "Pinned")], {
        confirm: ask("Point {name} somewhere else?", "Everyone who opens {name} from now on, including links already sent, lands on the new long link.", "Save link"),
      }),
      view("Numbers", "short_link_stats", "link_id"),
      view("Latest clicks", "list_short_link_clicks", "link_id"),
      remove("delete_short_link", "link_id", "short link"),
    ],
  },
  {
    key: "short-link-domains",
    title: "Short link domains",
    blurb: "The business's own domains for short links.",
    list: { op: "list_short_link_domains", paging: "none", columns: [col("hostname", "Domain"), col("verified", "Verified", "bool"), col("ssl_status", "Certificate", "badge"), col("root_url", "Bare domain goes to"), col("created_at", "Added", "date")] },
    actions: [
      make("Add a domain", "add_short_link_domain", [text("hostname", "Domain", { required: true, help: "Like go.yourbusiness.com." }), text("root_url", "Bare domain goes to"), text("not_found_url", "Unknown links go to")], { showResult: true }),
      rowAct("Check now", "verify_short_link_domain", "domain_id", [], { showResult: true }),
      remove("delete_short_link_domain", "domain_id", "domain"),
    ],
  },
  {
    key: "short-link-stats",
    title: "Short link numbers",
    blurb: "Every short link's clicks and scans in the last 30 days.",
    single: { op: "short_link_stats_all", query: { range: "30d" } },
  },
  {
    key: "website-widgets",
    title: "Website widget",
    blurb: "The chat and booking widgets on the business's site.",
    list: { op: "list_website_widgets", paging: "none", columns: [col("name", "Widget"), col("enabled", "On", "bool"), col("mode", "Mode"), col("goal", "Goal"), col("conversations_count", "Chats", "number"), col("leads_count", "Leads", "number")] },
    detail: { op: "get_website_widget", pathParam: "widget_id" },
    actions: [
      rowAct("Edit", "update_website_widget", "widget_id", [
        text("name", "Name"), bool("enabled", "On"), pick("mode", "Mode", ["assistant", "booking"]),
        pick("goal", "Goal", ["book_appointment", "customer_support", "lead_capture"]), text("agent_name", "Agent name"),
        area("greeting", "Greeting"), area("ai_prompt", "Instructions for the AI"), text("calendar_id", "Calendar id"),
      ], { confirm: ask("Change {name}?", "Visitors to the website see the change in {name} right away.", "Save widget") }),
    ],
    note: "Widgets are made and deleted in the Zuops app.",
  },
  {
    key: "website-analytics",
    title: "Website analytics",
    blurb: "Visitors, sources, pages and conversions from the website, last 30 days.",
    single: { op: "get_website_analytics", query: { days: 30 } },
    actions: [make("Ask about the website", "ask_website_analytics", [area("question", "Question", { required: true }), num("days", "Days back")], {
      showResult: true, prefill: false,
      confirm: ask("Ask the AI about the website?", "The AI answers from the website's visits, sources and conversions.", "Ask"),
    })],
  },
  {
    key: "website-install",
    title: "Website code",
    blurb: "The line of code for the website, and whether visits arrive.",
    single: { op: "get_website_install" },
  },
  {
    key: "media",
    title: "Media library",
    blurb: "Images and videos the business uses.",
    list: {
      op: "list_media", query: { limit: 25 }, paging: "cursor", search: "search",
      columns: [col("name", "File"), col("kind", "Kind"), col("visible_to_client", "Client sees it", "bool"), col("url", "Link"), col("created_at", "Added", "date")],
      filters: [{ param: "kind", label: "Kind", options: opt("image", "video") }],
    },
    actions: [
      make("Add from a link", "add_media", [text("url", "Public https link", { required: true }), text("name", "Name"), text("folder_id", "Folder id"), bool("visible_to_client", "Client sees it")]),
      rowAct("Edit", "update_media", "media_id", [text("name", "Name"), text("folder_id", "Folder id"), bool("visible_to_client", "Client sees it")]),
    ],
  },
  {
    key: "media-folders",
    title: "Media folders",
    blurb: "Folders in the media library.",
    list: { op: "list_media_folders", paging: "none", columns: [col("name", "Folder"), col("color", "Color"), col("position", "Order", "number")] },
    actions: [
      make("New folder", "create_media_folder", [text("name", "Name", { required: true })]),
      rowAct("Edit", "update_media_folder", "folder_id", [text("name", "Name"), num("position", "Order")]),
      remove("delete_media_folder", "folder_id", "folder"),
    ],
  },
  {
    key: "brain-photos",
    title: "AI Brain photos",
    blurb: "Photos of the business's work the AI can send.",
    list: { op: "list_brain_photos", paging: "none", columns: [col("caption", "Caption"), col("service", "Service"), col("active", "On", "bool"), col("image_url|url", "Image")] },
    actions: [
      make("Add a photo", "add_brain_photo", [text("image_url", "Public image link", { required: true }), text("caption", "Caption"), text("service", "Service"), bool("active", "On")], {
        confirm: ask("Add this photo to the AI Brain?", "When it is on, the AI may text this photo to customers who ask to see work.", "Add photo"),
      }),
      rowAct("Edit", "update_brain_photo", "photo_id", [text("caption", "Caption"), text("service", "Service"), bool("active", "On")], {
        confirm: ask("Change this AI Brain photo?", "When it is on, the AI may text this photo to customers who ask to see work.", "Save photo"),
      }),
      remove("delete_brain_photo", "photo_id", "photo"),
    ],
  },
  {
    key: "brain-prices",
    title: "AI Brain prices",
    blurb: "Prices the AI may quote.",
    list: {
      op: "list_brain_prices", paging: "none",
      columns: [col("name", "Item"), col("kind", "Kind"), col("category", "Category"), col("price_type", "Price type"), col("unit_price_cents", "Price", "money"), col("price_unit", "Unit")],
    },
    actions: [
      make("Add a price", "add_brain_prices", [
        text("name", "Name", { required: true }), pick("kind", "Kind", ["service", "product"]), text("category", "Category"), area("description", "What is included"),
        pick("price_type", "Price type", ["fixed", "from", "range", "quote"]), num("unit_price_cents", "Price in cents"), num("price_max_cents", "Top of range in cents"), text("price_unit", "Unit"),
      ], { confirm: ask("Let the AI quote {name}?", "The AI may quote this price to your leads in its replies.", "Add price") }),
      make("What the AI says with prices", "set_brain_price_note", [area("note", "Note", { required: true })], {
        confirm: ask("Change what the AI says with prices?", "The AI adds this note when it quotes prices to your leads.", "Save note"),
      }),
      rowAct("Edit", "update_brain_price", "item_id", [
        text("name", "Name"), text("category", "Category"), area("description", "What is included"), num("unit_price_cents", "Price in cents"),
        text("price_unit", "Unit"), bool("ai_enabled", "The AI may quote it"),
      ], { confirm: ask("Change {name}?", "The AI quotes the changed price to your leads in its replies.", "Save price") }),
      remove("remove_brain_price", "item_id", "price", { label: "Stop quoting", confirm: { title: "Stop the AI quoting {name}?", body: "The price is removed from the AI Brain.", label: "Stop quoting", destructive: true } }),
    ],
  },
  {
    key: "brain-waiting",
    title: "AI Brain questions",
    blurb: "Questions the AI could not answer, waiting on you.",
    list: { op: "list_brain_waiting", paging: "none", columns: [col("question", "Question"), col("times", "Asked", "number"), col("asked_at", "Last asked", "datetime"), col("lead_name", "Asked by")], rowId: "event_id" },
    actions: [
      rowAct("Answer", "answer_brain_waiting", "", [area("answer", "What the AI should say", { required: true })], {
        pathParam: undefined, rowBody: [{ field: "question", from: "question" }, { field: "event_id", from: "event_id" }], done: "The AI knows the answer now.",
        prefill: false,
        confirm: ask("Teach the AI this answer?", "The AI gives your answer to \"{name}\" when real people ask it.", "Save answer"),
      }),
      rowAct("Dismiss", "dismiss_brain_waiting", "", [], { pathParam: undefined, rowBody: [{ field: "questions", from: "question", array: true }] }),
    ],
  },
  {
    key: "ad-insights",
    title: "Ad insights",
    blurb: "Meta ad results for the last 30 days.",
    single: { op: "get_ad_insights", query: { date_preset: "last_30d" } },
  },
  {
    key: "ad-insight-cards",
    title: "Ad insight cards",
    blurb: "The cards at the top of Ad insights and the custom metrics.",
    single: { op: "get_ad_insights_cards" },
    actions: [make("Change cards", "set_ad_insights_cards", [json("cards", "Cards", { jsonShape: "array" }), json("metrics", "Custom metrics", { jsonShape: "array" }), bool("reset", "Back to the defaults")])],
  },
  {
    key: "google-ads",
    title: "Google Ads",
    blurb: "The Google Ads connection and the last 30 days of results.",
    single: { op: "google_ads_report", query: { report: "overview", range: "last_30d" } },
  },
  {
    key: "google-ads-status",
    title: "Google Ads connection",
    blurb: "Whether Google Ads is connected, and the conversions sent to it.",
    single: { op: "google_ads_status" },
  },
  {
    key: "gbp-profiles",
    title: "Google Business profiles",
    blurb: "The connected Google Business profiles.",
    list: { op: "list_gbp_profiles", paging: "none", columns: [col("name|title|location_name", "Profile"), col("address|storefront_address", "Address"), col("status|state", "Status", "badge")] },
    actions: [
      make("Owner's connect link", "make_gbp_connect_link", [text("profile_id", "Profile id"), bool("reset", "Make a new link")], {
        showResult: true,
        confirm: ask("Make the owner's connect link?", "Whoever opens the link can connect a Google login to this sub-account.", "Make link"),
      }),
      rowAct("Settings", "update_gbp_profile_settings", "profile_id", [area("local_notes", "Local notes"), text("replies_keywords", "Keywords for review replies"), bool("photos_geotag", "Geotag photos")]),
    ],
  },
  {
    key: "gbp-posts",
    title: "Google posts",
    blurb: "Posts on the Google Business profile.",
    list: {
      op: "list_gbp_posts", query: { limit: 25 }, paging: "cursor",
      columns: [col("title|summary|body", "Post"), col("kind", "Kind"), col("status", "Status", "badge"), col("scheduled_for", "Scheduled", "datetime"), col("published_at", "Posted", "datetime")],
      filters: [{ param: "status", label: "Status", options: opt("draft", "scheduled", "publishing", "published", "failed") }],
    },
    actions: [
      make("New post", "create_gbp_post", [
        area("body", "Text", { required: true }), text("title", "Title"), pick("kind", "Kind", ["STANDARD", "OFFER", "EVENT"]),
        pick("cta_type", "Button", ["NONE", "LEARN_MORE", "BOOK", "CALL", "ORDER", "SHOP", "SIGN_UP"]), text("cta_url", "Button link"),
        text("image_url", "Image link"), when("scheduled_for", "Post at"),
      ], { done: "Draft post saved. Nothing was posted." }),
      make("AI writes posts", "write_gbp_posts", [area("idea", "What to write about"), pick("kind", "Kind", ["STANDARD", "OFFER", "EVENT"]), num("count", "How many (1 to 8)")], {
        showResult: true,
        confirm: ask("Have the AI write posts?", "Zuops writes drafts. Nothing is posted until you approve one.", "Write posts"),
      }),
      rowAct("Edit", "update_gbp_post", "post_id", [text("title", "Title"), area("body", "Text"), text("cta_url", "Button link"), when("scheduled_for", "Post at")], {
        confirm: ask("Change {name}?", "If {name} is approved or scheduled, the change goes live on Google at its time.", "Save post"),
      }),
      rowAct("Approve", "approve_gbp_post", "post_id", [when("scheduled_for", "Post at", { help: "Leave empty to keep its time." })], {
        show: { key: "status", in: ["draft"] },
        confirm: { title: "Approve {name}?", body: "It goes live on Google at its time, where the public sees it.", label: "Approve" },
      }),
      rowAct("Post now", "publish_gbp_post", "post_id", [], {
        show: { key: "status", in: ["draft", "scheduled", "failed"] },
        confirm: { title: "Post {name} on Google now?", body: "The public sees it on the Google Business profile now.", label: "Post now" },
      }),
      rowAct("Unschedule", "unschedule_gbp_post", "post_id", [], { show: { key: "status", in: ["scheduled"] } }),
      remove("delete_gbp_post", "post_id", "post"),
    ],
  },
  {
    key: "gbp-reviews",
    title: "Google reviews",
    blurb: "Google reviews and your replies.",
    list: {
      op: "list_gbp_reviews", query: { limit: 25 }, paging: "cursor",
      columns: [col("reviewer|reviewer_name|author", "Reviewer"), col("stars|rating|star_rating", "Stars", "number"), col("status", "Reply", "badge"), col("comment|text", "Review"), col("created_at|review_time|create_time", "When", "date")],
      filters: [{ param: "status", label: "Reply", options: opt("new", "draft", "sending", "sent", "skipped", "failed") }],
    },
    actions: [
      rowAct("AI draft", "draft_gbp_reply", "review_id", [text("instruction", "Anything to say or avoid")], {
        showResult: true, prefill: false,
        confirm: ask("Have the AI draft a reply to {name}?", "The draft waits for you. Nothing is posted.", "Draft reply"),
      }),
      rowAct("Edit draft or skip", "update_gbp_review", "review_id", [area("draft_reply", "Reply draft"), bool("skip", "Skip this review")]),
      rowAct("Reply", "reply_gbp_review", "review_id", [area("text", "Reply", { help: "Leave empty to post the saved draft." })], {
        confirm: { title: "Reply publicly to {name}?", body: "The reply is posted on Google, where the reviewer and the public see it.", label: "Post reply" },
      }),
    ],
  },
  {
    key: "gbp-optimizer",
    title: "Profile optimizer",
    blurb: "Suggestions to complete the Google profile, and what was changed.",
    list: { op: "list_gbp_optimizer", query: { limit: 20 }, paging: "none", columns: [col("created_at|ran_at", "Checked", "datetime"), col("status", "Status", "badge"), col("score", "Score", "number")] },
    actions: [
      make("Apply suggestions", "apply_gbp_optimizer", [
        text("profile_id", "Profile id"), text("run_id", "Check id", { help: "Leave empty for the newest." }), area("description", "Description (50 to 750 characters)"),
        json("categories", "Category ids", { jsonShape: "array" }), json("services", "Service ids", { jsonShape: "array" }), bool("dry_run", "Preview only"),
      ], { showResult: true, confirm: ask("Apply the suggestions?", "Zuops changes the Google profile with the suggestions you picked. With Preview only on, nothing changes.", "Apply") }),
    ],
  },
  {
    key: "map-rankings",
    title: "Map rankings",
    blurb: "Keywords tracked on Google Maps and their scans.",
    list: { op: "list_map_rankings", query: { limit: 25 }, paging: "cursor", columns: [col("keyword", "Keyword"), col("schedule", "Scans"), col("last_scan_at|latest_scan.created_at", "Last scan", "datetime"), col("average_rank|latest_scan.average_rank", "Average rank", "number")] },
    actions: [
      make("Track a keyword", "create_rank_keyword", [text("keyword", "Keyword", { required: true }), pick("schedule", "Scans", ["off", "weekly", "monthly"]), num("grid_size", "Grid size")], {
        confirm: ask("Track {keyword}?", "Zuops scans Google Maps for {keyword} on the schedule you picked.", "Track"),
      }),
      rowAct("Edit", "update_rank_keyword", "keyword_id", [text("keyword", "Keyword"), pick("schedule", "Scans", ["off", "weekly", "monthly"]), num("grid_size", "Grid size")], {
        confirm: ask("Change {name}?", "Scans of {name} follow the new settings.", "Save"),
      }),
      rowAct("Scan now", "start_rank_scan", "keyword_id", [], { done: "Scan started in Zuops.", confirm: ask("Scan {name} now?", "Zuops scans Google Maps for {name} now.", "Scan") }),
      remove("delete_rank_keyword", "keyword_id", "keyword", { label: "Stop tracking", confirm: { title: "Stop tracking {name}?", body: "Scans of {name} stop.", label: "Stop tracking", destructive: true } }),
    ],
  },
  {
    key: "listings",
    title: "Business listings",
    blurb: "How the business shows on the online directories.",
    single: { op: "get_listings" },
    actions: [
      make("Check the directories", "scan_listings", [text("profile_id", "Profile id")], {
        showResult: true, prefill: false,
        confirm: ask("Check the directories?", "Zuops checks how the business shows on each directory.", "Check"),
      }),
      make("Start listing", "start_listings", [text("campaign_id", "Campaign id")], {
        prefill: false,
        confirm: ask("Start listing the business?", "Zuops starts listing the business on the online directories.", "Start"),
      }),
    ],
  },
  {
    key: "ai-visibility",
    title: "AI visibility",
    blurb: "How often AI assistants name the business.",
    single: { op: "get_ai_visibility" },
    actions: [
      make("Run a check now", "start_ai_visibility_check", [], {
        done: "Check started in Zuops.",
        confirm: ask("Run an AI visibility check now?", "Zuops asks the AI assistants your questions now.", "Run check"),
      }),
      make("Settings", "update_ai_visibility_settings", [
        text("business_name", "Business name"), text("website", "Website"), text("phone", "Phone"), text("town", "Town"), text("state", "State"),
        pick("schedule", "Checks", ["off", "weekly", "monthly"]),
      ], { confirm: ask("Change AI visibility settings?", "Checks follow the new details and schedule.", "Save") }),
      make("Set up", "setup_ai_visibility", [
        json("questions", "Questions customers ask", { required: true, jsonShape: "array" }), text("business_name", "Business name"),
        text("website", "Website"), pick("schedule", "Checks", ["off", "weekly", "monthly"]),
      ], { prefill: false, confirm: ask("Set up AI visibility?", "Zuops saves your questions and checks them on the schedule you picked.", "Set up") }),
      make("Write questions", "write_ai_visibility_questions", [text("service", "Service"), text("town", "Town"), text("state", "State"), text("competitor", "A competitor")], {
        showResult: true, prefill: false,
        confirm: ask("Have the AI write questions?", "Zuops suggests questions customers ask. Nothing is saved until you set them.", "Write questions"),
      }),
      make("Replace questions", "set_ai_visibility_questions", [json("questions", "Questions", { required: true, jsonShape: "array" })]),
    ],
  },
  {
    key: "gbp-embeds",
    title: "Website embeds",
    blurb: "Reviews, photos, posts and FAQ blocks for the website.",
    list: { op: "list_gbp_embeds", paging: "none", columns: [col("name", "Embed"), col("kind", "Kind"), col("created_at", "Made", "date")] },
    actions: [
      make("New embed", "create_gbp_embed", [pick("kind", "Kind", ["reviews", "photos", "posts", "faq", "schema"], { required: true }), text("name", "Name"), text("profile_id", "Profile id")]),
      rowAct("Edit", "update_gbp_embed", "embed_id", [text("name", "Name"), json("settings", "Settings", { jsonShape: "object" })], {
        confirm: ask("Change {name}?", "Websites showing {name} show the change.", "Save embed"),
      }),
      rowAct("Read from Google Maps", "refresh_gbp_embed_facts", "embed_id", [], {
        confirm: ask("Read the facts for {name} from Google Maps?", "Zuops reads the business facts from Google Maps again.", "Read facts"),
      }),
      rowAct("AI writes the FAQ", "write_gbp_embed_faq", "embed_id", [], {
        showResult: true,
        confirm: ask("Have the AI write the FAQ for {name}?", "Zuops writes the questions and answers {name} shows.", "Write FAQ"),
      }),
      remove("delete_gbp_embed", "embed_id", "embed"),
    ],
  },
  {
    key: "gbp-reports",
    title: "Google report emails",
    blurb: "Google report emails sent to the business.",
    list: { op: "list_gbp_reports", query: { limit: 25 }, paging: "none", columns: [col("kind", "Kind"), col("sent_at", "Sent", "datetime"), col("status", "Status", "badge"), col("recipients", "To")], filters: [{ param: "kind", label: "Kind", options: opt("weekly", "monthly", "reviews_quiet", "photos_low", "wins") }] },
    actions: [
      make("Send a test to yourself", "send_gbp_report_test", [pick("kind", "Kind", ["weekly", "monthly", "reviews_quiet", "photos_low", "wins"])], {
        confirm: ask("Send a test Google report?", "It emails the {kind} report to you now.", "Send test"),
      }),
    ],
  },
  {
    key: "gbp-report-settings",
    title: "Google report settings",
    blurb: "When Google report emails go out and to whom.",
    single: { op: "get_gbp_report_settings" },
    actions: [
      make("Edit", "set_gbp_report_settings", [
        bool("enabled", "On"), bool("weekly", "Weekly"), bool("monthly", "Monthly"), num("send_day", "Send day"), num("send_hour", "Send hour (0 to 23)"),
        list("recipients", "Recipients"),
      ], { confirm: ask("Change the Google report emails?", "The recipients get report emails on the new schedule.", "Save") }),
    ],
  },
  {
    key: "gbp-photo-link",
    title: "Crew photo link",
    blurb: "The link and PIN the crew uses to add photos to Google.",
    single: { op: "get_gbp_photo_link" },
  },
  {
    key: "reward-games",
    title: "Reward games",
    blurb: "Spin the wheel, scratch card and gift games sent to past customers.",
    list: {
      op: "list_reward_games", paging: "none",
      columns: [col("name", "Game"), col("status", "Status", "badge"), col("style", "Style"), col("numbers.sent", "Sent", "number"), col("numbers.played", "Played", "number"), col("numbers.redeemed", "Redeemed", "number")],
    },
    detail: { op: "get_reward_game", pathParam: "game_id" },
    actions: [
      make("New game", "create_reward_game", [
        pick("template", "Template", ["win-back", "tune-up", "lost-quotes", "refer-a-friend"]), text("name", "Name"),
        pick("style", "Style", ["wheel", "scratch", "gifts"]), text("headline", "Headline"), area("message", "Message"), num("expires_days", "Rewards expire after (days)"),
      ], { done: "Draft game saved. Nothing was sent." }),
      rowAct("Edit", "update_reward_game", "game_id", [pick("status", "Status", ["draft", "live", "paused", "ended"]), text("headline", "Headline")], {
        confirm: ask("Change {name}?", "A new status changes whether customers can play {name}.", "Save game"),
      }),
      rowAct("Who it would reach", "reward_game_audience", "game_id", [
        pick("audience", "Audience", ["past_customers", "lost_quotes", "quiet_leads", "everyone"], { required: true }), pick("channel", "Channel", ["sms", "email"], { required: true }),
      ], { showResult: true }),
      rowAct("Send", "send_reward_game", "game_id", [
        pick("audience", "Audience", ["past_customers", "lost_quotes", "quiet_leads", "everyone"], { required: true }), pick("channel", "Channel", ["sms", "email"], { required: true }),
      ], {
        prefill: false,
        confirm: ask("Send {name} to {audience}?", "Everyone in {audience} gets {name} by {channel}, at a steady pace inside sending hours. Press Who it would reach first to see how many.", "Send game"),
      }),
      rowAct("Test link", "try_reward_game", "game_id", [], { showResult: true, confirm: ask("Make a test link for {name}?", "Zuops makes a link to play {name} yourself.", "Make link") }),
      view("Plays", "list_reward_game_plays", "game_id"),
      make("Mark a reward used", "redeem_reward_game_play", [text("play_id", "Play id", { required: true, in: "path" }), bool("undo", "Undo")], {
        confirm: ask("Mark the reward on play {play_id} as used?", "The reward on that play is marked as used, or back to unused with Undo on.", "Save"),
      }),
      remove("delete_reward_game", "game_id", "game"),
    ],
  },
  {
    key: "support",
    title: "Support",
    blurb: "Support tickets with Zuops.",
    list: {
      op: "list_support_tickets", query: { limit: 25 }, paging: "cursor",
      columns: [col("subject", "Ticket"), col("category|topic", "Topic"), col("status", "Status", "badge"), col("handler", "Answered by"), col("unread", "Unread", "bool"), col("last_activity_at|updated_at", "Last activity", "datetime")],
      filters: [{ param: "status", label: "Status", options: opt("open", "answered", "resolved") }],
    },
    detail: { op: "get_support_ticket", pathParam: "ticket_id" },
    actions: [
      make("New ticket", "create_support_ticket", [area("message", "Message", { required: true }), text("subject", "Subject"), pick("topic", "Topic", ["question", "problem", "billing", "request", "ads", "other"])], {
        confirm: ask("Open a support ticket?", "Zuops support gets your message.", "Open ticket"),
      }),
      rowAct("Update", "update_support_ticket", "ticket_id", [pick("status", "Status", ["open", "resolved"]), pick("priority", "Priority", ["urgent", "high", "normal", "low"]), pick("handler", "Answered by", ["staff", "assistant"])]),
      rowAct("Add a message", "add_support_message", "ticket_id", [area("message", "Message", { required: true })], {
        prefill: false,
        confirm: ask("Add this to {name}?", "It is added to {name} and the people on it are notified.", "Add message"),
      }),
      rowAct("Reply to the client", "reply_support_ticket", "ticket_id", [area("body", "Reply", { required: true })], {
        prefill: false,
        confirm: ask("Reply on {name}?", "The client gets the reply on {name} now.", "Send reply"),
      }),
      rowAct("Internal note", "add_support_note", "ticket_id", [area("body", "Note", { required: true })]),
    ],
  },
  {
    key: "offers",
    title: "Offers",
    blurb: "What the business sells to a lead: the first text, follow-ups, notes for the AI and the booking link.",
    list: { op: "list_offers", paging: "none", columns: [col("name", "Offer"), col("offer_label", "Label"), col("is_active", "On", "bool"), col("nurture_enabled", "Follow-ups", "bool")] },
    actions: [
      make("New offer", "create_offer", [
        text("name", "Name", { required: true }), text("offer_label", "Label"), area("first_message_template", "First text"),
        text("booking_link", "Booking link"), area("ai_context_note", "Notes for the AI"), bool("is_active", "On"),
      ], { confirm: ask("Save this offer?", "Leads matched to the offer get its first text and follow-ups when it is on.", "Save offer") }),
      rowAct("Edit", "update_offer", "offer_id", [
        text("name", "Name"), text("offer_label", "Label"), area("first_message_template", "First text"), text("booking_link", "Booking link"),
        area("ai_context_note", "Notes for the AI"), bool("is_active", "On"),
      ], { confirm: ask("Change {name}?", "Leads matched to {name} get its new first text and follow-ups when it is on.", "Save offer") }),
      remove("delete_offer", "offer_id", "offer", { admin: true }),
    ],
  },
  {
    key: "activity",
    title: "Activity log",
    blurb: "Everything that happened in the sub-account, newest first.",
    list: {
      op: "list_activity", query: { limit: 50 }, paging: "cursor", search: "search",
      columns: [col("occurred_at", "When", "datetime"), col("actor_label|actor_name", "Who"), col("category", "Kind"), col("description|title", "What"), col("lead_name", "Lead")],
    },
  },
];

const settings: ResourceDef[] = [
  {
    key: "business-profile",
    title: "Business profile",
    blurb: "Name, industry, time zone, address and contact details.",
    single: { op: "get_business_profile" },
    actions: [
      make("Edit", "set_business_profile", [
        text("name", "Business name"), text("industry", "Industry"), text("timezone", "Time zone"), text("address_line1", "Address"),
        text("address_line2", "Address line 2"), text("city", "City"), text("state", "State"), text("postal_code", "ZIP or postal code"),
        text("country", "Country"), text("business_phone", "Business phone"), text("business_email", "Business email"),
      ]),
    ],
  },
  {
    key: "workspace",
    title: "Sub-account",
    blurb: "The Zuops sub-account this key is locked to.",
    list: { op: "list_workspaces", paging: "none", columns: [col("name", "Sub-account"), col("created_at", "Created", "date")] },
    detail: { op: "get_workspace", pathParam: "workspace_id" },
    actions: [
      rowAct("Edit", "update_workspace", "workspace_id", [text("logo_url", "Logo link"), json("enabled_features", "Features on", { jsonShape: "object" }), json("hidden_features", "Features hidden", { jsonShape: "object" })]),
      rowAct("Outreach", "configure_outreach", "workspace_id", [
        bool("auto_greet_new_leads", "Greet new leads"), area("first_message_template", "First text"), bool("ai_enabled", "AI replies"),
        text("ai_agent_name", "AI agent name"), text("email_from_name", "Email from name"),
      ], { confirm: ask("Change outreach for {name}?", "How {name} greets new leads, whether the AI replies, and the name its emails come from.", "Save outreach") }),
    ],
  },
  {
    key: "phone-numbers",
    title: "Phone numbers",
    blurb: "The sub-account's numbers and whether each can text.",
    list: {
      op: "list_phone_numbers", rowsKey: "phone_numbers", paging: "none",
      columns: [col("phone_number", "Number"), col("friendly_name", "Name"), col("is_default", "Default", "bool"), col("texting_ready", "Texting ready", "bool"), col("sms_registration_status", "Registration", "badge")],
    },
    note: "Buying and releasing numbers is done in the Zuops app.",
  },
  { key: "texting-registration", title: "Texting registration", blurb: "Where the A2P texting registration with the carriers stands.", single: { op: "get_texting_registration" } },
  {
    key: "number-orders",
    title: "Number orders",
    blurb: "Numbers on order outside the US and their paperwork.",
    list: { op: "list_number_orders", paging: "none", columns: [col("country", "Country"), col("phone_number", "Number"), col("status", "Status", "badge"), col("whose_move", "Waiting on"), col("message", "Note")] },
  },
  {
    key: "team",
    title: "Team",
    blurb: "Who can use the sub-account, and their role.",
    list: { op: "list_members", rowsKey: "members", paging: "none", columns: [col("full_name", "Name"), col("email", "Email"), col("role", "Role", "badge"), col("created_at", "Joined", "date")] },
    actions: [
      make("Invite", "invite_member", [text("email", "Email", { required: true }), pick("role", "Role", ["client_admin", "client_viewer", "client_tech"])], {
        admin: true,
        confirm: { title: "Invite {email}?", body: "Zuops emails them an invite to this sub-account.", label: "Send invite" },
      }),
      rowAct("Change role", "update_member_role", "member_id", [pick("role", "Role", ["client_admin", "client_viewer", "client_tech"], { required: true })], {
        admin: true, prefill: false,
        confirm: ask("Change the role of {name}?", "What {name} can see and do in this sub-account changes.", "Change role"),
      }),
      remove("remove_member", "member_id", "member", { label: "Remove", admin: true, confirm: { title: "Remove {name}?", body: "They lose access to the sub-account.", label: "Remove", destructive: true } }),
    ],
  },
  {
    key: "team-invites",
    title: "Pending invites",
    blurb: "Invites that have not been accepted yet.",
    list: { op: "list_members", rowsKey: "pending_invites", paging: "none", columns: [col("email", "Email"), col("role", "Role", "badge"), col("expires_at", "Expires", "datetime")] },
  },
  {
    key: "tags",
    title: "Tags",
    blurb: "Lead tags and how many leads carry each.",
    list: { op: "list_tags", rowsKey: "tags", paging: "none", columns: [col("name", "Tag"), col("color", "Color"), col("lead_count", "Leads", "number"), col("created_at", "Created", "date")] },
    actions: [
      rowAct("Rename or recolor", "update_tag", "tag_id", [text("name", "Name"), pick("color", "Color", COLORS), bool("update_automations", "Update automations that use it")]),
      rowAct("Merge into another", "merge_tags", "", [text("into", "Merge into tag", { required: true }), bool("update_automations", "Update automations that use it")], {
        pathParam: undefined, rowBody: [{ field: "tags", from: "name", array: true }],
      }),
      remove("delete_tag", "tag_id", "tag", { confirm: { title: "Delete the tag {name}?", body: "{name} comes off every lead that has it.", label: "Delete", destructive: true } }),
    ],
  },
  {
    key: "custom-fields",
    title: "Custom fields",
    blurb: "Extra fields on every lead.",
    list: {
      op: "list_custom_fields", rowsKey: "custom_fields", paging: "none",
      columns: [col("label", "Field"), col("field_key", "Key"), col("field_type", "Type"), col("required", "Required", "bool"), col("show_in_list", "In the list", "bool")],
    },
    actions: [
      make("Add a field", "create_custom_field", [
        text("label", "Label", { required: true }), pick("field_type", "Type", ["text", "textarea", "number", "money", "phone", "email", "select", "date", "datetime", "url", "boolean", "rating", "multiselect"]),
        text("field_key", "Key"), list("options", "Options (for select)"), bool("required", "Required"), bool("show_in_list", "Show in the list"),
      ]),
      rowAct("Edit", "update_custom_field", "field_id", [text("label", "Label"), list("options", "Options"), bool("required", "Required"), bool("show_in_list", "Show in the list")]),
      remove("archive_custom_field", "field_id", "field", { label: "Archive", confirm: { title: "Archive {name}?", body: "The field is hidden from leads and forms.", label: "Archive", destructive: true } }),
    ],
  },
  {
    key: "lead-sources",
    title: "Lead sources",
    blurb: "Links that tag where a lead came from.",
    list: { op: "list_lead_sources", rowsKey: "lead_sources", paging: "none", columns: [col("name", "Source"), col("default_source", "Source tag"), col("default_status", "Status"), col("url|webhook_url", "Link")] },
    actions: [
      make("New source", "create_lead_source", [text("name", "Name", { required: true }), text("default_source", "Source tag"), text("default_status", "Status"), pick("payload_kind", "Sends", ["auto", "lead", "appointment", "update"])]),
      rowAct("Edit", "update_lead_source", "lead_source_id", [text("name", "Name"), text("default_source", "Source tag"), text("default_status", "Status"), pick("payload_kind", "Sends", ["auto", "lead", "appointment", "update"])]),
      remove("delete_lead_source", "lead_source_id", "lead source", { admin: true }),
    ],
  },
  {
    key: "lead-routing",
    title: "Lead routing",
    blurb: "Round robin and Grab it: who gets each new lead.",
    single: { op: "get_lead_routing" },
    actions: [
      make("Edit", "set_lead_routing", [
        bool("round_robin_enabled", "Round robin"), list("eligible_member_ids", "Members in the rotation"), bool("notify_assignee_only", "Alert only the assignee"),
        bool("skip_imported_leads", "Skip imported leads"), bool("notify_on_reply", "Alert on replies"), bool("grab_enabled", "Grab it"),
      ]),
    ],
  },
  {
    key: "alert-recipients",
    title: "Alert recipients",
    blurb: "Who is alerted about new leads and AI receptionist calls.",
    list: {
      op: "list_alert_recipients", rowsKey: "alert_recipients", paging: "none",
      columns: [col("label", "Who"), col("channel", "Channel"), col("destination", "Sent to"), col("active", "On", "bool"), col("notify_leads", "New leads", "bool"), col("notify_calls", "Calls", "bool")],
    },
    actions: [
      make("Add", "create_alert_recipient", [
        pick("channel", "Channel", ["sms", "email"], { required: true }), text("destination", "Phone or email", { required: true }), text("label", "Label"),
        bool("notify_leads", "New leads"), bool("notify_calls", "Calls"),
      ], { admin: true, confirm: ask("Alert {destination}?", "{destination} gets new lead and call alerts, with the lead's details.", "Add") }),
      rowAct("Edit", "update_alert_recipient", "recipient_id", [text("label", "Label"), text("destination", "Phone or email"), bool("notify_leads", "New leads"), bool("notify_calls", "Calls")], {
        admin: true,
        confirm: ask("Change alerts for {name}?", "Alerts with the lead's details go to the destination you set.", "Save"),
      }),
      remove("delete_alert_recipient", "recipient_id", "recipient", { label: "Remove", admin: true, confirm: { title: "Stop alerting {name}?", body: "They no longer get lead and call alerts.", label: "Remove", destructive: true } }),
    ],
  },
  {
    key: "ai-texting",
    title: "AI texting",
    blurb: "The AI texting agent, first texts and automatic replies.",
    single: { op: "get_ai_texting" },
    actions: [
      make("Edit", "set_ai_texting", [
        bool("ai_replies", "AI replies"), text("agent_name", "Agent name"), pick("reply_mode", "Mode", ["auto", "suggest"]), area("first_message", "First text"),
        pick("send_window", "When it may text", ["anytime", "daily", "booking_hours"]), area("prompt_addition", "Extra instructions"),
      ], { confirm: ask("Change the AI texting agent?", "Its replies, first texts and when it may text.", "Save") }),
    ],
  },
  {
    key: "ai-receptionist",
    title: "AI receptionist",
    blurb: "The AI that answers the business's calls.",
    single: { op: "get_ai_receptionist" },
    actions: [
      make("Edit", "set_ai_receptionist", [
        bool("enabled", "On"), pick("mode", "Answers", ["always", "after_hours"]), pick("goal", "Goal", ["book", "support", "book_and_support"]),
        text("agent_name", "Agent name"), area("greeting", "Greeting"), area("after_hours_greeting", "After hours greeting"),
        area("extra_instructions", "Extra instructions"), bool("transfer_enabled", "Transfers calls"), bool("take_messages", "Takes messages"), bool("record_calls", "Records calls"),
      ], { sendAll: true, confirm: { title: "Change the AI receptionist?", body: "What callers hear and what the AI does on calls.", label: "Save" } }),
    ],
  },
  {
    key: "knowledge-base",
    title: "Knowledge base",
    blurb: "The FAQ the AI answers from.",
    single: { op: "get_knowledge_base" },
    actions: [
      make("Add entries", "add_knowledge_base", [json("entries", "Entries", { required: true, jsonShape: "array", help: 'Like [{"question": "Do you mix?", "answer": "Yes, from $300."}].' })], {
        prefill: false,
        confirm: ask("Add these to the FAQ?", "The AI answers your leads from these entries as well as the current ones.", "Add entries"),
      }),
      make("Replace all", "set_knowledge_base", [json("entries", "Entries", { required: true, jsonShape: "array" })], {
        confirm: { title: "Replace the whole FAQ?", body: "Every current entry is replaced by these.", label: "Replace", destructive: true, always: true },
      }),
    ],
  },
  {
    key: "nurture",
    title: "Follow-up sequence",
    blurb: "The automatic follow-up texts and emails new leads get.",
    single: { op: "get_nurture" },
    actions: [
      make("Edit a step", "update_nurture", [pick("channel", "Channel", ["sms", "email"]), bool("enabled", "On"), num("step", "Step number"), area("message", "Message"), text("subject", "Email subject")], {
        confirm: ask("Change the follow-up sequence?", "The follow-up step new leads get.", "Save"),
      }),
      make("Replace", "set_nurture", [
        pick("channel", "Channel", ["sms", "email"]), json("messages", "Messages", { required: true, jsonShape: "array" }), json("subjects", "Email subjects", { jsonShape: "array" }),
        num("span_days", "Over how many days"), bool("enabled", "On"),
      ], { confirm: ask("Replace the follow-up sequence?", "Every {channel} follow-up step new leads get is replaced by these.", "Replace") }),
      make("Remove a channel's steps", "clear_nurture", [pick("channel", "Channel", ["sms", "email"], { required: true, in: "query" })], {
        confirm: { title: "Remove the {channel} follow-ups?", body: "Every {channel} follow-up step is deleted.", label: "Remove", destructive: true },
      }),
    ],
  },
  {
    key: "appointment-emails",
    title: "Appointment emails",
    blurb: "The confirmed, moved and cancelled emails leads get.",
    single: { op: "get_appointment_emails" },
    actions: [
      make("Edit", "set_appointment_emails", [
        bool("enabled", "On"), pick("language", "Language", ["en", "es"]), json("confirmed", "Confirmed email", { jsonShape: "object" }),
        json("updated", "Moved email", { jsonShape: "object" }), json("cancelled", "Cancelled email", { jsonShape: "object" }),
      ], { sendAll: true, confirm: ask("Change the appointment emails?", "The emails leads get when an appointment is confirmed, moved or cancelled.", "Save") }),
    ],
  },
  {
    key: "availability",
    title: "Business hours",
    blurb: "Business hours and booking defaults.",
    single: { op: "get_availability", names: { op: "list_calendars", rowsKey: "calendars" } },
    actions: [
      make("Edit", "set_availability", [
        text("timezone", "Time zone"), num("slot_minutes", "Slot length (minutes)"), num("buffer_minutes", "Buffer (minutes)"), text("default_calendar_id", "Default calendar id"),
        json("weekly_hours", "Weekly hours", { jsonShape: "object", help: 'Like {"mon": [["09:00", "17:00"]], "sat": []}.' }), json("date_overrides", "Date overrides", { jsonShape: "array" }),
      ], { sendAll: true, confirm: ask("Change business hours?", "The times people can book change on every calendar that uses these hours.", "Save hours") }),
    ],
  },
  {
    key: "calendars",
    title: "Calendars",
    blurb: "Booking calendars and their settings.",
    list: { op: "list_calendars", rowsKey: "calendars", paging: "none", columns: [col("name", "Calendar"), col("duration_minutes", "Minutes", "number"), col("assignment_mode", "Who hosts"), col("is_active", "On", "bool"), col("booking_path", "Booking link")] },
    actions: [
      make("New calendar", "create_calendar", [
        text("name", "Name", { required: true }), text("title", "Title"), num("duration_minutes", "Length (minutes)"), num("buffer_minutes", "Buffer (minutes)"),
        text("timezone", "Time zone"), pick("meeting_type", "Meeting", ["zoom", "google_meet", "phone", "phone_attendee", "in_person", "customer_address", "custom"]),
        pick("assignment_mode", "Who hosts", ["single", "round_robin", "collective", "unassigned"]),
      ], { confirm: ask("Make this calendar?", "Its booking page takes real bookings once it is on.", "Make calendar") }),
      rowAct("Edit", "update_calendar", "calendar_id", [
        text("name", "Name"), text("title", "Title"), num("duration_minutes", "Length (minutes)"), num("buffer_minutes", "Buffer (minutes)"),
        num("min_notice_minutes", "Notice (minutes)"), num("max_days_ahead", "Days ahead"), text("timezone", "Time zone"),
      ], { confirm: ask("Change {name}?", "The booking times and page of {name} change for people booking.", "Save calendar") }),
      rowAct("Copy design to others", "copy_calendar_design", "calendar_id", [list("calendar_ids", "Calendar ids"), bool("all", "Every other calendar")]),
    ],
  },
  {
    key: "booking-menus",
    title: "Booking menus",
    blurb: "One booking link that lists several calendars as services.",
    list: { op: "list_booking_menus", paging: "none", columns: [col("title|name", "Menu"), col("public_path", "Link"), col("is_active", "On", "bool")] },
    actions: [
      make("New menu", "create_booking_menu", [text("title", "Title"), text("name", "Name"), area("description", "Description"), text("slug", "Link name"), bool("is_active", "On"), json("sections", "Sections", { jsonShape: "array" })], {
        confirm: ask("Put this booking menu live?", "Unless On is set to No, anyone with its link can book from it.", "Create menu"),
      }),
      rowAct("Edit", "update_booking_menu", "menu_id", [text("title", "Title"), text("name", "Name"), area("description", "Description"), text("slug", "Link name"), bool("is_active", "On")], {
        confirm: ask("Switch {name} on?", "With On, anyone with its link can book from {name}.", "Save menu"),
      }),
      remove("delete_booking_menu", "menu_id", "menu"),
    ],
  },
  {
    key: "calendar-routes",
    title: "Calendar routing",
    blurb: "Rules that send each lead to the calendar that fits their answers.",
    list: { op: "list_calendar_routes", paging: "none", columns: [col("position", "Order", "number"), col("name", "Rule"), col("summary", "When"), col("calendar_name", "Calendar"), col("is_active", "On", "bool")] },
    actions: [
      make("Add a rule", "create_calendar_route", [
        text("calendar_id", "Calendar id", { required: true }), json("conditions", "Conditions", { required: true, jsonShape: "array" }), text("name", "Name"), bool("is_active", "On"),
      ]),
      make("Set the order", "reorder_calendar_routes", [list("order", "Rule ids in order", { required: true })]),
      make("Which calendar for a lead", "match_calendar_route", [text("lead_id", "Lead id", { in: "query" })], { showResult: true }),
      rowAct("Change", "update_calendar_route", "route_id", [text("calendar_id", "Calendar id"), json("conditions", "Conditions", { jsonShape: "array" }), text("name", "Name"), bool("is_active", "On")]),
      remove("delete_calendar_route", "route_id", "rule"),
    ],
  },
  {
    key: "outbound-webhooks",
    title: "Outbound webhooks",
    blurb: "Where Zuops posts events, including the one that keeps Pulse current.",
    list: {
      op: "list_outbound_webhooks", rowsKey: "outbound_webhooks", paging: "none",
      columns: [col("name", "Webhook"), col("target_url", "Posts to"), col("enabled", "On", "bool"), col("events", "Events", "count"), col("last_status", "Last answer", "number")],
    },
    actions: [
      make("New webhook", "create_outbound_webhook", [
        text("name", "Name", { required: true }), text("target_url", "Posts to", { required: true }), list("events", "Events", { help: "Leave empty for every event." }),
        bool("enabled", "On"), pick("preset", "Preset", ["zapier", "make", "salesforce_flow", "service_titan", "custom"]), pick("auth_type", "Sign-in", ["none", "bearer", "header", "basic"]),
      ], {
        admin: true,
        confirm: ask("Send events to {target_url}?", "Zuops posts lead, booking and message events, with lead details, to that address.", "Make webhook"),
        reveal: {
          keys: ["secret", "signing_secret", "webhook_secret"],
          title: "Signing secret, shown once",
          note: "Store it as ZUOPS_CRM_WEBHOOK_SECRET in this deployment's Convex environment. Zuops will not show it again, and Pulse does not keep it.",
        },
      }),
      rowAct("Edit", "update_outbound_webhook", "webhook_id", [text("name", "Name"), text("target_url", "Posts to"), list("events", "Events"), bool("enabled", "On")], {
        admin: true,
        confirm: ask("Change {name}?", "Events with lead details go to the address and events you set.", "Save webhook"),
      }),
      remove("delete_outbound_webhook", "webhook_id", "webhook", { admin: true }),
    ],
  },
  {
    key: "imessage-lines",
    title: "iMessage lines",
    blurb: "The Macs that text as iMessage, and who automated texts come from.",
    list: { op: "list_imessage_lines", paging: "none", columns: [col("device_name|label", "Line"), col("number", "Number"), col("is_default", "Default", "bool"), col("online", "Online", "bool"), col("settings.ai_replies", "AI replies", "bool")] },
    actions: [
      make("Automated texts send from", "set_automated_texts_from", [text("send_from", "Send from", { required: true, help: "automatic, number, or a line id." })], {
        confirm: ask("Change who automated texts come from?", "Automated texts to leads come from the line or number you set.", "Save"),
      }),
      rowAct("Settings", "update_imessage_line", "line_id", [
        text("label", "Label"), bool("is_default", "Default"), pick("access", "Who may use it", ["everyone", "owner", "selected"]), pick("scope", "Scope", ["crm", "all"]),
        bool("create_leads", "Makes leads"), pick("new_conversations", "New conversations by", ["sms", "imessage"]),
        pick("fallback", "When offline", ["number", "mac", "mac_then_number", "none"]), bool("ai_replies", "AI replies"),
      ], { confirm: ask("Change {name}?", "Who may use this line and how it texts real people change.", "Save line") }),
    ],
  },
  {
    key: "api-key",
    title: "API key",
    blurb: "The Zuops key this deployment uses: its name, access level and rate limit.",
    single: { op: "key_self", pick: "key", only: [col("name", "Name"), col("access_level", "Access level", "badge"), col("rate_limit_per_min", "Requests per minute", "number")] },
  },
];

export const RESOURCES: Record<ResourceGroup, ResourceDef[]> = { campaigns, automations, forms, calls, more, settings };

export const GROUP_TITLES: Record<ResourceGroup, string> = {
  campaigns: "Campaigns",
  automations: "Automations",
  forms: "Forms",
  calls: "Calls",
  more: "More",
  settings: "Settings",
};

/** The registry areas the curated tabs (Dashboard, Leads, Pipeline, Inbox,
 *  Calendar, Social) own, for the coverage check in resource-config.test.ts. */
export const CURATED_AREAS = [
  "CRM leads", "Pipeline & fields", "Messaging", "Inbox", "Bookings", "Calendars & hours", "Team busy times", "Dashboard", "Setup",
] as const;
