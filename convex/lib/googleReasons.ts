/* Why a Google connect failed, in plain words. Pure, so the settings screens
   (client) and the callback (server) share one list. */

export type GoogleCallbackReason =
  | "access_denied" // the person pressed Cancel, or the app is in Testing mode and they are not a listed tester
  | "state_mismatch" // forged, expired or replayed state
  | "missing_code"
  | "exchange_failed" // Google refused the code (redirect URI mismatch, bad client secret)
  | "no_refresh_token" // Google gave no long-lived token, so sync would die in an hour
  | "server_error";

export const REASON_MESSAGES: Record<GoogleCallbackReason, string> = {
  access_denied: "Google access was not granted. Press Allow on every permission, and make sure this account is a listed tester if the app is still in Testing mode.",
  state_mismatch: "That connect link expired or was already used. Start the connection again.",
  missing_code: "Google did not send back an authorization code. Start the connection again.",
  exchange_failed: "Google would not exchange the code. The redirect URI or the client secret does not match the Google Cloud console.",
  no_refresh_token: "Google did not give Pulse a long-lived token. Remove Pulse at myaccount.google.com/permissions, then connect again.",
  server_error: "Something went wrong while saving the connection. Try again.",
};
