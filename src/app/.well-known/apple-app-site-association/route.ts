/** Apple verifies this endpoint before opening bank OAuth links in Pulse. */
export function GET() {
  return Response.json({
    applinks: {
      apps: [],
      details: [{
        appID: "SCFGWPBXMF.tech.studiopulse.pulse.iphone",
        paths: ["/plaid/oauth"],
      }],
    },
  }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
