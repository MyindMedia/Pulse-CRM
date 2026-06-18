/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as activity from "../activity.js";
import type * as agency from "../agency.js";
import type * as agencyBilling from "../agencyBilling.js";
import type * as agencyOps from "../agencyOps.js";
import type * as agencyPlans from "../agencyPlans.js";
import type * as agencyProfile from "../agencyProfile.js";
import type * as agencySettings from "../agencySettings.js";
import type * as agencyStaff from "../agencyStaff.js";
import type * as agent from "../agent.js";
import type * as agentAutomations from "../agentAutomations.js";
import type * as agentFleet from "../agentFleet.js";
import type * as agentHealth from "../agentHealth.js";
import type * as agents_generators from "../agents/generators.js";
import type * as aiActions from "../aiActions.js";
import type * as aiArtifacts from "../aiArtifacts.js";
import type * as aiContext from "../aiContext.js";
import type * as artists from "../artists.js";
import type * as assetDocuments from "../assetDocuments.js";
import type * as audit from "../audit.js";
import type * as automation from "../automation.js";
import type * as availability from "../availability.js";
import type * as billing from "../billing.js";
import type * as billingWebhooks from "../billingWebhooks.js";
import type * as booking from "../booking.js";
import type * as brandHero from "../brandHero.js";
import type * as branding from "../branding.js";
import type * as checklists from "../checklists.js";
import type * as clientEmail from "../clientEmail.js";
import type * as contact from "../contact.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as deliverables from "../deliverables.js";
import type * as demoMode from "../demoMode.js";
import type * as engineeringLogs from "../engineeringLogs.js";
import type * as equipment from "../equipment.js";
import type * as exports from "../exports.js";
import type * as externalCalendars from "../externalCalendars.js";
import type * as externalCalendarsActions from "../externalCalendarsActions.js";
import type * as feeTemplates from "../feeTemplates.js";
import type * as files from "../files.js";
import type * as googleAuth from "../googleAuth.js";
import type * as googleCalendar from "../googleCalendar.js";
import type * as googleCalendarSync from "../googleCalendarSync.js";
import type * as grants from "../grants.js";
import type * as http from "../http.js";
import type * as insights from "../insights.js";
import type * as invites from "../invites.js";
import type * as invoicePay from "../invoicePay.js";
import type * as invoices from "../invoices.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_accessPolicies from "../lib/accessPolicies.js";
import type * as lib_accessTypes from "../lib/accessTypes.js";
import type * as lib_aiGuard from "../lib/aiGuard.js";
import type * as lib_billingGate from "../lib/billingGate.js";
import type * as lib_checklistTemplates from "../lib/checklistTemplates.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_emailTemplates_activation from "../lib/emailTemplates/activation.js";
import type * as lib_emailTemplates_invite from "../lib/emailTemplates/invite.js";
import type * as lib_gearCatalog from "../lib/gearCatalog.js";
import type * as lib_google from "../lib/google.js";
import type * as lib_holidays from "../lib/holidays.js";
import type * as lib_links from "../lib/links.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_openai from "../lib/openai.js";
import type * as lib_phone from "../lib/phone.js";
import type * as lib_plans from "../lib/plans.js";
import type * as lib_roomStatus from "../lib/roomStatus.js";
import type * as lib_sms from "../lib/sms.js";
import type * as lib_softwareCatalog from "../lib/softwareCatalog.js";
import type * as lib_starter from "../lib/starter.js";
import type * as lib_stripe from "../lib/stripe.js";
import type * as lib_tenant from "../lib/tenant.js";
import type * as lib_text from "../lib/text.js";
import type * as lib_usTaxRates from "../lib/usTaxRates.js";
import type * as licensing from "../licensing.js";
import type * as maintenance from "../maintenance.js";
import type * as members from "../members.js";
import type * as memberships from "../memberships.js";
import type * as migrations from "../migrations.js";
import type * as notifications from "../notifications.js";
import type * as onboarding from "../onboarding.js";
import type * as opportunities from "../opportunities.js";
import type * as opsActions from "../opsActions.js";
import type * as opsBrain from "../opsBrain.js";
import type * as orgs from "../orgs.js";
import type * as payments from "../payments.js";
import type * as portal from "../portal.js";
import type * as predictions from "../predictions.js";
import type * as releases from "../releases.js";
import type * as reports from "../reports.js";
import type * as rightsExport from "../rightsExport.js";
import type * as rooms from "../rooms.js";
import type * as seed from "../seed.js";
import type * as seedDemoYear from "../seedDemoYear.js";
import type * as seedSchedule from "../seedSchedule.js";
import type * as sessions from "../sessions.js";
import type * as shifts from "../shifts.js";
import type * as sms from "../sms.js";
import type * as software from "../software.js";
import type * as songs from "../songs.js";
import type * as splitSheets from "../splitSheets.js";
import type * as splitSignatures from "../splitSignatures.js";
import type * as stageDemo from "../stageDemo.js";
import type * as stripeConnect from "../stripeConnect.js";
import type * as testHarness from "../testHarness.js";
import type * as twilioA2P from "../twilioA2P.js";
import type * as usage from "../usage.js";
import type * as waitlist from "../waitlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  activity: typeof activity;
  agency: typeof agency;
  agencyBilling: typeof agencyBilling;
  agencyOps: typeof agencyOps;
  agencyPlans: typeof agencyPlans;
  agencyProfile: typeof agencyProfile;
  agencySettings: typeof agencySettings;
  agencyStaff: typeof agencyStaff;
  agent: typeof agent;
  agentAutomations: typeof agentAutomations;
  agentFleet: typeof agentFleet;
  agentHealth: typeof agentHealth;
  "agents/generators": typeof agents_generators;
  aiActions: typeof aiActions;
  aiArtifacts: typeof aiArtifacts;
  aiContext: typeof aiContext;
  artists: typeof artists;
  assetDocuments: typeof assetDocuments;
  audit: typeof audit;
  automation: typeof automation;
  availability: typeof availability;
  billing: typeof billing;
  billingWebhooks: typeof billingWebhooks;
  booking: typeof booking;
  brandHero: typeof brandHero;
  branding: typeof branding;
  checklists: typeof checklists;
  clientEmail: typeof clientEmail;
  contact: typeof contact;
  crons: typeof crons;
  dashboard: typeof dashboard;
  deliverables: typeof deliverables;
  demoMode: typeof demoMode;
  engineeringLogs: typeof engineeringLogs;
  equipment: typeof equipment;
  exports: typeof exports;
  externalCalendars: typeof externalCalendars;
  externalCalendarsActions: typeof externalCalendarsActions;
  feeTemplates: typeof feeTemplates;
  files: typeof files;
  googleAuth: typeof googleAuth;
  googleCalendar: typeof googleCalendar;
  googleCalendarSync: typeof googleCalendarSync;
  grants: typeof grants;
  http: typeof http;
  insights: typeof insights;
  invites: typeof invites;
  invoicePay: typeof invoicePay;
  invoices: typeof invoices;
  "lib/access": typeof lib_access;
  "lib/accessPolicies": typeof lib_accessPolicies;
  "lib/accessTypes": typeof lib_accessTypes;
  "lib/aiGuard": typeof lib_aiGuard;
  "lib/billingGate": typeof lib_billingGate;
  "lib/checklistTemplates": typeof lib_checklistTemplates;
  "lib/email": typeof lib_email;
  "lib/emailTemplates/activation": typeof lib_emailTemplates_activation;
  "lib/emailTemplates/invite": typeof lib_emailTemplates_invite;
  "lib/gearCatalog": typeof lib_gearCatalog;
  "lib/google": typeof lib_google;
  "lib/holidays": typeof lib_holidays;
  "lib/links": typeof lib_links;
  "lib/money": typeof lib_money;
  "lib/notify": typeof lib_notify;
  "lib/openai": typeof lib_openai;
  "lib/phone": typeof lib_phone;
  "lib/plans": typeof lib_plans;
  "lib/roomStatus": typeof lib_roomStatus;
  "lib/sms": typeof lib_sms;
  "lib/softwareCatalog": typeof lib_softwareCatalog;
  "lib/starter": typeof lib_starter;
  "lib/stripe": typeof lib_stripe;
  "lib/tenant": typeof lib_tenant;
  "lib/text": typeof lib_text;
  "lib/usTaxRates": typeof lib_usTaxRates;
  licensing: typeof licensing;
  maintenance: typeof maintenance;
  members: typeof members;
  memberships: typeof memberships;
  migrations: typeof migrations;
  notifications: typeof notifications;
  onboarding: typeof onboarding;
  opportunities: typeof opportunities;
  opsActions: typeof opsActions;
  opsBrain: typeof opsBrain;
  orgs: typeof orgs;
  payments: typeof payments;
  portal: typeof portal;
  predictions: typeof predictions;
  releases: typeof releases;
  reports: typeof reports;
  rightsExport: typeof rightsExport;
  rooms: typeof rooms;
  seed: typeof seed;
  seedDemoYear: typeof seedDemoYear;
  seedSchedule: typeof seedSchedule;
  sessions: typeof sessions;
  shifts: typeof shifts;
  sms: typeof sms;
  software: typeof software;
  songs: typeof songs;
  splitSheets: typeof splitSheets;
  splitSignatures: typeof splitSignatures;
  stageDemo: typeof stageDemo;
  stripeConnect: typeof stripeConnect;
  testHarness: typeof testHarness;
  twilioA2P: typeof twilioA2P;
  usage: typeof usage;
  waitlist: typeof waitlist;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
