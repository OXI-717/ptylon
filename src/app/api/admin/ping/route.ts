import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/admin-auth';

export async function GET(req: NextRequest) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;
  return NextResponse.json({ ok: true, service: 'web-console', time: new Date().toISOString() });
}
