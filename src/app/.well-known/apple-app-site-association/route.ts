/** Apple reads this to decide which studiopulse.tech links open in the Pulse
 *  app instead of Safari: the bank's OAuth return, and the team screens that
 *  texts and pushes link to (the app's AppLink reads the same paths). Client
 *  pages (/book, /pay, /portal, /visit) are deliberately absent: a client
 *  with the studio's own app installed must still land on the web page. */
const APP_LINK_PATHS = [
  "/plaid/oauth",
  "/brief/*",
  "/calendar",
  "/calendar/*",
  "/clock",
  "/schedule",
  "/dashboard",
  "/roster/*",
  "/messages",
  "/messages/*",
  "/inbox",
  "/inventory",
  "/projects/*",
];

export function GET() {
  return Response.json({
    applinks: {
      apps: [],
      details: [{
        appID: "SCFGWPBXMF.tech.studiopulse.pulse.iphone",
        paths: APP_LINK_PATHS,
      }],
    },
  }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
