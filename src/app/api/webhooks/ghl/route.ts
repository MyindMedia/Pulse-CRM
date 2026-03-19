import { NextRequest, NextResponse } from 'next/server';
import { GHL_WEBHOOK_SIGNING_SECRET } from '@/config';
import { GhlWebhookEventSchema } from '@/types/ghl';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-ghl-signature');

  if (!signature) {
    return new NextResponse('No signature found', { status: 400 });
  }

  // TODO: Verify signature against GHL_WEBHOOK_SIGNING_SECRET

  const event = GhlWebhookEventSchema.parse(JSON.parse(rawBody));

  try {
    // TODO: Forward to Convex via httpAction or internal mutation
    // For now, log the event
    console.log(`GHL Webhook received: ${event.type}`, event.data);
  } catch (error) {
    console.error('Error processing GHL webhook:', error);
    return new NextResponse('Error processing webhook', { status: 500 });
  }

  return new NextResponse('Webhook received', { status: 200 });
}
