import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { sendGatewayMessage } from '@/lib/admin-gateway';

export async function POST(req: NextRequest) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    const sessionId = String(body?.sessionId || '').trim();
    const data = typeof body?.data === 'string' ? body.data : typeof body?.text === 'string' ? body.text : '';
    if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    if (!data) return NextResponse.json({ error: 'data is required' }, { status: 400 });
    await sendGatewayMessage({ type: 'input', sessionId, data });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Server error' }, { status: 500 });
  }
}
