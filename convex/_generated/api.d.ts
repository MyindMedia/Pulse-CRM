/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as agency from "../agency.js";
import type * as agencyStaff from "../agencyStaff.js";
import type * as aiActions from "../aiActions.js";
import type * as aiArtifacts from "../aiArtifacts.js";
import type * as aiContext from "../aiContext.js";
import type * as artists from "../artists.js";
import type * as audit from "../audit.js";
import type * as automation from "../automation.js";
import type * as billing from "../billing.js";
import type * as billingWebhooks from "../billingWebhooks.js";
import type * as booking from "../booking.js";
import type * as branding from "../branding.js";
import type * as checklists from "../checklists.js";
import type * as dashboard from "../dashboard.js";
import type * as deliverables from "../deliverables.js";
import type * as engineeringLogs from "../engineeringLogs.js";
import type * as equipment from "../equipment.js";
import type * as externalCalendars from "../externalCalendars.js";
import type * as externalCalendarsActions from "../externalCalendarsActions.js";
import type * as grants from "../grants.js";
import type * as http from "../http.js";
import type * as insights from "../insights.js";
import type * as invoices from "../invoices.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_accessPolicies from "../lib/accessPolicies.js";
import type * as lib_accessTypes from "../lib/accessTypes.js";
import type * as lib_checklistTemplates from "../lib/checklistTemplates.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_openai from "../lib/openai.js";
import type * as lib_plans from "../lib/plans.js";
import type * as lib_roomStatus from "../lib/roomStatus.js";
import type * as lib_starter from "../lib/starter.js";
import type * as lib_stripe from "../lib/stripe.js";
import type * as lib_tenant from "../lib/tenant.js";
import type * as licensing from "../licensing.js";
import type * as maintenance from "../maintenance.js";
import type * as members from "../members.js";
import type * as migrations from "../migrations.js";
import type * as notifications from "../notifications.js";
import type * as opportunities from "../opportunities.js";
import type * as orgs from "../orgs.js";
import type * as payments from "../payments.js";
import type * as releases from "../releases.js";
import type * as rooms from "../rooms.js";
import type * as seed from "../seed.js";
import type * as sessions from "../sessions.js";
import type * as songs from "../songs.js";
import type * as splitSheets from "../splitSheets.js";
import type * as testHarness from "../testHarness.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  agency: typeof agency;
  agencyStaff: typeof agencyStaff;
  aiActions: typeof aiActions;
  aiArtifacts: typeof aiArtifacts;
  aiContext: typeof aiContext;
  artists: typeof artists;
  audit: typeof audit;
  automation: typeof automation;
  billing: typeof billing;
  billingWebhooks: typeof billingWebhooks;
  booking: typeof booking;
  branding: typeof branding;
  checklists: typeof checklists;
  dashboard: typeof dashboard;
  deliverables: typeof deliverables;
  engineeringLogs: typeof engineeringLogs;
  equipment: typeof equipment;
  externalCalendars: typeof externalCalendars;
  externalCalendarsActions: typeof externalCalendarsActions;
  grants: typeof grants;
  http: typeof http;
  insights: typeof insights;
  invoices: typeof invoices;
  "lib/access": typeof lib_access;
  "lib/accessPolicies": typeof lib_accessPolicies;
  "lib/accessTypes": typeof lib_accessTypes;
  "lib/checklistTemplates": typeof lib_checklistTemplates;
  "lib/money": typeof lib_money;
  "lib/notify": typeof lib_notify;
  "lib/openai": typeof lib_openai;
  "lib/plans": typeof lib_plans;
  "lib/roomStatus": typeof lib_roomStatus;
  "lib/starter": typeof lib_starter;
  "lib/stripe": typeof lib_stripe;
  "lib/tenant": typeof lib_tenant;
  licensing: typeof licensing;
  maintenance: typeof maintenance;
  members: typeof members;
  migrations: typeof migrations;
  notifications: typeof notifications;
  opportunities: typeof opportunities;
  orgs: typeof orgs;
  payments: typeof payments;
  releases: typeof releases;
  rooms: typeof rooms;
  seed: typeof seed;
  sessions: typeof sessions;
  songs: typeof songs;
  splitSheets: typeof splitSheets;
  testHarness: typeof testHarness;
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
