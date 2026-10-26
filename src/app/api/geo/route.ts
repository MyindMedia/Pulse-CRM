/* GET /api/geo -> { country: "US" | null }

   The trial form asks visitors in the EU, EEA, UK and Switzerland to tick a
   box before Pulse may email them, so it needs the visitor's country. Netlify
   puts it on every request (`x-nf-geo`, base64 JSON, with `x-country` on
   older paths). Nothing is stored here; an unreadable country comes back as
   null and the form treats that as "ask". */

export const dynamic = "force-dynamic";

function countryFrom(headers: Headers): string | null {
  const geo = headers.get("x-nf-geo");
  if (geo) {
    try {
      const parsed = JSON.parse(Buffer.from(geo, "base64").toString("utf8")) as {
        country?: { code?: string };
      };
      const code = parsed.country?.code?.toUpperCase();
      if (code && /^[A-Z]{2}$/.test(code)) return code;
    } catch {
      // fall through to the plain header
    }
  }
  const plain = headers.get("x-country")?.trim().toUpperCase();
  return plain && /^[A-Z]{2}$/.test(plain) ? plain : null;
}

export function GET(req: Request) {
  return Response.json(
    { country: countryFrom(req.headers) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
