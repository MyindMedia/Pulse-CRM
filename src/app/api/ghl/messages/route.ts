import { NextRequest, NextResponse } from 'next/server';
import { ghlService } from '@/services/ghl';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { contactId, message, type, subject, html } = body;

    if (!contactId || !type) {
      return new NextResponse('Missing required fields', { status: 400 });
    }

    const sentMessage = await ghlService.sendMessage({ contactId, type, message, subject, html });

    return NextResponse.json(sentMessage);
  } catch (error) {
    console.error('Error sending message:', error);
    return new NextResponse('Error sending message', { status: 500 });
  }
}
