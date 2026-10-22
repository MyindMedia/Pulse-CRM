import { llmsTxt } from "@/lib/llms";
import { directoryFeed } from "@/lib/directory-feed";

// Pulse OS for AI assistants (llmstxt.org). Built at deploy from the pricing
// config, so it never quotes a price the site stopped charging, plus the
// Listed Studios, rebuilt hourly so a new one appears without a deploy.
export const revalidate = 3600;

export async function GET() {
  return new Response(llmsTxt(await directoryFeed()), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
