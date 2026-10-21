import { llmsFullTxt } from "@/lib/llms";

// Every plan, feature and FAQ in one file, for an assistant that wants the
// whole picture in one fetch. See src/lib/llms.ts.
export const dynamic = "force-static";

export function GET() {
  return new Response(llmsFullTxt(), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
