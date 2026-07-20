import { NextRequest, NextResponse } from 'next/server';

import { verifyAdminRequest } from '@/lib/admin-auth';
import { enginesAvailable } from '@/lib/engine-availability';

export async function GET(req: NextRequest) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;

  return NextResponse.json({
    status: 'ok',
    engines: enginesAvailable(),
    time: Date.now(),
  });
}
