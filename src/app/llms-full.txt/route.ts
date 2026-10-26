import { llmsFullTxt } from "@/lib/llms";
import { directoryFeed } from "@/lib/directory-feed";

// Every plan, feature and FAQ in one file, for an assistant that wants the
// whole picture in one fetch. See src/lib/llms.ts.
// Rebuilt hourly so newly Listed Studios appear without a deploy.
export const revalidate = 3600;

export async function GET() {
  return new Response(llmsFullTxt(await directoryFeed()), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
