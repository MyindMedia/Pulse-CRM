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
import type * as artists from "../artists.js";
import type * as automation from "../automation.js";
import type * as booking from "../booking.js";
import type * as dashboard from "../dashboard.js";
import type * as deliverables from "../deliverables.js";
import type * as engineeringLogs from "../engineeringLogs.js";
import type * as equipment from "../equipment.js";
import type * as insights from "../insights.js";
import type * as invoices from "../invoices.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_starter from "../lib/starter.js";
import type * as lib_tenant from "../lib/tenant.js";
import type * as licensing from "../licensing.js";
import type * as members from "../members.js";
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

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  agency: typeof agency;
  artists: typeof artists;
  automation: typeof automation;
  booking: typeof booking;
  dashboard: typeof dashboard;
  deliverables: typeof deliverables;
  engineeringLogs: typeof engineeringLogs;
  equipment: typeof equipment;
  insights: typeof insights;
  invoices: typeof invoices;
  "lib/money": typeof lib_money;
  "lib/notify": typeof lib_notify;
  "lib/starter": typeof lib_starter;
  "lib/tenant": typeof lib_tenant;
  licensing: typeof licensing;
  members: typeof members;
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
