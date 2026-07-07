import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { loadWorkspaceState, saveWorkspaceState } from '@/lib/db';

function checkAuth(req: NextRequest): boolean {
  const token = req.cookies.get('wc-token')?.value;
  return !!token && !!verifyToken(token);
}

// GET /api/workspace — load saved state from SQLite
export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const data = loadWorkspaceState();
  if (!data) {
    return NextResponse.json({ state: null });
  }
  try {
    return NextResponse.json({ state: JSON.parse(data) });
  } catch {
    return NextResponse.json({ state: null });
  }
}

// PUT /api/workspace — save state to SQLite
export async function PUT(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }
    saveWorkspaceState(JSON.stringify(body));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
