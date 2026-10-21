import { llmsTxt } from "@/lib/llms";

// Pulse OS for AI assistants (llmstxt.org). Built at deploy from the pricing
// config, so it never quotes a price the site stopped charging.
export const dynamic = "force-static";

export function GET() {
  return new Response(llmsTxt(), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
