import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { sendGatewayMessage } from '@/lib/admin-gateway';

export async function POST(req: NextRequest) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    const title = String(body?.title || '').trim();
    const message = typeof body?.body === 'string' ? body.body : typeof body?.message === 'string' ? body.message : '';
    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });
    await sendGatewayMessage({ type: 'admin_notify', title, body: message });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Server error' }, { status: 500 });
  }
}
